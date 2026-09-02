import assert from "node:assert/strict";
import { useEditorStore } from "../lib/store";
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
  const { registerWebMCP } = await import("../lib/webmcp/register");
  const registration = registerWebMCP();
  await Promise.resolve();

  assert.equal(registration.available, true);
  assert.ok(calls.length >= 14);
  assert.ok(calls.every(({ signal }) => signal instanceof AbortSignal));

  useEditorStore.getState().loadTranscript([
    { id: "one", text: "Um", start: 0, end: 0.25, speaker: 0, deleted: false },
    { id: "two", text: "welcome", start: 0.3, end: 0.8, speaker: 0, deleted: false },
  ], [{ id: 0, name: "Host", color: "#6e9cdb" }]);

  const tool = calls.find(({ tool }) => tool.name === "remove_fillers")!.tool;
  const response = await tool.execute({});
  assert.match(response.content[0].text, /"removed":1/);
  assert.equal(useEditorStore.getState().words[0].deleted, true);

  registration.dispose();
  assert.equal(calls[0].signal?.aborted, true);
  delete (globalThis as { document?: unknown }).document;
  console.log("WebMCP registration and shared action smoke test passed.");
}

void run();
