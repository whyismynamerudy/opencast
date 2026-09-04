# OpenCast

OpenCast is a WebMCP-native, transcript-first podcast and video editor. Upload recordings, edit the media by editing its words, assemble named compositions (hooks, clips, highlight reels), put captions and image layers on screen, remove the background, and export a finished video — with a person and an agent working the same live project through the same actions.

It is designed for ChatGPT Desktop's built-in browser: a person sees and controls the editing surface while an agent uses the 47 precise tools that OpenCast registers on that page via `document.modelContext.registerTool()`.

**Live app:** https://opencast-ten.vercel.app (credentials provided with the hackathon submission) · **Demo recording script:** [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)

## Access and projects

OpenCast has a deliberately simple single-admin workspace. Credentials are configured only through the `OPENCAST_AUTH_USERNAME` and `OPENCAST_AUTH_PASSWORD` environment variables — the repository contains none, and login fails closed until both are set. The credential check and session-cookie issuance happen on the Next.js backend, and media-upload/job-ticket endpoints require that session too. This is suitable for a private demo only, not a real authentication system. Set `OPENCAST_AUTH_SECRET` as well so the HttpOnly session signature is unique to your deployment.

After sign-in, the project library lets you create, open, rename, and delete editing projects from any browser. Project snapshots live in a SQLite database on the mounted Fly volume; the authenticated Next.js app proxies project requests to that store, so ChatGPT Desktop and a normal browser see the same library. A snapshot includes words, edits, speaker/source metadata, and Fly media source keys; it intentionally never stores a local `File` or full HD original. Deleting a project also deletes its originals and job checkpoints from Fly.

## What is implemented

- **Words-first transcription.** whisper-1 word timing runs in a bounded pool and the editor unlocks the moment words land (about a minute for a 45-minute episode). Speaker labels arrive as a non-blocking background enrichment — and multi-track projects skip ML diarization entirely, because the track itself identifies the speaker.
- Transcript edits: select/cut/restore words, remove fillers and silence, correct text, split, trim, rename/reassign speakers, undo/redo — from the transcript, the Cutting-desk sidebar, or agent tools, all through one shared action hub.
- **Compositions**: named cuts (hook, clip, highlight reel) assembled from master-timeline ranges beside the full episode. Nothing is copied; cutting inside a composition never touches the episode.
- **On-screen elements**: live auto-captions driven by the transcript, timed image layers under (background) or over (B-roll) the footage — from a URL or uploaded from the computer — and ML background removal (MediaPipe selfie segmentation) live in the preview.
- **Composed export**: a canvas compositor renders the kept ranges with all layers, background removal, and captions burned in, recorded with the source audio to MP4 (H.264/AAC, where the browser supports MediaRecorder MP4) or WebM — YouTube-ready. Plain MP4/MP3 cuts and remapped SRT exports remain.
- Multiple audio or video sources with role labels, individual sync offsets, a shared master timeline, and program-angle selection; every project has its own URL (`/project/<id>`).
- A direct browser-to-Fly resumable upload path (16 MiB chunks straight to the worker volume) and a Docker media worker with retries, durable checkpoints, and restart-resumable jobs.
- A 47-tool WebMCP surface covering projects, sources, ingest, transcript reads/edits, compositions, on-screen elements, program cuts, playback, and export.

Multicam composed export renders the active angle only; program-cut-aware server rendering is the next production worker task.

## Architecture

```text
local files chosen in OpenCast
        │
        ├── resumable 16 MiB chunks ──> Docker/Fly.io media worker + volume
        │                                  ffmpeg: 16 kHz / 24 kbps audio
        │                                  OpenAI: word timing first (bounded pool),
        │                                  speaker labels as background enrichment
        │                                              │
        └── local object URL for immediate preview     ▼
                                      source transcript + source/master timestamps
                                                       │
                                     OpenCast master timeline + WebMCP tools
```

The worker avoids an in-memory copy of the original. It writes the browser’s resumable chunks directly to the mounted Fly volume and converts the completed source to 16 kHz mono Ogg/Opus in 15-minute chunks by default (configurable from one to 20 minutes). Word timing (`whisper-1`) runs for all chunks through a bounded pool and completes the job — the transcript is editable at that point. Speaker labeling (`gpt-4o-transcribe-diarize`) then runs on a separate background queue with a real 10-minute request deadline, relabeling the live transcript when it finishes and never blocking the editor; multi-track jobs skip it entirely. Originals remain available for later preview; completed jobs retain only their compact result, while failed/in-progress jobs retain their audio and checkpoints for up to 24 hours. Plan worker disk for at least roughly twice the largest input source while ffmpeg is running.

## Quick start: transcript/editor only

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`, create a project, and choose one or more audio/video recordings. To process local media, configure the Fly worker as described below; the OpenAI key stays on the worker, never in the browser or Next.js app. The product intentionally starts with media rather than manual transcript-file import.

Sign in with the credentials you set in `OPENCAST_AUTH_USERNAME` / `OPENCAST_AUTH_PASSWORD` (in `.env.local` for local development).

## Deploying long HD episodes

### 1. Deploy the Next.js app

Deploy this repository to Vercel (or another Next.js-compatible host) and set these environment variables:

```bash
# Maximum source size authorized by the app (default: 5 GB).
OPENCAST_MAX_SOURCE_GB=5

# Browser-visible URL of the worker deployed in step 2
NEXT_PUBLIC_OPENCAST_MEDIA_WORKER_URL=https://your-opencast-worker.example.com

# Shared only with the worker. The app uses it to issue scoped upload, playback, and job tickets.
OPENCAST_WORKER_SIGNING_SECRET=

# Single-admin login. Login fails closed until both are set.
OPENCAST_AUTH_USERNAME=
OPENCAST_AUTH_PASSWORD=

# Sign the single-admin HttpOnly session cookie.
OPENCAST_AUTH_SECRET=

# Optional: WebMCP origin trial token for your deployed origin.
WEBMCP_ORIGIN_TRIAL_TOKEN=
```

`OPENCAST_MAX_SOURCE_GB` defaults to 5 GB. Each ticket is restricted to one generated source ID, filename, content type, size, and expiry. The browser resumes from the worker-reported offset after transient errors.

### 2. Deploy the media worker

The [`worker`](worker) directory is a standalone Docker service. OpenCast ships a Fly configuration in [`worker/fly.toml`](worker/fly.toml) sized for one HD source at a time: two shared CPUs, 2 GB RAM, and a 15 GB encrypted volume at `/data`. The worker writes originals, compact audio, and job checkpoints below `OPENCAST_WORK_DIR`; it removes derived artifacts after a successful job and retains originals for durable preview.

Deploy it from the worker directory with `fly deploy`. Configure these secrets and environment values:

```bash
OPENAI_API_KEY=
CORS_ORIGIN=https://your-opencast-app.example.com
OPENCAST_WORKER_SIGNING_SECRET=
# Each derived audio input is bounded by duration before it reaches OpenAI.
# Default: 900 seconds (15 min). Values are clamped to 60–1,200 seconds.
OPENCAST_SEGMENT_SECONDS=900
# Defensive per-chunk byte cap; default is 20 MiB.
OPENCAST_SINGLE_AUDIO_MAX_BYTES=20971520
# Resumable browser upload chunks (default: 16 MiB).
OPENCAST_UPLOAD_CHUNK_BYTES=16777216
# Keep this space free before accepting another source (default: 1 GiB).
OPENCAST_MIN_FREE_STORAGE_BYTES=1073741824
# Transient OpenAI failures retry automatically four times by default.
OPENCAST_TRANSCRIPTION_MAX_ATTEMPTS=4
# Failed/in-progress job checkpoints are pruned after one day by default.
OPENCAST_JOB_RETENTION_MS=86400000
```

The worker accepts only signed, scoped upload, playback, and job tickets issued by the authenticated Next.js app. Set the same high-entropy `OPENCAST_WORKER_SIGNING_SECRET` on both hosts. For transcription, it extracts 16 kHz mono Opus directly from the original into duration-bounded chunks; it never makes a full intermediate audio file for a long episode. Chunk offsets and completed OpenAI responses are durable checkpoints, so an interrupted job resumes from the missing chunk after a Machine restart. A database/queue and replicated object storage are still the appropriate next steps for multi-user production.

Fly deployment uses one Machine and keeps it running: asynchronous jobs carry on after the browser receives its job ID, so automatic idling must remain disabled. The mounted volume is the source of truth for this single-user deployment. Fly volumes are single-region, single-Machine storage; use a separate backup strategy before treating it as production archive storage.

### 3. Use it

1. Choose every local source together. The first two default to host and guest; change roles in the Sources panel as needed.
2. Set the manual sync offset if the recordings did not begin together. Positive means that source begins later on the master timeline.
3. Every source begins direct upload immediately; OpenCast opens the editor with the local preview and timeline straight away. Storage and transcription continue in the background, with the editable transcript appearing in place when it is ready. If a connection drops, choose **Resume upload**; after a browser refresh, choose the same filename and size again to continue from Fly’s stored offset.
4. Select an angle and use **Cut to …** at the playhead to choose the program camera for the current program segment.

## WebMCP workflow

Open OpenCast in the ChatGPT Desktop built-in browser, enable Site tools, and ask the agent to work on the project. Site tools operate on the currently open page and its signed-in/browser state; OpenAI documents that the page controls which tools are available and that sensitive actions are reviewed by the user. See [Using site tools in the ChatGPT desktop app](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app).

Useful agent sequence:

1. `list_projects`, then `create_project` or `open_project`.
2. `request_source_upload` — intentionally prepares the visible file-picker workflow rather than pretending a WebMCP tool can read arbitrary files from the computer.
3. `list_sources`, `set_source_role`, and `sync_source`
4. `queue_source_ingest` / `get_source_ingest_status` for a stored long source, after user approval.
5. `get_source_transcript` and `propose_program_cut`
6. `apply_program_cut` with the returned `expected_revision`, then the normal transcript-edit tools.
7. `create_composition` from `find_in_transcript` ranges for hooks and clips; `set_captions`, `add_image_overlay`, and `set_background_removal` for the on-screen look; `export` with `format: "composed"` for the finished video.

`rename_project` is available for project organization. `delete_project` requires `confirm: true` and permanently removes the saved project along with its uploaded Fly media.

Every tool calls the same Zustand action hub as the UI. Agent activity is shown in the right-hand panel, and program edits use a revision check so an agent does not overwrite a newer live human edit.

## OpenAI use and cost shape

For each compact audio input, the worker calls `whisper-1` with word timestamps for edit precision, then — for single-track sources only — `gpt-4o-transcribe-diarize` for speaker-labelled turns as a background enrichment. Multi-track projects pay nothing for diarization: the track identifies the speaker. The original HD video is never sent to the transcription endpoint. Each completed response's OpenAI `usage` field and elapsed time are retained with the worker job for accurate per-job diagnostics. Check the current [OpenAI audio model pricing](https://developers.openai.com/api/docs/pricing) before launch and enforce authentication/rate limits before making a public service.

## Verification

```bash
npm run lint
npm run test:core
npm run test:pipeline
npm run test:media-status
npm run test:auth
npm run test:projects
npm run test:multicam
npm run test:worker-ticket
npm run test:webmcp
npm run test:speakers
npm run test:compositions
npm run typecheck
npm run build
node --check worker/src/index.mjs
(cd worker && npm test)
```

The tests cover the original edit engine and media helpers, master/source timestamp conversion, program-range replacement, source duration math, and WebMCP registration plus the shared multicam action surface.

## Development notes

- All media sources use the Fly media worker directly, including short clips. This keeps OpenAI credentials off Vercel and gives one consistent, durable retry path for podcast-length recordings.
- The browser keeps local object URLs only for the active session/preview. The original durable copy lives on Fly, and neither the Next.js app nor the browser needs to hold a full HD video in memory.
- Speaker identities from independently processed chunks are provisional. Production-quality cross-chunk speaker identity resolution and server-side multicam rendering are sensible next worker upgrades.

OpenCast is released under the [MIT License](LICENSE).
