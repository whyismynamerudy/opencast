import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openProjectStore } from "../src/projectStore.mjs";

const projectId = "12345678-1234-1234-1234-123456789012";

function project(title = "Pilot episode") {
  return {
    id: projectId,
    title,
    snapshot: {
      version: 1,
      projectTitle: title,
      duration: 42,
      mediaSources: [{ id: "source-1" }],
      words: [{ id: "word-1" }],
    },
  };
}

test("persists a shared project snapshot and summary on the Fly volume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencast-project-store-test-"));
  const store = openProjectStore(directory);
  try {
    const created = store.create(project());
    assert.equal(created.title, "Pilot episode");
    assert.equal(created.snapshot.projectTitle, "Pilot episode");
    assert.deepEqual(store.list(), [{
      id: projectId,
      title: "Pilot episode",
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      sourceCount: 1,
      wordCount: 1,
      duration: 42,
    }]);

    const saved = store.save(project("Renamed episode"));
    assert.equal(saved.title, "Renamed episode");
    assert.equal(saved.snapshot.projectTitle, "Renamed episode");
    assert.equal(store.get(projectId).title, "Renamed episode");
    assert.equal(store.delete(projectId), true);
    assert.equal(store.get(projectId), null);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects project snapshots that do not match the current editor format", () => {
  const store = openProjectStore(":memory:");
  try {
    assert.throws(() => store.create({ ...project(), snapshot: { version: 2 } }), /snapshot/);
  } finally {
    store.close();
  }
});
