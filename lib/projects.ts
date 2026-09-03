import { blankProjectSnapshot, type ProjectSnapshot } from "@/lib/store";

const LEGACY_DATABASE = "opencast-project-library";
const PROJECT_ID = /^[a-zA-Z0-9-]{16,}$/;

export type SavedProject = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  snapshot: ProjectSnapshot;
};

export type ProjectSummary = Pick<SavedProject, "id" | "title" | "createdAt" | "updatedAt"> & {
  sourceCount: number;
  wordCount: number;
  duration: number;
};

function normalizedTitle(value: string | undefined): string {
  return value?.trim().slice(0, 120) || "Untitled podcast";
}

async function projectRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error || "Project storage is unavailable.");
  return body;
}

export function projectSummary(project: SavedProject): ProjectSummary {
  return {
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    sourceCount: project.snapshot.mediaSources.length,
    wordCount: project.snapshot.words.length,
    duration: project.snapshot.duration,
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const body = await projectRequest<{ projects?: ProjectSummary[] }>("/api/projects");
  return Array.isArray(body.projects) ? body.projects : [];
}

export async function getProject(id: string): Promise<SavedProject | null> {
  if (!PROJECT_ID.test(id)) return null;
  try {
    const body = await projectRequest<{ project?: SavedProject }>(`/api/projects/${encodeURIComponent(id)}`);
    return body.project?.snapshot?.version === 1 ? body.project : null;
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found.") return null;
    throw error;
  }
}

export async function createProject(title?: string): Promise<SavedProject> {
  const projectTitle = normalizedTitle(title);
  const project: SavedProject = {
    id: crypto.randomUUID(),
    title: projectTitle,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    snapshot: blankProjectSnapshot(projectTitle),
  };
  const body = await projectRequest<{ project?: SavedProject }>("/api/projects", { method: "POST", body: JSON.stringify(project) });
  if (!body.project) throw new Error("Project storage did not create the project.");
  return body.project;
}

export async function saveProject(project: SavedProject): Promise<SavedProject | null> {
  if (!PROJECT_ID.test(project.id)) throw new Error("A valid project id is required.");
  try {
    const body = await projectRequest<{ project?: SavedProject }>(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: "PUT",
      body: JSON.stringify(project),
    });
    return body.project ?? null;
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found.") return null;
    throw error;
  }
}

export async function saveProjectSnapshot(id: string, snapshot: ProjectSnapshot): Promise<SavedProject | null> {
  const existing = await getProject(id);
  if (!existing) return null;
  const title = normalizedTitle(snapshot.projectTitle || existing.title);
  return saveProject({
    ...existing,
    title,
    snapshot: { ...structuredClone(snapshot), projectTitle: title },
  });
}

export async function renameProject(id: string, title: string): Promise<SavedProject | null> {
  const existing = await getProject(id);
  if (!existing) return null;
  const nextTitle = normalizedTitle(title);
  return saveProject({
    ...existing,
    title: nextTitle,
    snapshot: { ...existing.snapshot, projectTitle: nextTitle },
  });
}

export async function deleteProject(id: string): Promise<boolean> {
  if (!PROJECT_ID.test(id)) return false;
  try {
    await projectRequest<{ deleted?: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found.") return false;
    throw error;
  }
}

/**
 * Projects used to be browser-local. Deliberately remove that abandoned store
 * instead of presenting a confusing second library beside the Fly-backed one.
 */
export async function discardLegacyBrowserProjects(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LEGACY_DATABASE);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("Could not remove legacy browser projects."));
    request.onblocked = () => reject(new Error("Close older OpenCast tabs to remove legacy browser projects."));
  });
}
