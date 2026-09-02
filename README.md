# OpenCast

OpenCast is a WebMCP-native, transcript-first podcast editor for projects with more than one recording. Add the host camera, guest camera, screen share, and B-roll as independent sources; synchronize them on one master clock; then edit words and select the program angle in the same live project.

It is designed for ChatGPT Desktop’s built-in browser: a person sees and controls the editing surface while an agent can use the precise tools that OpenCast exposes on that page.

## What is implemented

- Multiple audio or video sources with role labels, individual sync offsets, durable storage status, and an active-angle preview.
- A shared master timeline. Source transcripts retain native source times while the editor, agent tools, cuts, and program-angle selections use synchronized master times.
- Transcript edits: select/cut/restore words, remove fillers and silence, split, trim, undo/redo, speaker labels, SRT export, and local single-source MP4/MP3 export.
- A direct browser-to-Vercel-Blob upload path. Files larger than 100 MB use multipart upload, so a 60-minute HD source does not pass through a Next.js request or need to be loaded into server memory.
- An included Docker media worker for long sources. It stores the original once, uses temporary worker disk to create low-bitrate audio segments, calls OpenAI for word timing plus diarization, and returns source-aware transcript data to the browser.
- A WebMCP editing surface with source upload requests, source listing/role/sync control, worker-job queueing and status, source transcript reads, program-cut proposal/application, and all original text-editing controls.

The source-aware program timeline is complete and shared between the person and agent. Multicam MP4/MP3 rendering is deliberately routed to a worker instead of browser ffmpeg.wasm; the current UI blocks accidental local multicam renders and continues to support SRT export. This keeps the hackathon app responsive with hour-long HD originals while leaving server rendering as the next production worker task.

## Architecture

```text
local files chosen in OpenCast
        │
        ├── direct multipart upload ──> Vercel Blob (original source)
        │                                  │
        │                                  └──> Docker/Render media worker
        │                                       ffmpeg: 16 kHz / 24 kbps audio chunks
        │                                       OpenAI: diarization + word timing
        │                                              │
        └── local object URL for immediate preview     ▼
                                      source transcript + source/master timestamps
                                                       │
                                     OpenCast master timeline + WebMCP tools
```

The worker avoids an in-memory copy of the original. It downloads the original to a temporary directory, creates small Ogg/Opus audio chunks, uploads each chunk to OpenAI, then removes that directory. Plan worker disk for at least roughly twice the largest input source while ffmpeg is running.

## Quick start: transcript/editor only

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. **Try the sample transcript** exercises the editor without media, storage, or an API key. Small media files can use the fallback transcription route when `OPENAI_API_KEY` is present.

## Deploying long HD episodes

### 1. Deploy the Next.js app

Deploy this repository to Vercel (or another Next.js-compatible host) and set these environment variables:

```bash
# Direct project-media storage (server-only Vercel Blob credential)
BLOB_READ_WRITE_TOKEN=
OPENCAST_MAX_SOURCE_GB=5

# Browser-visible URL of the worker deployed in step 2
NEXT_PUBLIC_OPENCAST_MEDIA_WORKER_URL=https://your-opencast-worker.example.com

# Only used by the existing small-file fallback endpoint.
OPENAI_API_KEY=
OPENCAST_MAX_UPLOAD_MB=25

# Optional: WebMCP origin trial token for your deployed origin.
WEBMCP_ORIGIN_TRIAL_TOKEN=
```

`OPENCAST_MAX_SOURCE_GB` defaults to 5 GB. The direct Blob token is constrained by the upload route to audio/video paths beneath the generated source ID and Vercel Blob’s client upload supports multipart retries.

### 2. Deploy the media worker

The [`worker`](worker) directory is a standalone Docker service suitable for Render or any container platform. Point the service at `worker/Dockerfile`, then configure:

```bash
OPENAI_API_KEY=
CORS_ORIGIN=https://your-opencast-app.example.com
ALLOWED_MEDIA_ORIGINS=https://your-store.public.blob.vercel-storage.com
OPENCAST_SEGMENT_SECONDS=600
```

The worker accepts only HTTPS media URLs from `ALLOWED_MEDIA_ORIGINS`; with that variable unset it accepts only Vercel public Blob URLs. It uses an in-memory job map for the MVP, so job state disappears if the worker restarts. Add a database/queue before production.

This hackathon reference uploads originals with **public, unguessable Blob URLs** so the separate worker can retrieve them without receiving a broad storage credential. Add application authentication and switch to a private storage + signed-worker retrieval model for a real production deployment.

### 3. Use it

1. Choose every local source together. The first two default to host and guest; change roles in the Sources panel as needed.
2. Set the manual sync offset if the recordings did not begin together. Positive means that source begins later on the master timeline.
3. Small clips transcribe immediately. For a long recording, use **Process** once direct storage completes; the browser polls the media worker and adds the source transcript when it finishes.
4. Select an angle and use **Cut to …** at the playhead to choose the program camera for the current program segment.

## WebMCP workflow

Open OpenCast in the ChatGPT Desktop built-in browser, enable Site tools, and ask the agent to work on the project. Site tools operate on the currently open page and its signed-in/browser state; OpenAI documents that the page controls which tools are available and that sensitive actions are reviewed by the user. See [Using site tools in the ChatGPT desktop app](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app).

Useful agent sequence:

1. `create_multicam_project`
2. `request_source_upload` — intentionally prepares the visible file-picker workflow rather than pretending a WebMCP tool can read arbitrary files from the computer.
3. `list_sources`, `set_source_role`, and `sync_source`
4. `queue_source_ingest` / `get_source_ingest_status` for a stored long source, after user approval.
5. `get_source_transcript` and `propose_program_cut`
6. `apply_program_cut` with the returned `expected_revision`, then the normal transcript-edit tools.

Every tool calls the same Zustand action hub as the UI. Agent activity is shown in the right-hand panel, and program edits use a revision check so an agent does not overwrite a newer live human edit.

## OpenAI use and cost shape

For every audio segment, the worker makes two requests: `gpt-4o-transcribe-diarize` for speaker-labelled turns and `whisper-1` with word timestamps for edit precision. The original HD video is never sent to the transcription endpoint. Check the current [OpenAI audio model pricing](https://developers.openai.com/api/docs/pricing) before launch and enforce authentication/rate limits before making a public service.

## Verification

```bash
npm run lint
npm run test:core
npm run test:pipeline
npm run test:multicam
npm run test:webmcp
npm run typecheck
npm run build
node --check worker/src/index.mjs
```

The tests cover the original edit engine and media helpers, master/source timestamp conversion, program-range replacement, source duration math, and WebMCP registration plus the shared multicam action surface.

## Development notes

- The existing `/api/transcribe` route remains a deliberately capped, small-file convenience path. It is not the large-podcast architecture.
- The browser keeps local object URLs only for the active session/preview. The original durable copy lives in Blob storage, and neither the Next.js app nor the browser needs to hold a full HD video in memory.
- Speaker identities from independently processed chunks are provisional. Production-quality cross-chunk speaker identity resolution and server-side multicam rendering are sensible next worker upgrades.

OpenCast is released under the [MIT License](LICENSE).
