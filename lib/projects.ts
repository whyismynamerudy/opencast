import { blankProjectSnapshot, type ProjectSnapshot } from "@/lib/store";

const DATABASE = "opencast-project-library";
const STORE = "projects";

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

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("This browser does not support local project storage."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the project library."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Project storage request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not save the project."));
    transaction.onabort = () => reject(transaction.error || new Error("Project save was cancelled."));
  });
}

function normalizedTitle(value: string | undefined): string {
  return value?.trim().slice(0, 120) || "Untitled podcast";
}

function cloneProject(project: SavedProject): SavedProject {
  return structuredClone(project);
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
  const db = await database();
  const transaction = db.transaction(STORE, "readonly");
  const records = await requestResult(transaction.objectStore(STORE).getAll()) as SavedProject[];
  await transactionComplete(transaction);
  return records
    .filter((record) => record?.id && record.snapshot?.version === 1)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(projectSummary);
}

export async function getProject(id: string): Promise<SavedProject | null> {
  const db = await database();
  const transaction = db.transaction(STORE, "readonly");
  const record = await requestResult(transaction.objectStore(STORE).get(id) as IDBRequest<SavedProject | undefined>);
  await transactionComplete(transaction);
  return record?.snapshot?.version === 1 ? cloneProject(record) : null;
}

export async function createProject(title?: string): Promise<SavedProject> {
  const now = Date.now();
  const projectTitle = normalizedTitle(title);
  const project: SavedProject = {
    id: crypto.randomUUID(),
    title: projectTitle,
    createdAt: now,
    updatedAt: now,
    snapshot: blankProjectSnapshot(projectTitle),
  };
  await saveProject(project);
  return project;
}

export async function saveProject(project: SavedProject): Promise<void> {
  const db = await database();
  const transaction = db.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).put(cloneProject(project));
  await transactionComplete(transaction);
}

export async function saveProjectSnapshot(id: string, snapshot: ProjectSnapshot): Promise<SavedProject | null> {
  const existing = await getProject(id);
  if (!existing) return null;
  const title = normalizedTitle(snapshot.projectTitle || existing.title);
  const next: SavedProject = {
    ...existing,
    title,
    updatedAt: Date.now(),
    snapshot: { ...structuredClone(snapshot), projectTitle: title },
  };
  await saveProject(next);
  return next;
}

export async function renameProject(id: string, title: string): Promise<SavedProject | null> {
  const existing = await getProject(id);
  if (!existing) return null;
  const nextTitle = normalizedTitle(title);
  const next: SavedProject = {
    ...existing,
    title: nextTitle,
    updatedAt: Date.now(),
    snapshot: { ...existing.snapshot, projectTitle: nextTitle },
  };
  await saveProject(next);
  return next;
}

export async function deleteProject(id: string): Promise<boolean> {
  const db = await database();
  const transaction = db.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).delete(id);
  await transactionComplete(transaction);
  return true;
}
