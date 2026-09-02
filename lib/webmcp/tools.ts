import type { useEditorStore } from "@/lib/store";

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

export function buildWebMCPTools(store: Store): WebMCPTool[] {
  const state = () => store.getState();
  const run = (name: string, operation: (args: ToolArgs) => unknown): ((args: ToolArgs) => Promise<ToolResult>) =>
    async (args) => {
      try {
        const data = operation(args);
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
      name: "get_project_state",
      description: "Read OpenCast's current media, timing, cut, and speaker state before editing.",
      inputSchema: objectSchema(),
      execute: run("get_project_state", () => state().getProjectState()),
    },
    {
      name: "get_transcript",
      description: "Read the time-coded transcript. Set include_deleted true to include text already cut.",
      inputSchema: objectSchema({ include_deleted: { type: "boolean" } }),
      execute: run("get_transcript", (args) => ({
        words: state().words
          .filter((word) => Boolean(args.include_deleted) || !word.deleted)
          .map(({ id, text, start, end, speaker, deleted }) => ({ id, text, start, end, speaker, deleted })),
      })),
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
