import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const PROJECT_ID = /^[a-zA-Z0-9-]{16,}$/;
const MAX_PROJECT_BYTES = 4 * 1024 * 1024;

function projectId(value) {
  if (typeof value !== "string" || !PROJECT_ID.test(value)) throw new Error("A valid project id is required.");
  return value;
}

function title(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 120)
    : "Untitled podcast";
}

function snapshot(value, projectTitle) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) {
    throw new Error("A valid OpenCast project snapshot is required.");
  }
  const json = JSON.stringify({ ...value, projectTitle });
  if (Buffer.byteLength(json, "utf8") > MAX_PROJECT_BYTES) {
    throw new Error("This project snapshot is too large to save. Split the project into smaller edits.");
  }
  return { json, value: JSON.parse(json) };
}

function projectSummary(row) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceCount: row.source_count,
    wordCount: row.word_count,
    duration: row.duration,
  };
}

function fullProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    snapshot: JSON.parse(row.snapshot_json),
  };
}

function summaryFields(projectSnapshot) {
  return {
    sourceCount: Array.isArray(projectSnapshot.mediaSources) ? projectSnapshot.mediaSources.length : 0,
    wordCount: Array.isArray(projectSnapshot.words) ? projectSnapshot.words.length : 0,
    duration: Number.isFinite(projectSnapshot.duration) && projectSnapshot.duration >= 0 ? projectSnapshot.duration : 0,
  };
}

/**
 * Single-user durable project store. The Fly app has exactly one Machine and
 * mounted volume, so a WAL SQLite file is atomic across requests and remains
 * available after a worker deploy/restart.
 */
export function openProjectStore(workRoot) {
  const database = workRoot === ":memory:"
    ? new DatabaseSync(":memory:")
    : (() => {
      const directory = join(workRoot, "opencast-projects");
      mkdirSync(directory, { recursive: true });
      return new DatabaseSync(join(directory, "projects.sqlite"));
    })();
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source_count INTEGER NOT NULL,
      word_count INTEGER NOT NULL,
      duration REAL NOT NULL,
      snapshot_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS projects_updated_at ON projects(updated_at DESC);
  `);

  const selectAll = database.prepare("SELECT id, title, created_at, updated_at, source_count, word_count, duration FROM projects ORDER BY updated_at DESC");
  const selectOne = database.prepare("SELECT id, title, created_at, updated_at, source_count, word_count, duration, snapshot_json FROM projects WHERE id = ?");
  const insert = database.prepare("INSERT INTO projects (id, title, created_at, updated_at, source_count, word_count, duration, snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const update = database.prepare("UPDATE projects SET title = ?, updated_at = ?, source_count = ?, word_count = ?, duration = ?, snapshot_json = ? WHERE id = ?");
  const remove = database.prepare("DELETE FROM projects WHERE id = ?");

  function normalized(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("A project payload is required.");
    const id = projectId(input.id);
    const projectTitle = title(input.title ?? input.snapshot?.projectTitle);
    const savedSnapshot = snapshot(input.snapshot, projectTitle);
    return { id, title: projectTitle, snapshot: savedSnapshot, ...summaryFields(savedSnapshot.value) };
  }

  return {
    list() {
      return selectAll.all().map(projectSummary);
    },
    get(id) {
      return fullProject(selectOne.get(projectId(id)));
    },
    create(input) {
      const project = normalized(input);
      if (selectOne.get(project.id)) throw new Error("A project with this id already exists.");
      const now = Date.now();
      insert.run(project.id, project.title, now, now, project.sourceCount, project.wordCount, project.duration, project.snapshot.json);
      return fullProject(selectOne.get(project.id));
    },
    save(input) {
      const project = normalized(input);
      if (!selectOne.get(project.id)) return null;
      update.run(project.title, Date.now(), project.sourceCount, project.wordCount, project.duration, project.snapshot.json, project.id);
      return fullProject(selectOne.get(project.id));
    },
    delete(id) {
      return remove.run(projectId(id)).changes > 0;
    },
    close() {
      database.close();
    },
  };
}
