# OpenCast

An agent-native, on-device transcript editor for podcasters and video creators. OpenCast makes every timed word an editable part of the cut: delete text, remove fillers or silence, then play or export the resulting edit. Its WebMCP tools use the exact same action hub as the visible UI, so an agent changes the live project rather than operating a second, hidden integration.

## Phase A is implemented

- Import local video/audio plus a time-coded `.srt`, `.vtt`, or JSON transcript.
- Edit at word level with selection, filler removal, silence removal, splits, clip trimming, undo/redo, an original-time timeline, and cut-skipping preview playback.
- Export the edited transcript as SRT, or render the kept ranges locally as MP4/MP3 via ffmpeg.wasm.
- Register the agent-facing editing surface (`get_project_state`, `get_transcript`, `find_in_transcript`, `remove_fillers`, `remove_silences`, `delete_passage`, exact word edits, timeline controls, undo/redo, and export).
- Display every agent/tool call in the in-app activity panel. The included preview controls call the same actions when a WebMCP host is unavailable.

Phase B adds the full on-device transcription pipeline; Phase C adds diarization and forced alignment.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, import media, then import its transcript. The **Try the sample transcript** path lets you explore the editing engine without a file.

## WebMCP

OpenCast uses the current imperative WebMCP API:

```ts
await document.modelContext.registerTool(tool, { signal });
```

One `AbortController` owns the registration lifecycle. A compatibility fallback handles older preview hosts which exposed `navigator.modelContext.provideContext`.

For a deployed origin, issue a WebMCP origin-trial token and set `WEBMCP_ORIGIN_TRIAL_TOKEN` in the deployment environment (see `.env.example`). `next.config.ts` sends it alongside COOP/COEP headers needed for local ffmpeg.wasm work.

## Verification

```bash
npm run lint
npm run test:core
npm run test:webmcp
npm run typecheck
npm run build
```

OpenCast is fresh code under the [MIT License](LICENSE).
