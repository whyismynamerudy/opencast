import type { useEditorStore } from "@/lib/store";
import { queueMediaWorkerSource } from "@/lib/mediaWorkerClient";
import { SOURCE_ROLES, sourceForTime } from "@/lib/multicam";
import { getProjectRuntime } from "@/lib/projectRuntime";
import type { Speaker, SpeakerTurn, Word } from "@/lib/types";

type Store = typeof useEditorStore;
type ToolArgs = Record<string, unknown>;
type ToolResult = { content: Array<{ type: "text"; text: string }> };
export type WebMCPTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: ToolArgs) => Promise<ToolResult>;
};

const objectSchema = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

function result(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function numberArg(value: unknown, fallback?: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mediaWorkerUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_OPENCAST_MEDIA_WORKER_URL?.replace(/\/$/, "");
  return value || null;
}

export function buildWebMCPTools(store: Store): WebMCPTool[] {
  const state = () => store.getState();
  const run = (name: string, operation: (args: ToolArgs) => unknown): ((args: ToolArgs) => Promise<ToolResult>) =>
    async (args) => {
      try {
        const data = await operation(args);
        const detail = typeof data === "object" && data && "message" in data
          ? String((data as { message: unknown }).message)
          : "Completed";
        state().addActivity(name, detail, "success");
        return result({ ok: true, ...((typeof data === "object" && data) ? data as object : { result: data }) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The tool could not complete.";
        state().addActivity(name, message, "error");
        return result({ ok: false, error: message });
      }
    };

  return [
    {
      name: "list_projects",
      description: "List saved OpenCast projects in this authenticated browser, newest first. Each project preserves transcript edits, source roles, and Fly media references.",
      inputSchema: objectSchema(),
      execute: run("list_projects", async () => ({ projects: await getProjectRuntime().list(), message: "Listed saved projects." })),
    },
    {
      name: "get_active_project",
      description: "Read which saved project is currently open in OpenCast.",
      inputSchema: objectSchema(),
      execute: run("get_active_project", () => ({ ...getProjectRuntime().getActive(), message: "Read active project." })),
    },
    {
      name: "create_project",
      description: "Create and open a new blank OpenCast project. This saves the current project first and does not delete it.",
      inputSchema: objectSchema({ title: { type: "string", minLength: 1, maxLength: 120 } }),
      execute: run("create_project", async (args) => {
        const title = typeof args.title === "string" ? args.title : undefined;
        const project = await getProjectRuntime().create(title);
        return { project, message: `Created and opened ${project.title}.` };
      }),
    },
    {
      name: "open_project",
      description: "Save the current project, then open a saved project by ID. This changes the visible editor project.",
      inputSchema: objectSchema({ project_id: { type: "string", minLength: 1 } }, ["project_id"]),
      execute: run("open_project", async (args) => {
        const project = await getProjectRuntime().open(String(args.project_id ?? ""));
        return { project, message: `Opened ${project.title}.` };
      }),
    },
    {
      name: "rename_project",
      description: "Rename a saved project. Use get_active_project to find the current project ID.",
      inputSchema: objectSchema({ project_id: { type: "string", minLength: 1 }, title: { type: "string", minLength: 1, maxLength: 120 } }, ["project_id", "title"]),
      execute: run("rename_project", async (args) => {
        const project = await getProjectRuntime().rename(String(args.project_id ?? ""), String(args.title ?? ""));
        return { project, message: `Renamed project to ${project.title}.` };
      }),
    },
    {
      name: "delete_project",
      description: "Permanently remove a saved project record from this browser. It does not delete the original media from Fly storage. This is destructive and requires explicit confirmation.",
      inputSchema: objectSchema({ project_id: { type: "string", minLength: 1 }, confirm: { type: "boolean", const: true } }, ["project_id", "confirm"]),
      execute: run("delete_project", async (args) => {
        if (args.confirm !== true) throw new Error("Set confirm to true only after the person approves deleting this project.");
        await getProjectRuntime().delete(String(args.project_id ?? ""));
        return { projectId: String(args.project_id ?? ""), message: "Deleted saved project record. Original Fly media was retained." };
      }),
    },
    {
      name: "get_project_state",
      description: "Read OpenCast's current sources, master timeline, cuts, program angle selections, and speakers before editing.",
      inputSchema: objectSchema(),
      execute: run("get_project_state", () => state().getProjectState()),
    },
    {
      name: "create_multicam_project",
      description: "Name the current OpenCast project before adding host, guest, screen, or B-roll sources. This does not delete existing project data.",
      inputSchema: objectSchema({ title: { type: "string", minLength: 1, maxLength: 120 } }),
      execute: run("create_multicam_project", (args) => {
        const title = typeof args.title === "string" ? args.title : undefined;
        state().createMulticamProject(title);
        return { projectTitle: state().projectTitle, revision: state().projectRevision, message: "Prepared the multicam project." };
      }),
    },
    {
      name: "request_source_upload",
      description: "Prepare source slots and direct the person to choose their local audio/video files in OpenCast. This tool never reads files from the computer or receives media bytes.",
      inputSchema: objectSchema({ roles: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", enum: SOURCE_ROLES } } }),
      execute: run("request_source_upload", (args) => {
        const requested = Array.isArray(args.roles)
          ? args.roles.filter((role): role is typeof SOURCE_ROLES[number] => typeof role === "string" && SOURCE_ROLES.includes(role as typeof SOURCE_ROLES[number]))
          : [];
        const request = state().requestSourceUpload(requested.length ? requested : ["host", "guest"]);
        if (!request) throw new Error("Could not prepare source upload slots.");
        return {
          requestId: request.id,
          roles: request.roles,
          nextStep: "The local file chooser is ready in OpenCast. Ask the person to choose the matching files, or use normal browser interaction if available.",
          message: "Prepared source upload slots.",
        };
      }),
    },
    {
      name: "list_sources",
      description: "List all independently recorded sources, their roles, upload/transcript status, durations, and master-timeline sync offsets.",
      inputSchema: objectSchema(),
      execute: run("list_sources", () => ({
        activeSourceId: state().activeSourceId,
        sources: state().mediaSources.map(({ id, name, role, kind, duration, syncOffset, status, uploadProgress, error }) => ({ id, name, role, kind, duration, syncOffset, status, uploadProgress, error })),
      })),
    },
    {
      name: "set_active_source",
      description: "Select one source in the live editor so its transcript and angle preview are visible to the person.",
      inputSchema: objectSchema({ source_id: { type: "string", minLength: 1 } }, ["source_id"]),
      execute: run("set_active_source", (args) => ({ selected: state().setActiveSource(String(args.source_id ?? "")), activeSourceId: state().activeSourceId, message: "Selected source in the editor." })),
    },
    {
      name: "set_source_role",
      description: "Label a source as host, guest, screen, b-roll, or other. This changes organization only, not media timing.",
      inputSchema: objectSchema({ source_id: { type: "string", minLength: 1 }, role: { type: "string", enum: SOURCE_ROLES } }, ["source_id", "role"]),
      execute: run("set_source_role", (args) => ({ updated: state().setSourceRole(String(args.source_id ?? ""), args.role as typeof SOURCE_ROLES[number]), message: "Updated source role." })),
    },
    {
      name: "sync_source",
      description: "Set a source's manual sync offset in seconds on the master timeline. Positive moves it later; negative moves it earlier. Existing source transcript words are remapped without losing native timestamps.",
      inputSchema: objectSchema({ source_id: { type: "string", minLength: 1 }, offset_seconds: { type: "number", minimum: -86400, maximum: 86400 } }, ["source_id", "offset_seconds"]),
      execute: run("sync_source", (args) => ({ synchronized: state().setSourceSyncOffset(String(args.source_id ?? ""), numberArg(args.offset_seconds, Number.NaN) ?? Number.NaN), message: "Updated source sync offset." })),
    },
    {
      name: "queue_source_ingest",
      description: "Queue a completed Fly-stored source in the configured OpenCast media worker. It derives compact audio locally and sends that audio to OpenAI for timed transcription. Use only after confirming this external processing is wanted.",
      inputSchema: objectSchema({ source_id: { type: "string", minLength: 1 } }, ["source_id"]),
      execute: run("queue_source_ingest", async (args) => {
        const source = state().mediaSources.find((item) => item.id === String(args.source_id ?? ""));
        if (!source?.storagePath) throw new Error("That source must finish its Fly upload before it can be queued.");
        const queued = await queueMediaWorkerSource(source.id);
        if (!queued.ok) throw new Error(queued.error);
        return { sourceId: source.id, jobId: queued.jobId, message: "Queued source ingest. OpenCast will apply the transcript automatically when it completes." };
      }),
    },
    {
      name: "get_source_ingest_status",
      description: "Read a queued large-source media-worker job. When it is complete, OpenCast applies the returned source transcript to the live project automatically.",
      inputSchema: objectSchema({ source_id: { type: "string", minLength: 1 } }, ["source_id"]),
      execute: run("get_source_ingest_status", async (args) => {
        const source = state().mediaSources.find((item) => item.id === String(args.source_id ?? ""));
        const baseUrl = mediaWorkerUrl();
        if (!source?.ingestJobId) throw new Error("That source has no queued media-worker job.");
        if (!baseUrl) throw new Error("This OpenCast deployment has no media worker URL configured.");
        const response = await fetch(`${baseUrl}/jobs/${encodeURIComponent(source.ingestJobId)}`, { cache: "no-store" });
        const payload = await response.json() as { status?: unknown; progress?: unknown; error?: unknown; result?: { words?: unknown; speakers?: unknown; speakerTurns?: unknown } };
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Media worker status is unavailable.");
        if (payload.status === "complete" && Array.isArray(payload.result?.words) && Array.isArray(payload.result?.speakers) && Array.isArray(payload.result?.speakerTurns)) {
          state().loadSourceTranscript(source.id, payload.result.words as Word[], payload.result.speakers as Speaker[]);
          state().setSpeakerTurns(payload.result.speakerTurns as SpeakerTurn[]);
          return { sourceId: source.id, status: "complete", words: payload.result.words.length, message: "Applied the finished source transcript to the live project." };
        }
        if (payload.status === "error") {
          const message = typeof payload.error === "string" ? payload.error : "Media worker failed.";
          state().updateMediaSource(source.id, { status: "error", error: message });
          throw new Error(message);
        }
        return { sourceId: source.id, status: payload.status ?? "queued", progress: typeof payload.progress === "number" ? payload.progress : 0, message: "Source ingest is still running." };
      }),
    },
    {
      name: "get_transcript",
      description: "Read the master-timeline transcript across sources. Set include_deleted true to include text already cut.",
      inputSchema: objectSchema({ include_deleted: { type: "boolean" } }),
      execute: run("get_transcript", (args) => ({
        words: state().words
          .filter((word) => Boolean(args.include_deleted) || !word.deleted)
          .map(({ id, text, start, end, speaker, deleted, sourceId, sourceStart, sourceEnd }) => ({ id, text, start, end, speaker, deleted, sourceId: sourceId ?? null, sourceStart: sourceStart ?? start, sourceEnd: sourceEnd ?? end })),
      })),
    },
    {
      name: "get_source_transcript",
      description: "Read one source's transcript with both native source times and synchronized master times. Use this when choosing host/guest program cuts.",
      inputSchema: objectSchema({ source_id: { type: "string", minLength: 1 }, include_deleted: { type: "boolean" } }, ["source_id"]),
      execute: run("get_source_transcript", (args) => {
        const sourceId = String(args.source_id ?? "");
        const source = state().mediaSources.find((item) => item.id === sourceId);
        if (!source) throw new Error("That source is not in this project.");
        return {
          source: { id: source.id, name: source.name, role: source.role, syncOffset: source.syncOffset },
          words: state().words.filter((word) => word.sourceId === sourceId && (Boolean(args.include_deleted) || !word.deleted)).map((word) => ({
            id: word.id, text: word.text, masterStart: word.start, masterEnd: word.end,
            sourceStart: word.sourceStart ?? word.start, sourceEnd: word.sourceEnd ?? word.end,
            speaker: word.speaker, deleted: word.deleted,
          })),
        };
      }),
    },
    {
      name: "propose_program_cut",
      description: "Validate and describe a proposed visible-angle cut on the master timeline without changing the project. Call apply_program_cut only after the person approves it.",
      inputSchema: objectSchema({ source_id: { type: "string", minLength: 1 }, start: { type: "number", minimum: 0 }, end: { type: "number", minimum: 0 } }, ["source_id", "start", "end"]),
      execute: run("propose_program_cut", (args) => {
        const sourceId = String(args.source_id ?? "");
        const start = numberArg(args.start, Number.NaN) ?? Number.NaN;
        const end = numberArg(args.end, Number.NaN) ?? Number.NaN;
        const source = state().mediaSources.find((item) => item.id === sourceId);
        if (!source || !Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.04) throw new Error("Choose an existing source and a valid program range.");
        return {
          source: { id: source.id, name: source.name, role: source.role },
          range: { start, end },
          sourceIsAvailable: sourceForTime(state().mediaSources, sourceId, start) && sourceForTime(state().mediaSources, sourceId, Math.max(start, end - 0.001)),
          expectedRevision: state().projectRevision,
          message: "Proposal is ready for review; it has not changed the program timeline.",
        };
      }),
    },
    {
      name: "apply_program_cut",
      description: "Choose which source is visible for a master-timeline range. Supply expected_revision from propose_program_cut or get_project_state to avoid overwriting a newer live edit.",
      inputSchema: objectSchema({ source_id: { type: "string", minLength: 1 }, start: { type: "number", minimum: 0 }, end: { type: "number", minimum: 0 }, expected_revision: { type: "integer", minimum: 0 } }, ["source_id", "start", "end", "expected_revision"]),
      execute: run("apply_program_cut", (args) => state().applyProgramCut(
        String(args.source_id ?? ""),
        numberArg(args.start, Number.NaN) ?? Number.NaN,
        numberArg(args.end, Number.NaN) ?? Number.NaN,
        Number(args.expected_revision),
      )),
    },
    {
      name: "find_in_transcript",
      description: "Find an exact spoken phrase and return its word IDs, timing, and surrounding context.",
      inputSchema: objectSchema({ query: { type: "string", minLength: 1 } }, ["query"]),
      execute: run("find_in_transcript", (args) => ({ matches: state().findInTranscript(String(args.query ?? "")) })),
    },
    {
      name: "remove_fillers",
      description: "Cut detected filler words such as um, uh, erm, and hmm. This edit is undoable.",
      inputSchema: objectSchema(),
      execute: run("remove_fillers", () => ({ removed: state().removeFillers(), message: "Removed filler words." })),
    },
    {
      name: "remove_silences",
      description: "Cut silence gaps from the recording. Optionally choose the minimum gap duration in seconds.",
      inputSchema: objectSchema({ min_duration: { type: "number", minimum: 0.1 } }),
      execute: run("remove_silences", (args) => ({ ...state().removeSilences(numberArg(args.min_duration)), message: "Removed silent gaps." })),
    },
    {
      name: "delete_passage",
      description: "Cut an exact spoken passage by quoting its transcript text. This edit is undoable.",
      inputSchema: objectSchema({ quote: { type: "string", minLength: 1 } }, ["quote"]),
      execute: run("delete_passage", (args) => state().deletePassage(String(args.quote ?? ""))),
    },
    {
      name: "delete_words",
      description: "Cut an exact list of transcript word IDs. This edit is undoable.",
      inputSchema: objectSchema({ word_ids: { type: "array", items: { type: "string" }, minItems: 1 } }, ["word_ids"]),
      execute: run("delete_words", (args) => ({ removed: state().deleteWords(Array.isArray(args.word_ids) ? args.word_ids.map(String) : []), message: "Cut selected words." })),
    },
    {
      name: "restore_words",
      description: "Restore an exact list of previously cut transcript word IDs.",
      inputSchema: objectSchema({ word_ids: { type: "array", items: { type: "string" }, minItems: 1 } }, ["word_ids"]),
      execute: run("restore_words", (args) => ({ restored: state().restoreWords(Array.isArray(args.word_ids) ? args.word_ids.map(String) : []), message: "Restored selected words." })),
    },
    {
      name: "correct_text",
      description: "Correct the text of one transcript word without changing its media timing.",
      inputSchema: objectSchema({ word_id: { type: "string" }, text: { type: "string", minLength: 1 } }, ["word_id", "text"]),
      execute: run("correct_text", (args) => ({ corrected: state().correctText([String(args.word_id ?? "")], String(args.text ?? "")), message: "Corrected transcript text." })),
    },
    {
      name: "rename_speaker",
      description: "Rename a detected speaker, for example Speaker 1 to Host.",
      inputSchema: objectSchema({ speaker_id: { type: "integer", minimum: 0 }, name: { type: "string", minLength: 1 } }, ["speaker_id", "name"]),
      execute: run("rename_speaker", (args) => ({ renamed: state().renameSpeaker(Number(args.speaker_id), String(args.name ?? "")), message: "Renamed speaker." })),
    },
    {
      name: "reassign_speaker",
      description: "Assign exact transcript word IDs to a detected speaker ID.",
      inputSchema: objectSchema({ word_ids: { type: "array", items: { type: "string" }, minItems: 1 }, speaker_id: { type: "integer", minimum: 0 } }, ["word_ids", "speaker_id"]),
      execute: run("reassign_speaker", (args) => ({ reassigned: state().reassignSpeaker(Array.isArray(args.word_ids) ? args.word_ids.map(String) : [], Number(args.speaker_id)), message: "Reassigned speaker labels." })),
    },
    {
      name: "split_at",
      description: "Create an edit boundary at an original-media timestamp in seconds.",
      inputSchema: objectSchema({ time: { type: "number", minimum: 0 } }, ["time"]),
      execute: run("split_at", (args) => ({ split: state().splitAt(numberArg(args.time, -1) ?? -1), message: "Added a clip boundary." })),
    },
    {
      name: "trim_clip",
      description: "Trim the start or end of a derived clip to an original-media timestamp.",
      inputSchema: objectSchema({ clip_index: { type: "integer", minimum: 0 }, edge: { type: "string", enum: ["start", "end"] }, to_time: { type: "number", minimum: 0 } }, ["clip_index", "edge", "to_time"]),
      execute: run("trim_clip", (args) => ({
        trimmed: state().trimClip(Number(args.clip_index), args.edge === "end" ? "end" : "start", numberArg(args.to_time, -1) ?? -1),
        message: "Trimmed clip edge.",
      })),
    },
    {
      name: "undo",
      description: "Undo the last transcript or timeline edit.",
      inputSchema: objectSchema(),
      execute: run("undo", () => ({ undone: state().undo(), message: "Undid last edit." })),
    },
    {
      name: "redo",
      description: "Redo the last undone transcript or timeline edit.",
      inputSchema: objectSchema(),
      execute: run("redo", () => ({ redone: state().redo(), message: "Redid edit." })),
    },
    {
      name: "seek",
      description: "Move the OpenCast playhead to an original-media timestamp in seconds.",
      inputSchema: objectSchema({ time: { type: "number", minimum: 0 } }, ["time"]),
      execute: run("seek", (args) => {
        const time = numberArg(args.time, 0) ?? 0;
        state().setPlaybackTime(time);
        return { time, message: `Moved playhead to ${time.toFixed(2)} seconds.` };
      }),
    },
    {
      name: "play",
      description: "Play the edited media from the current playhead.",
      inputSchema: objectSchema(),
      execute: run("play", () => { state().setIsPlaying(true); return { message: "Playing edited media." }; }),
    },
    {
      name: "pause",
      description: "Pause the edited media.",
      inputSchema: objectSchema(),
      execute: run("pause", () => { state().setIsPlaying(false); return { message: "Paused media." }; }),
    },
    {
      name: "export",
      description: "Render the edited recording locally as MP4 or MP3, or download an SRT transcript.",
      inputSchema: objectSchema({ format: { type: "string", enum: ["mp4", "mp3", "srt"] } }, ["format"]),
      execute: run("export", (args) => {
        const format = args.format === "mp3" || args.format === "srt" ? args.format : "mp4";
        state().requestExport(format);
        return { queued: true, format, message: `Queued local ${format.toUpperCase()} export.` };
      }),
    },
  ];
}
