import assert from "node:assert/strict";
import { useEditorStore } from "../lib/store";
import { setProjectRuntime } from "../lib/projectRuntime";
import type { ProjectSummary } from "../lib/projects";
import type { WebMCPTool } from "../lib/webmcp/tools";

const calls: Array<{ tool: WebMCPTool; signal?: AbortSignal }> = [];
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    modelContext: {
      registerTool: async (tool: WebMCPTool, options?: { signal?: AbortSignal }) => { calls.push({ tool, signal: options?.signal }); },
    },
  },
});

async function run() {
  const project: ProjectSummary = { id: "project-1", title: "Pilot episode", createdAt: 1, updatedAt: 2, sourceCount: 2, wordCount: 24, duration: 88 };
  const projectCalls: string[] = [];
  setProjectRuntime({
    list: async () => [project],
    getActive: () => ({ id: project.id, title: project.title }),
    create: async (title) => { projectCalls.push(`create:${title}`); return { ...project, id: "project-2", title: title || "Untitled podcast" }; },
    open: async (id) => { projectCalls.push(`open:${id}`); return project; },
    rename: async (id, title) => { projectCalls.push(`rename:${id}:${title}`); return { ...project, title }; },
    delete: async (id) => { projectCalls.push(`delete:${id}`); },
  });
  const { registerWebMCP } = await import("../lib/webmcp/register");
  const registration = registerWebMCP();
  await Promise.resolve();

  assert.equal(registration.available, true);
  assert.ok(calls.length >= 22);
  assert.ok(calls.every(({ signal }) => signal instanceof AbortSignal));

  useEditorStore.getState().loadTranscript([
    { id: "one", text: "Um", start: 0, end: 0.25, speaker: 0, deleted: false },
    { id: "two", text: "welcome", start: 0.3, end: 0.8, speaker: 0, deleted: false },
  ], [{ id: 0, name: "Host", color: "#6e9cdb" }]);

  const tool = calls.find(({ tool }) => tool.name === "remove_fillers")!.tool;
  const response = await tool.execute({});
  assert.match(response.content[0].text, /"removed":1/);
  assert.equal(useEditorStore.getState().words[0].deleted, true);

  const listProjects = calls.find(({ tool }) => tool.name === "list_projects")!.tool;
  const listProjectsResponse = await listProjects.execute({});
  assert.match(listProjectsResponse.content[0].text, /"Pilot episode"/);

  const createProject = calls.find(({ tool }) => tool.name === "create_project")!.tool;
  const createProjectResponse = await createProject.execute({ title: "Guest episode" });
  assert.match(createProjectResponse.content[0].text, /"Guest episode"/);

  const openProject = calls.find(({ tool }) => tool.name === "open_project")!.tool;
  await openProject.execute({ project_id: project.id });

  const deleteProject = calls.find(({ tool }) => tool.name === "delete_project")!.tool;
  const deniedDelete = await deleteProject.execute({ project_id: project.id, confirm: false });
  assert.match(deniedDelete.content[0].text, /"ok":false/);
  await deleteProject.execute({ project_id: project.id, confirm: true });
  assert.deepEqual(projectCalls, ["create:Guest episode", "open:project-1", "delete:project-1"]);

  const sourceId = useEditorStore.getState().addMediaSource({
    name: "guest-angle.mp4",
    role: "guest",
    kind: "video",
    duration: 12,
    file: null,
    localUrl: null,
  });
  const requestUpload = calls.find(({ tool }) => tool.name === "request_source_upload")!.tool;
  const requestResponse = await requestUpload.execute({ roles: ["host", "guest"] });
  assert.match(requestResponse.content[0].text, /"requestId"/);
  assert.deepEqual(useEditorStore.getState().sourceUploadRequest?.roles, ["host", "guest"]);

  const sourceTranscript = calls.find(({ tool }) => tool.name === "get_source_transcript")!.tool;
  const sourceResponse = await sourceTranscript.execute({ source_id: sourceId });
  assert.match(sourceResponse.content[0].text, /"words":\[\]/);

  useEditorStore.getState().updateMediaSource(sourceId, {
    storagePath: sourceId,
    status: "needs-worker",
  });
  const previousFetch = globalThis.fetch;
  const previousWorkerUrl = process.env.NEXT_PUBLIC_OPENCAST_MEDIA_WORKER_URL;
  const workerRequests: Array<{ url: string; body: string | undefined }> = [];
  process.env.NEXT_PUBLIC_OPENCAST_MEDIA_WORKER_URL = "https://worker.example.test";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : undefined;
    workerRequests.push({ url, body });
    if (url === "/api/media/worker-ticket") {
      return new Response(JSON.stringify({ ticket: "signed-worker-ticket" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === "https://worker.example.test/jobs") {
      return new Response(JSON.stringify({ id: "job-123" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const queueSource = calls.find(({ tool }) => tool.name === "queue_source_ingest")!.tool;
    const queueResponse = await queueSource.execute({ source_id: sourceId });
    assert.match(queueResponse.content[0].text, /"jobId":"job-123"/);
    assert.deepEqual(workerRequests.map(({ url, body }) => ({ url, body })), [
      {
        url: "/api/media/worker-ticket",
        body: JSON.stringify({ sourceId, filename: "guest-angle.mp4" }),
      },
      { url: "https://worker.example.test/jobs", body: JSON.stringify({ ticket: "signed-worker-ticket", diarize: true }) },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWorkerUrl === undefined) delete process.env.NEXT_PUBLIC_OPENCAST_MEDIA_WORKER_URL;
    else process.env.NEXT_PUBLIC_OPENCAST_MEDIA_WORKER_URL = previousWorkerUrl;
  }

  const revision = useEditorStore.getState().projectRevision;
  const programCut = calls.find(({ tool }) => tool.name === "apply_program_cut")!.tool;
  const programResponse = await programCut.execute({ source_id: sourceId, start: 0.8, end: 1.8, expected_revision: revision });
  assert.match(programResponse.content[0].text, /"ok":true/);
  assert.equal(useEditorStore.getState().programSegments.some((segment) => segment.sourceId === sourceId && segment.start === 0.8 && segment.end === 1.8), true);

  registration.dispose();
  assert.equal(calls[0].signal?.aborted, true);
  setProjectRuntime(null);
  delete (globalThis as { document?: unknown }).document;
  console.log("WebMCP registration and shared action smoke test passed.");
}

void run();
