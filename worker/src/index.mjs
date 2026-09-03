import { createServer } from "node:http";
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AUDIO_INPUT_MANIFEST_VERSION,
  audioPlanForDuration,
  audioPlanForSize,
  isCurrentAudioManifest,
  labelForChunk,
  singleAudioLimitBytes,
  transcriptionSegmentSeconds,
} from "./mediaPlan.mjs";
import { isRetryableStatus, withTransientRetries } from "./retry.mjs";

const run = promisify(execFile);
const port = Number(process.env.PORT || 8080);
const workRoot = process.env.OPENCAST_WORK_DIR || tmpdir();
const jobRoot = join(workRoot, "opencast-jobs");
const mediaRoot = join(workRoot, "opencast-media");
const jobs = new Map();
const pendingJobs = [];
const activeUploads = new Set();
let processingQueue = false;
const OPENAI_TRANSCRIPT_URL = "https://api.openai.com/v1/audio/transcriptions";
const maxTranscriptionAttempts = Math.max(1, Math.min(Number(process.env.OPENCAST_TRANSCRIPTION_MAX_ATTEMPTS || 4), 8));
const jobRetentionMs = Math.max(60 * 60 * 1000, Number(process.env.OPENCAST_JOB_RETENTION_MS || 24 * 60 * 60 * 1000));
const maxUploadChunkBytes = Math.max(1 * 1024 * 1024, Math.min(Number(process.env.OPENCAST_UPLOAD_CHUNK_BYTES || 16 * 1024 * 1024), 64 * 1024 * 1024));
const minFreeStorageBytes = Math.max(128 * 1024 * 1024, Number(process.env.OPENCAST_MIN_FREE_STORAGE_BYTES || 1 * 1024 * 1024 * 1024));
const sourceIdPattern = /^[a-zA-Z0-9-]{16,}$/;

function respond(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function setCors(request, response) {
  const configured = (process.env.CORS_ORIGIN || "").split(",").map((origin) => origin.trim()).filter(Boolean);
  const origin = request.headers.origin;
  if (!configured.length) response.setHeader("access-control-allow-origin", "*");
  else if (origin && configured.includes(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
  response.setHeader("access-control-allow-methods", "GET,HEAD,POST,PATCH,OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization,content-type,upload-offset");
  response.setHeader("access-control-expose-headers", "upload-offset,upload-length,accept-ranges,content-range");
}

async function readJson(request) {
  const parts = [];
  let length = 0;
  for await (const part of request) {
    length += part.length;
    if (length > 1_000_000) throw new Error("Request body is too large.");
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

function readSignedTicket(value, expectedKind) {
  const secret = process.env.OPENCAST_WORKER_SIGNING_SECRET;
  if (!secret) throw new Error("Media worker authorization is not configured.");
  if (typeof value !== "string") throw new Error("A media worker ticket is required.");
  const [encoded, suppliedSignature, ...rest] = value.split(".");
  if (!encoded || !suppliedSignature || rest.length) throw new Error("Media worker job ticket is invalid.");
  const expectedSignature = createHmac("sha256", secret).update(encoded).digest("base64url");
  const expected = Buffer.from(expectedSignature);
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("Media worker job ticket is invalid.");
  let claim;
  try {
    claim = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Media worker job ticket is invalid.");
  }
  if (claim?.kind !== expectedKind || typeof claim?.sourceId !== "string" || !sourceIdPattern.test(claim.sourceId)) {
    throw new Error("Media worker job ticket is invalid.");
  }
  const maxLifetime = expectedKind === "upload" ? 25 * 60 * 60 * 1000 : expectedKind === "media" ? 3 * 60 * 60 * 1000 : 15 * 60 * 1000;
  if (!Number.isFinite(claim.expiresAt) || claim.expiresAt <= Date.now() || claim.expiresAt > Date.now() + maxLifetime) {
    throw new Error("Media worker job ticket has expired.");
  }
  if (expectedKind === "upload") {
    if (typeof claim.filename !== "string" || !claim.filename || claim.filename.length > 255 || !Number.isSafeInteger(claim.size) || claim.size <= 0 || typeof claim.contentType !== "string" || !/^(audio|video)\//.test(claim.contentType)) {
      throw new Error("Media upload ticket is invalid.");
    }
  }
  if (expectedKind === "job" && (typeof claim.filename !== "string" || !claim.filename || claim.filename.length > 255)) {
    throw new Error("Media worker job ticket is invalid.");
  }
  return claim;
}

function ticketFromRequest(request) {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
}

function readJobTicket(value) {
  return readSignedTicket(value, "job");
}

function readUploadTicket(request) {
  return readSignedTicket(ticketFromRequest(request), "upload");
}

function readMediaTicket(value) {
  return readSignedTicket(value, "media");
}

function jobView(job) {
  return job.status === "complete"
    ? { id: job.id, status: job.status, stage: job.stage, progress: 1, result: job.result }
    : { id: job.id, status: job.status, stage: job.stage, progress: job.progress, ...(job.error ? { error: job.error } : {}) };
}

function describeError(error) {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : null;
  const causeMessage = cause instanceof Error ? cause.message : cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  return causeMessage && causeMessage !== message ? `${message} (${causeMessage})` : message;
}

function requestError(message, { retryable, retryAfterMs } = {}) {
  return Object.assign(new Error(message), { retryable: Boolean(retryable), retryAfterMs });
}

function retryAfterMs(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, path);
}

function jobDirectory(job) {
  return join(jobRoot, job.id);
}

function jobMetadata(job) {
  return {
    id: job.id,
    sourceId: job.sourceId,
    filename: job.filename,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    error: job.error,
    result: job.result,
    metrics: job.metrics,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function ensureJobMetrics(job) {
  if (!job.metrics || typeof job.metrics !== "object") {
    job.metrics = { requests: [] };
  }
  if (!Array.isArray(job.metrics.requests)) job.metrics.requests = [];
  return job.metrics;
}

function recordTranscriptionMetric(job, metric) {
  const metrics = ensureJobMetrics(job);
  metrics.requests.push(metric);
}

async function persistJob(job) {
  job.updatedAt = Date.now();
  const directory = jobDirectory(job);
  await mkdir(directory, { recursive: true });
  await writeJsonAtomic(join(directory, "job.json"), jobMetadata(job));
}

function mediaDirectory(sourceId) {
  return join(mediaRoot, sourceId);
}

function uploadManifestPath(sourceId) {
  return join(mediaDirectory(sourceId), "upload.json");
}

function mediaManifestPath(sourceId) {
  return join(mediaDirectory(sourceId), "media.json");
}

function partialMediaPath(sourceId) {
  return join(mediaDirectory(sourceId), "source.part");
}

function safeExtension(filename) {
  const extension = extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ".media";
}

function finalMediaName(filename) {
  return `source${safeExtension(filename)}`;
}

async function existingUploadOffset(sourceId) {
  try {
    return (await stat(partialMediaPath(sourceId))).size;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
}

async function availableStorageBytes() {
  const filesystem = await statfs(workRoot);
  return Number(filesystem.bavail) * Number(filesystem.bsize);
}

async function ensureStorageCapacity(additionalBytes) {
  const available = await availableStorageBytes();
  if (available - additionalBytes < minFreeStorageBytes) {
    throw new Error("Fly media storage is full. Free space before uploading another recording.");
  }
}

async function prepareUpload(claim) {
  const directory = mediaDirectory(claim.sourceId);
  await mkdir(directory, { recursive: true });
  const complete = await readJsonFile(mediaManifestPath(claim.sourceId));
  if (complete?.sourceId === claim.sourceId && complete?.filename === claim.filename && complete?.size === claim.size) {
    return { offset: claim.size, complete: true };
  }
  const manifest = await readJsonFile(uploadManifestPath(claim.sourceId));
  if (manifest && (manifest.sourceId !== claim.sourceId || manifest.filename !== claim.filename || manifest.size !== claim.size || manifest.contentType !== claim.contentType)) {
    throw new Error("This upload source is already reserved for a different recording.");
  }
  const offset = await existingUploadOffset(claim.sourceId);
  if (offset > claim.size) throw new Error("Stored upload data is larger than its authorized source.");
  await ensureStorageCapacity(Math.max(0, claim.size - offset));
  await writeJsonAtomic(uploadManifestPath(claim.sourceId), {
    sourceId: claim.sourceId,
    filename: claim.filename,
    size: claim.size,
    contentType: claim.contentType,
    offset,
    updatedAt: Date.now(),
  });
  return { offset, complete: false };
}

async function finalizeUpload(claim) {
  const directory = mediaDirectory(claim.sourceId);
  const partialPath = partialMediaPath(claim.sourceId);
  const finalName = finalMediaName(claim.filename);
  const finalPath = join(directory, finalName);
  if (await fileExists(finalPath)) return;
  await rename(partialPath, finalPath);
  await writeJsonAtomic(mediaManifestPath(claim.sourceId), {
    sourceId: claim.sourceId,
    filename: claim.filename,
    size: claim.size,
    contentType: claim.contentType,
    file: finalName,
    completedAt: Date.now(),
  });
  await rm(uploadManifestPath(claim.sourceId), { force: true });
}

async function storedMedia(claim) {
  const manifest = await readJsonFile(mediaManifestPath(claim.sourceId));
  if (!manifest || manifest.sourceId !== claim.sourceId || typeof manifest.file !== "string" || !/^source\.[a-z0-9]{1,10}$/.test(manifest.file)) {
    throw new Error("The completed Fly media source was not found.");
  }
  const path = join(mediaDirectory(claim.sourceId), manifest.file);
  if (!await fileExists(path)) throw new Error("The completed Fly media source was not found.");
  return { path, manifest };
}

async function writeUploadChunk(request, claim, expectedOffset) {
  if (activeUploads.has(claim.sourceId)) return { conflict: true, offset: await existingUploadOffset(claim.sourceId) };
  activeUploads.add(claim.sourceId);
  try {
    const currentOffset = await existingUploadOffset(claim.sourceId);
    if (currentOffset !== expectedOffset) return { conflict: true, offset: currentOffset };
    const rawContentLength = request.headers["content-length"];
    const contentLength = rawContentLength === undefined ? null : Number(rawContentLength);
    const remaining = claim.size - currentOffset;
    if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > maxUploadChunkBytes || contentLength > remaining)) {
      throw new Error(`Upload chunks must be between 1 byte and ${maxUploadChunkBytes} bytes.`);
    }
    await ensureStorageCapacity(contentLength ?? Math.min(maxUploadChunkBytes, remaining));
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxUploadChunkBytes || bytes > remaining) return callback(new Error("Upload chunk exceeds the authorized media size."));
        callback(null, chunk);
      },
    });
    await pipeline(request, limiter, createWriteStream(partialMediaPath(claim.sourceId), { flags: "a" }));
    if (!bytes || (contentLength !== null && bytes !== contentLength)) throw new Error("Upload chunk did not match its declared size.");
    const offset = await existingUploadOffset(claim.sourceId);
    if (offset === claim.size) await finalizeUpload(claim);
    else {
      await writeJsonAtomic(uploadManifestPath(claim.sourceId), {
        sourceId: claim.sourceId,
        filename: claim.filename,
        size: claim.size,
        contentType: claim.contentType,
        offset,
        updatedAt: Date.now(),
      });
    }
    return { conflict: false, offset };
  } finally {
    activeUploads.delete(claim.sourceId);
  }
}

function streamMedia(request, response, media) {
  const total = Number(media.manifest.size);
  const range = request.headers.range;
  const baseHeaders = {
    "content-type": media.manifest.contentType || "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
  };
  if (!range) {
    response.writeHead(200, { ...baseHeaders, "content-length": total });
    createReadStream(media.path).pipe(response);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    response.writeHead(416, { ...baseHeaders, "content-range": `bytes */${total}` });
    response.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= total || end >= total) {
    response.writeHead(416, { ...baseHeaders, "content-range": `bytes */${total}` });
    response.end();
    return;
  }
  response.writeHead(206, { ...baseHeaders, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${total}` });
  createReadStream(media.path, { start, end }).pipe(response);
}

async function inputPathsFromManifest(manifest, outputDirectory) {
  if (!isCurrentAudioManifest(manifest)) return null;
  const segments = manifest.files.map((file) => ({
    ...file,
    path: join(outputDirectory, file.name),
  }));
  if (!(await Promise.all(segments.map(({ path }) => fileExists(path)))).every(Boolean)) return null;
  return {
    segments,
    plan: manifest.plan,
    segmentSeconds: Number(manifest.segmentSeconds) || 0,
    audioBytes: Number(manifest.audioBytes) || null,
    sourceDurationSeconds: Number(manifest.sourceDurationSeconds) || null,
  };
}

async function mediaDurationSeconds(path) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const durationSeconds = Number(stdout.trim());
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Could not determine the duration of this media source.");
  }
  return durationSeconds;
}

async function makeAudioInputs(sourcePath, outputDirectory) {
  const manifestPath = join(outputDirectory, "segments.json");
  const existingManifest = await readJsonFile(manifestPath);
  const existingInputs = await inputPathsFromManifest(existingManifest, outputDirectory);
  if (existingInputs) return existingInputs;

  const existing = await readdir(outputDirectory);
  await Promise.all([
    rm(manifestPath, { force: true }),
    ...existing
      // Also remove v2's `audio.ogg` and any older segment naming so a
      // restarted job cannot leave a large obsolete intermediate behind.
      .filter((name) => /^audio(?:-\d+)?\.(?:ogg|partial\.ogg)$/.test(name))
      .map((name) => rm(join(outputDirectory, name), { force: true })),
  ]);

  const sourceDurationSeconds = await mediaDurationSeconds(sourcePath);
  const segmentSeconds = transcriptionSegmentSeconds();
  const requestedPlan = audioPlanForDuration(sourceDurationSeconds, segmentSeconds);
  const output = join(outputDirectory, "audio-%03d.ogg");

  // Encode and segment in one pass. This deliberately never creates a full
  // derived-audio file before deciding to split: duration, not compressed file
  // size, is the provider safety boundary for long podcast recordings.
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath,
    "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k",
    "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1", output,
  ]);

  const names = (await readdir(outputDirectory))
    .filter((name) => /^audio-\d{3}\.ogg$/.test(name))
    .sort();
  if (!names.length) throw new Error("Could not prepare transcription audio segments.");

  let startSeconds = 0;
  const files = [];
  for (const name of names) {
    const path = join(outputDirectory, name);
    const [durationSeconds, details] = await Promise.all([
      mediaDurationSeconds(path),
      stat(path),
    ]);
    if (audioPlanForSize(details.size, singleAudioLimitBytes()) !== "single") {
      throw new Error("A prepared transcription segment exceeded the configured OpenAI input size limit.");
    }
    files.push({ name, startSeconds, durationSeconds, bytes: details.size });
    startSeconds += durationSeconds;
  }

  if (requestedPlan === "segmented" && files.length < 2) {
    throw new Error("Could not split this long recording into safe transcription segments.");
  }
  const plan = files.length === 1 ? "single" : "segmented";
  const audioBytes = files.reduce((total, file) => total + file.bytes, 0);
  const manifest = {
    version: AUDIO_INPUT_MANIFEST_VERSION,
    plan,
    files,
    segmentSeconds,
    sourceDurationSeconds,
    audioBytes,
  };
  await writeJsonAtomic(manifestPath, manifest);
  return inputPathsFromManifest(manifest, outputDirectory);
}

async function transcribeRequest(filePath, model, responseFormat, extra = [], context = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Media worker is missing OPENAI_API_KEY.");
  const buffer = await readFile(filePath);
  return withTransientRetries({
    maxAttempts: maxTranscriptionAttempts,
    attempt: async () => {
      const form = new FormData();
      form.append("file", new Blob([buffer], { type: "audio/ogg" }), "audio.ogg");
      form.append("model", model);
      form.append("response_format", responseFormat);
      for (const [key, value] of extra) form.append(key, value);
      let response;
      try {
        response = await fetch(OPENAI_TRANSCRIPT_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}` },
          body: form,
        });
      } catch (error) {
        throw requestError(`OpenAI ${model} request did not receive a response: ${describeError(error)}`, { retryable: true });
      }
      let body;
      try {
        body = await response.text();
      } catch (error) {
        throw requestError(`OpenAI ${model} response was interrupted: ${describeError(error)}`, { retryable: true });
      }
      let payload = null;
      if (body) {
        try {
          payload = JSON.parse(body);
        } catch (error) {
          if (response.ok) throw requestError(`OpenAI ${model} returned an unreadable response: ${describeError(error)}`, { retryable: true });
        }
      }
      if (!response.ok) {
        throw requestError(payload?.error?.message || `OpenAI transcription failed (${response.status}).`, {
          retryable: isRetryableStatus(response.status),
          retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
        });
      }
      return payload;
    },
    onRetry: async ({ attempt, nextAttempt, delayMs, error }) => {
      await context.onRetry?.({ attempt, nextAttempt, delayMs, error, model });
      console.warn(`[job ${context.jobId ?? "unknown"}] Retrying ${model} for chunk ${context.chunkNumber ?? "?"} after attempt ${attempt}/${maxTranscriptionAttempts}: ${describeError(error)}. Next attempt ${nextAttempt} in ${delayMs}ms.`);
    },
  });
}

function normalizeChunks(chunks) {
  const speakersByLabel = new Map();
  const speakerTurns = [];
  const words = [];
  const ensureSpeaker = (label) => {
    const normalized = label || "speaker_0";
    if (!speakersByLabel.has(normalized)) speakersByLabel.set(normalized, speakersByLabel.size);
    return speakersByLabel.get(normalized);
  };
  chunks.forEach(({ diarized, timed, startSeconds = 0 }, chunkIndex) => {
    const offset = startSeconds;
    const turns = Array.isArray(diarized?.segments) ? diarized.segments.map((segment) => ({
      start: Number(segment.start || 0) + offset,
      end: Number(segment.end || segment.start || 0) + offset,
      speaker: ensureSpeaker(segment.speaker),
      confidence: 1,
    })).filter((segment) => segment.end > segment.start) : [];
    speakerTurns.push(...turns);
    const wordsInChunk = Array.isArray(timed?.words) ? timed.words : [];
    wordsInChunk.forEach((word, wordIndex) => {
      const start = Number(word.start || 0) + offset;
      const end = Number(word.end || word.start || 0) + offset;
      const midpoint = (start + end) / 2;
      const turn = turns.find((item) => midpoint >= item.start && midpoint <= item.end);
      words.push({
        id: `worker-${chunkIndex}-${wordIndex}`,
        text: String(word.word || "").trim(),
        start,
        end: Math.max(start + 0.01, end),
        speaker: turn?.speaker ?? 0,
        deleted: false,
      });
    });
  });
  const speakers = [...speakersByLabel.entries()].map(([label, id]) => ({ id, name: label.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), color: ["#a8402f", "#31547d", "#5d6b2f", "#96650f", "#2f6b62"][id % 5] }));
  return { words: words.filter((word) => word.text), speakers: speakers.length ? speakers : [{ id: 0, name: "Speaker 1", color: "#31547d" }], speakerTurns };
}

async function processJob(job) {
  const workDirectory = jobDirectory(job);
  try {
    job.status = "processing";
    job.error = null;
    const metrics = ensureJobMetrics(job);
    await mkdir(workDirectory, { recursive: true });
    job.stage = "preparing";
    job.progress = 0.08;
    await persistJob(job);
    const { path: sourcePath } = await storedMedia(job);
    metrics.sourceBytes = (await stat(sourcePath)).size;
    job.stage = "extracting";
    job.progress = 0.15;
    await persistJob(job);
    const audioInputs = await makeAudioInputs(sourcePath, workDirectory);
    if (!audioInputs.segments.length) throw new Error("No audio track was found in this media source.");
    metrics.compressedAudioBytes = audioInputs.audioBytes;
    metrics.audioPlan = audioInputs.plan;
    metrics.audioInputCount = audioInputs.segments.length;
    metrics.sourceDurationSeconds = audioInputs.sourceDurationSeconds;
    metrics.segmentSeconds = audioInputs.segmentSeconds;
    await persistJob(job);

    const segments = audioInputs.segments;
    const chunks = [];
    const totalRequests = segments.length * 2;
    let completeRequests = 0;
    for (let index = 0; index < segments.length; index++) {
      const chunkNumber = index + 1;
      const chunkLabel = labelForChunk(chunkNumber, segments.length);
      const diarizedPath = join(workDirectory, `chunk-${String(index).padStart(3, "0")}-diarized.json`);
      const timedPath = join(workDirectory, `chunk-${String(index).padStart(3, "0")}-timed.json`);
      let diarized = await readJsonFile(diarizedPath);
      let timed = await readJsonFile(timedPath);
      if (diarized) completeRequests += 1;
      if (timed) completeRequests += 1;

      const pendingLabels = [!diarized && "speakers", !timed && "word timing"].filter(Boolean);
      job.stage = pendingLabels.length
        ? `transcribing ${chunkLabel} · ${pendingLabels.join(" + ")}`
        : `recovering ${chunkLabel}`;
      job.progress = 0.15 + (completeRequests / totalRequests) * 0.8;
      await persistJob(job);

      // The two requests are independent. Running them together removes the
      // serial wait without sacrificing recovery: each response is persisted
      // before the task resolves, so a restart retries only the missing half.
      const tasks = [];
      if (!diarized) {
        tasks.push((async () => {
          const startedAt = Date.now();
          const payload = await transcribeRequest(segments[index].path, "gpt-4o-transcribe-diarize", "diarized_json", [["chunking_strategy", "auto"]], {
            jobId: job.id,
            chunkNumber,
            onRetry: async ({ nextAttempt, delayMs }) => {
              job.stage = `retrying ${chunkLabel} · speakers (${nextAttempt})`;
              await persistJob(job);
              console.info(`[job ${job.id}] Waiting ${delayMs}ms before retrying speaker labels for ${chunkLabel}.`);
            },
          });
          await writeJsonAtomic(diarizedPath, payload);
          diarized = payload;
          completeRequests += 1;
          recordTranscriptionMetric(job, {
            model: "gpt-4o-transcribe-diarize",
            chunkNumber,
            durationMs: Date.now() - startedAt,
            inputBytes: segments[index].bytes,
            usage: payload?.usage ?? null,
            completedAt: Date.now(),
          });
          job.progress = 0.15 + (completeRequests / totalRequests) * 0.8;
          await persistJob(job);
        })());
      }
      if (!timed) {
        tasks.push((async () => {
          const startedAt = Date.now();
          const payload = await transcribeRequest(segments[index].path, "whisper-1", "verbose_json", [["timestamp_granularities[]", "word"]], {
            jobId: job.id,
            chunkNumber,
            onRetry: async ({ nextAttempt, delayMs }) => {
              job.stage = `retrying ${chunkLabel} · word timing (${nextAttempt})`;
              await persistJob(job);
              console.info(`[job ${job.id}] Waiting ${delayMs}ms before retrying word timing for ${chunkLabel}.`);
            },
          });
          await writeJsonAtomic(timedPath, payload);
          timed = payload;
          completeRequests += 1;
          recordTranscriptionMetric(job, {
            model: "whisper-1",
            chunkNumber,
            durationMs: Date.now() - startedAt,
            inputBytes: segments[index].bytes,
            usage: payload?.usage ?? null,
            completedAt: Date.now(),
          });
          job.progress = 0.15 + (completeRequests / totalRequests) * 0.8;
          await persistJob(job);
        })());
      }
      const outcomes = await Promise.allSettled(tasks);
      const failed = outcomes.find((outcome) => outcome.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      if (!diarized || !timed) throw new Error(`OpenAI did not return a complete transcription for ${chunkLabel}.`);
      chunks.push({ diarized, timed, startSeconds: segments[index].startSeconds });
      job.progress = 0.15 + (completeRequests / totalRequests) * 0.8;
      await persistJob(job);
    }
    job.stage = "finalizing";
    job.progress = 0.97;
    await persistJob(job);
    const result = normalizeChunks(chunks);
    if (!result.words.length) throw new Error("OpenAI did not return timed words for this source.");
    job.status = "complete";
    job.stage = "complete";
    job.progress = 1;
    job.result = result;
    await persistJob(job);
    console.info(`[job ${job.id}] Completed ${result.words.length} words from ${job.filename}`);
    await clearCompletedJobArtifacts(job).catch((cleanupError) => console.warn(`[job ${job.id}] Could not clear completed media artifacts: ${describeError(cleanupError)}`));
  } catch (error) {
    job.status = "error";
    job.stage = "error";
    job.error = error instanceof Error ? error.message : "Media worker failed.";
    await persistJob(job).catch((persistError) => console.error(`[job ${job.id}] Could not save failure checkpoint: ${describeError(persistError)}`));
    console.error(`[job ${job.id}] Failed: ${job.error}`);
  }
}

async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;
  try {
    while (pendingJobs.length) {
      const job = pendingJobs.shift();
      if (job) await processJob(job);
    }
  } finally {
    processingQueue = false;
  }
}

function enqueueJob(job) {
  pendingJobs.push(job);
  void processQueue();
}

async function clearCompletedJobArtifacts(job) {
  const directory = jobDirectory(job);
  const entries = await readdir(directory);
  await Promise.all(entries
    .filter((name) => name !== "job.json")
    .map((name) => rm(join(directory, name), { recursive: true, force: true })));
}

async function pruneExpiredJobs() {
  const entries = await readdir(jobRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-zA-Z0-9-]+$/.test(entry.name)) continue;
    const job = await readJsonFile(join(jobRoot, entry.name, "job.json"));
    if (!job || !Number.isFinite(job.updatedAt) || Date.now() - job.updatedAt <= jobRetentionMs) continue;
    await rm(join(jobRoot, entry.name), { recursive: true, force: true });
    jobs.delete(entry.name);
    console.info(`[job ${entry.name}] Pruned expired worker checkpoint.`);
  }
}

async function restoreJobs() {
  await mkdir(jobRoot, { recursive: true });
  const entries = await readdir(jobRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-zA-Z0-9-]+$/.test(entry.name)) continue;
    const job = await readJsonFile(join(jobRoot, entry.name, "job.json"));
    if (!job || job.id !== entry.name || typeof job.sourceId !== "string" || !sourceIdPattern.test(job.sourceId) || typeof job.filename !== "string") continue;
    if (Number.isFinite(job.updatedAt) && Date.now() - job.updatedAt > jobRetentionMs) {
      await rm(join(jobRoot, entry.name), { recursive: true, force: true });
      continue;
    }
    jobs.set(job.id, job);
    if (job.status === "queued" || job.status === "processing") {
      job.status = "queued";
      job.stage = "resuming";
      job.error = null;
      await persistJob(job);
      enqueueJob(job);
      console.info(`[job ${job.id}] Restored from durable checkpoint.`);
    }
  }
}

const server = createServer(async (request, response) => {
  setCors(request, response);
  if (request.method === "OPTIONS") return response.writeHead(204).end();
  const url = new URL(request.url || "/", "http://opencast-worker.local");
  const pathname = url.pathname;
  if (request.method === "GET" && pathname === "/health") return respond(response, 200, { ok: true });

  if (request.method === "POST" && pathname === "/uploads") {
    try {
      const claim = readUploadTicket(request);
      const upload = await prepareUpload(claim);
      return respond(response, 200, { offset: upload.offset, complete: upload.complete });
    } catch (error) {
      return respond(response, 400, { error: error instanceof Error ? error.message : "Could not prepare the Fly media upload." });
    }
  }

  if (request.method === "HEAD" && pathname === "/uploads") {
    try {
      const claim = readUploadTicket(request);
      const upload = await prepareUpload(claim);
      response.writeHead(204, { "upload-offset": upload.offset, "upload-length": claim.size, "cache-control": "no-store" });
      return response.end();
    } catch (error) {
      return respond(response, 400, { error: error instanceof Error ? error.message : "Could not inspect the Fly media upload." });
    }
  }

  if (request.method === "PATCH" && pathname === "/uploads") {
    try {
      const claim = readUploadTicket(request);
      const headerOffset = Number(request.headers["upload-offset"]);
      if (!Number.isSafeInteger(headerOffset) || headerOffset < 0) throw new Error("A valid upload offset is required.");
      const upload = await prepareUpload(claim);
      if (upload.complete) {
        response.writeHead(204, { "upload-offset": claim.size, "upload-length": claim.size, "cache-control": "no-store" });
        return response.end();
      }
      if (upload.offset !== headerOffset) return respond(response, 409, { error: "Upload offset has changed. Resume from the returned offset.", offset: upload.offset });
      const written = await writeUploadChunk(request, claim, headerOffset);
      if (written.conflict) return respond(response, 409, { error: "Another upload chunk is active. Resume from the returned offset.", offset: written.offset });
      response.writeHead(204, { "upload-offset": written.offset, "upload-length": claim.size, "cache-control": "no-store" });
      return response.end();
    } catch (error) {
      return respond(response, 400, { error: error instanceof Error ? error.message : "Could not store the Fly media upload." });
    }
  }

  const mediaMatch = (request.method === "GET" || request.method === "HEAD") ? pathname.match(/^\/media\/([a-zA-Z0-9-]+)$/) : null;
  if (mediaMatch) {
    try {
      const claim = readMediaTicket(url.searchParams.get("ticket"));
      if (claim.sourceId !== mediaMatch[1]) return respond(response, 403, { error: "This media ticket cannot access the requested source." });
      const media = await storedMedia(claim);
      if (request.method === "HEAD") {
        response.writeHead(200, {
          "content-type": media.manifest.contentType || "application/octet-stream",
          "content-length": media.manifest.size,
          "accept-ranges": "bytes",
          "cache-control": "private, no-store",
        });
        return response.end();
      }
      return streamMedia(request, response, media);
    } catch (error) {
      return respond(response, 404, { error: error instanceof Error ? error.message : "Stored media was not found." });
    }
  }

  if (request.method === "POST" && pathname === "/jobs") {
    try {
      const body = await readJson(request);
      const claim = readJobTicket(body.ticket);
      const now = Date.now();
      await storedMedia(claim);
      const job = { id: crypto.randomUUID(), sourceId: claim.sourceId, filename: claim.filename, status: "queued", stage: "queued", progress: 0, error: null, result: null, createdAt: now, updatedAt: now };
      await persistJob(job);
      jobs.set(job.id, job);
      enqueueJob(job);
      return respond(response, 202, { id: job.id, status: job.status });
    } catch (error) {
      return respond(response, 400, { error: error instanceof Error ? error.message : "Invalid job request." });
    }
  }
  const retryMatch = request.method === "POST" ? pathname.match(/^\/jobs\/([a-zA-Z0-9-]+)\/retry$/) : null;
  if (retryMatch) {
    try {
      const body = await readJson(request);
      const claim = readJobTicket(body.ticket);
      const job = jobs.get(retryMatch[1]);
      if (!job) return respond(response, 404, { error: "Job not found or expired." });
      if (job.status !== "error") return respond(response, 409, { error: "Only failed jobs can be resumed." });
      if (job.sourceId !== claim.sourceId || job.filename !== claim.filename) {
        return respond(response, 403, { error: "This ticket cannot resume the requested job." });
      }
      job.status = "queued";
      job.stage = "resuming";
      job.error = null;
      await persistJob(job);
      enqueueJob(job);
      return respond(response, 202, { id: job.id, status: job.status, resumed: true });
    } catch (error) {
      return respond(response, 400, { error: error instanceof Error ? error.message : "Could not resume the media worker job." });
    }
  }
  const match = request.method === "GET" ? pathname.match(/^\/jobs\/([a-zA-Z0-9-]+)$/) : null;
  if (match) {
    const job = jobs.get(match[1]);
    return job ? respond(response, 200, jobView(job)) : respond(response, 404, { error: "Job not found or expired." });
  }
  respond(response, 404, { error: "Not found." });
});

async function start() {
  try {
    await restoreJobs();
  } catch (error) {
    console.error(`Could not restore media worker jobs: ${describeError(error)}`);
  }
  server.listen(port, () => console.log(`OpenCast media worker listening on :${port}`));
  setInterval(() => void pruneExpiredJobs().catch((error) => console.warn(`Could not prune expired jobs: ${describeError(error)}`)), 60 * 60 * 1000).unref();
}

void start();
