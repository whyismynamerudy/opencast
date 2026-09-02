# OpenCast

An agent-native, on-device transcript editor for podcasters and video creators. OpenCast makes every timed word an editable part of the cut: delete text, remove fillers or silence, then play or export the resulting edit. Its WebMCP tools use the exact same action hub as the visible UI, so an agent changes the live project rather than operating a second, hidden integration.

## Implemented: Phase A, B, and C

- Drop local video/audio for the complete on-device pipeline: ffmpeg.wasm extracts mono 16 kHz PCM, Silero VAD identifies speech, Whisper returns word timestamps, a CTC aligner refines boundaries, and pyannote segmentation attributes words to speaker turns.
- Import a time-coded `.srt`, `.vtt`, or JSON transcript when you already have one.
- Edit at word level with selection, filler removal, silence removal, splits, clip trimming, undo/redo, an original-time timeline, and cut-skipping preview playback.
- Export the edited transcript as SRT, or render the kept ranges locally as MP4/MP3 via ffmpeg.wasm.
- Register the agent-facing editing surface (`get_project_state`, `get_transcript`, `find_in_transcript`, `remove_fillers`, `remove_silences`, `delete_passage`, exact word edits, speaker rename/reassignment, timeline controls, undo/redo, and export).
- Display every agent/tool call in the in-app activity panel. The included preview controls call the same actions when a WebMCP host is unavailable.

Large model files are downloaded once to the browser cache from their public model hosts; raw media and transcript data never leave the browser.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, import media, then import its transcript. The **Try the sample transcript** path lets you explore the editing engine without a file.

The primary path is now simply: choose local media → wait for the on-device pipeline → edit the generated transcript. The transcript importer remains a fast fallback for an already-transcribed recording.

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
npm run test:pipeline
npm run typecheck
npm run build
```

OpenCast is fresh code under the [MIT License](LICENSE).
