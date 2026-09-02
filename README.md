# OpenCast

An agent-native transcript editor for podcasters and video creators. OpenCast makes every timed word an editable part of the cut: delete text, remove fillers or silence, then play or export the resulting edit. Its WebMCP tools use the exact same action hub as the visible UI, so an agent changes the live project rather than operating a second, hidden integration.

## Implemented: Phase A, B, and C

- Drop supported video/audio to create a cloud transcript: OpenAI's `gpt-4o-transcribe-diarize` returns speaker-labelled segments and `whisper-1` returns word timestamps. The two calls run in parallel, then OpenCast maps every word to a speaker turn for precise cuts.
- Import a time-coded `.srt`, `.vtt`, or JSON transcript when you already have one.
- Edit at word level with selection, filler removal, silence removal, splits, clip trimming, undo/redo, an original-time timeline, and cut-skipping preview playback.
- Export the edited transcript as SRT, or render the kept ranges locally as MP4/MP3 via ffmpeg.wasm.
- Register the agent-facing editing surface (`get_project_state`, `get_transcript`, `find_in_transcript`, `remove_fillers`, `remove_silences`, `delete_passage`, exact word edits, speaker rename/reassignment, timeline controls, undo/redo, and export).
- Display every agent/tool call in the in-app activity panel. The included preview controls call the same actions when a WebMCP host is unavailable.

Media is sent to OpenAI only for transcription. Preview, editing, and MP4/MP3 rendering stay in the browser; OpenCast does not persist uploaded media or transcript data.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `OPENAI_API_KEY` in `.env.local` before importing media. Open `http://localhost:3000`, then import media. The **Try the sample transcript** path lets you explore the editing engine without a key or media file.

The primary path is: choose supported media → wait for the OpenAI transcript → edit the generated transcript. The transcript importer remains a fast fallback for an already-transcribed recording.

## Hosted transcription and deployment

`POST /api/transcribe` holds the OpenAI key server-side and accepts FLAC, M4A, MP3, MP4, MPEG, MPGA, OGG, WAV, and WebM. It applies a 25 MB upload ceiling by default; change `OPENCAST_MAX_UPLOAD_MB` if the deployment host permits a larger request body. The endpoint intentionally has no user API-key field: the deployer owns the OpenAI account and should use the provider's spend limits (and authentication/rate limiting before a public production launch).

The reference pricing to plan around is roughly $0.012 per audio minute for the two-call word-timed, speaker-labelled pipeline. The diarization request is token-billed; check OpenAI usage after a real clip to determine the exact rate for your material.

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
