import { createServer } from "node:http";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { audioPlanForSize, labelForChunk, singleAudioLimitBytes } from "./mediaPlan.mjs";
import { isRetryableStatus, withTransientRetries } from "./retry.mjs";

const run = promisify(execFile);
const port = Number(process.env.PORT || 8080);
const workRoot = process.env.OPENCAST_WORK_DIR || tmpdir();
const jobRoot = join(workRoot, "opencast-jobs");
const jobs = new Map();
const pendingJobs = [];
let processingQueue = false;
const OPENAI_TRANSCRIPT_URL = "https://api.openai.com/v1/audio/transcriptions";
const maxTranscriptionAttempts = Math.max(1, Math.min(Number(process.env.OPENCAST_TRANSCRIPTION_MAX_ATTEMPTS || 4), 8));
const jobRetentionMs = Math.max(60 * 60 * 1000, Number(process.env.OPENCAST_JOB_RETENTION_MS || 24 * 60 * 60 * 1000));

function respond(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function setCors(response) {
  response.setHeader("access-control-allow-origin", process.env.CORS_ORIGIN || "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
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

function allowedSourceUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const configured = (process.env.ALLOWED_MEDIA_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (configured.length) return configured.includes(url.origin);
    return url.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function readJobTicket(value) {
  const secret = process.env.OPENCAST_WORKER_SIGNING_SECRET;
  if (!secret) throw new Error("Media worker authorization is not configured.");
  if (typeof value !== "string") throw new Error("A media worker job ticket is required.");
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
  if (!allowedSourceUrl(claim?.sourceUrl) || typeof claim?.filename !== "string" || typeof claim?.sourceId !== "string") {
    throw new Error("Media worker job ticket is invalid.");
  }
  if (!Number.isFinite(claim.expiresAt) || claim.expiresAt <= Date.now() || claim.expiresAt > Date.now() + 15 * 60 * 1000) {
    throw new Error("Media worker job ticket has expired.");
  }
  return claim;
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
    sourceUrl: job.sourceUrl,
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

async function downloadSource(url, path, jobId) {
  const partialPath = `${path}.part`;
  const maxDownloadAttempts = 4;
  await withTransientRetries({
    maxAttempts: maxDownloadAttempts,
    attempt: async () => {
      await rm(partialPath, { force: true });
      let response;
      try {
        response = await fetch(url);
      } catch (error) {
        throw requestError(`Source download did not receive a response: ${describeError(error)}`, { retryable: true });
      }
      if (!response.ok || !response.body) {
        throw requestError(`Could not download source media (${response.status}).`, {
          retryable: isRetryableStatus(response.status),
          retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
        });
      }
      try {
        await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath));
      } catch (error) {
        throw requestError(`Source download interrupted: ${describeError(error)}`, { retryable: true });
      }
    },
    onRetry: ({ attempt, nextAttempt, delayMs, error }) => console.warn(`[job ${jobId}] Retrying source download after attempt ${attempt}/${maxDownloadAttempts}: ${describeError(error)}. Next attempt ${nextAttempt} in ${delayMs}ms.`),
  });
  await rename(partialPath, path);
}

async function inputPathsFromManifest(manifest, outputDirectory) {
  if (!Array.isArray(manifest?.files) || !manifest.files.length) return null;
  const paths = manifest.files.map((name) => join(outputDirectory, name));
  if (!(await Promise.all(paths.map((path) => fileExists(path)))).every(Boolean)) return null;
  return {
    paths,
    plan: manifest.plan === "single" ? "single" : "segmented",
    segmentSeconds: Number(manifest.segmentSeconds ?? manifest.seconds ?? 0) || 0,
    audioBytes: Number(manifest.audioBytes) || null,
  };
}

async function makeAudioInputs(sourcePath, outputDirectory) {
  const manifestPath = join(outputDirectory, "segments.json");
  const existingManifest = await readJsonFile(manifestPath);
  const existingInputs = await inputPathsFromManifest(existingManifest, outputDirectory);
  if (existingInputs) return existingInputs;

  const existing = await readdir(outputDirectory);
  await Promise.all(existing.filter((name) => /^audio(?:-\d+)?\.(?:ogg|partial\.ogg)$/.test(name)).map((name) => rm(join(outputDirectory, name), { force: true })));

  const temporarySingle = join(outputDirectory, "audio.partial.ogg");
  const singleAudio = join(outputDirectory, "audio.ogg");
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath,
    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k",
    temporarySingle,
  ]);
  await rename(temporarySingle, singleAudio);

  const audioBytes = (await stat(singleAudio)).size;
  const plan = audioPlanForSize(audioBytes, singleAudioLimitBytes());
  if (plan === "single") {
    await writeJsonAtomic(manifestPath, { version: 2, plan, files: ["audio.ogg"], segmentSeconds: 0, audioBytes });
    return { paths: [singleAudio], plan, segmentSeconds: 0, audioBytes };
  }

  const segmentSeconds = Math.max(60, Math.min(Number(process.env.OPENCAST_SEGMENT_SECONDS || 300), 1_800));
  const output = join(outputDirectory, "audio-%03d.ogg");
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", singleAudio,
    "-c:a", "copy", "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1", output,
  ]);
  const files = (await readdir(outputDirectory)).filter((name) => /^audio-\d+\.ogg$/.test(name)).sort();
  if (!files.length) throw new Error("Could not prepare transcription audio segments.");
  await writeJsonAtomic(manifestPath, { version: 2, plan, files, segmentSeconds, audioBytes });
  return { paths: files.map((name) => join(outputDirectory, name)), plan, segmentSeconds, audioBytes };
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

function normalizeChunks(chunks, segmentSeconds) {
  const speakersByLabel = new Map();
  const speakerTurns = [];
  const words = [];
  const ensureSpeaker = (label) => {
    const normalized = label || "speaker_0";
    if (!speakersByLabel.has(normalized)) speakersByLabel.set(normalized, speakersByLabel.size);
    return speakersByLabel.get(normalized);
  };
  chunks.forEach(({ diarized, timed }, chunkIndex) => {
    const offset = chunkIndex * segmentSeconds;
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
    const extension = extname(job.filename || new URL(job.sourceUrl).pathname) || ".media";
    const sourcePath = join(workDirectory, `source${extension.replace(/[^.a-zA-Z0-9]/g, "")}`);
    if (!await fileExists(sourcePath)) {
      job.stage = "downloading";
      job.progress = 0.03;
      await persistJob(job);
      console.info(`[job ${job.id}] Downloading ${job.filename}`);
      await downloadSource(job.sourceUrl, sourcePath, job.id);
    }
    metrics.sourceBytes = (await stat(sourcePath)).size;
    job.stage = "extracting";
    job.progress = 0.15;
    await persistJob(job);
    const audioInputs = await makeAudioInputs(sourcePath, workDirectory);
    if (!audioInputs.paths.length) throw new Error("No audio track was found in this media source.");
    metrics.compressedAudioBytes = audioInputs.audioBytes;
    metrics.audioPlan = audioInputs.plan;
    metrics.audioInputCount = audioInputs.paths.length;
    await persistJob(job);

    const segments = audioInputs.paths;
    const segmentSeconds = audioInputs.segmentSeconds;
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
          const payload = await transcribeRequest(segments[index], "gpt-4o-transcribe-diarize", "diarized_json", [["chunking_strategy", "auto"]], {
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
            inputBytes: (await stat(segments[index])).size,
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
          const payload = await transcribeRequest(segments[index], "whisper-1", "verbose_json", [["timestamp_granularities[]", "word"]], {
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
            inputBytes: (await stat(segments[index])).size,
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
      chunks.push({ diarized, timed });
      job.progress = 0.15 + (completeRequests / totalRequests) * 0.8;
      await persistJob(job);
    }
    job.stage = "finalizing";
    job.progress = 0.97;
    await persistJob(job);
    const result = normalizeChunks(chunks, segmentSeconds);
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
    if (!job || job.id !== entry.name || typeof job.sourceUrl !== "string" || typeof job.sourceId !== "string" || typeof job.filename !== "string") continue;
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
  setCors(response);
  if (request.method === "OPTIONS") return response.writeHead(204).end();
  if (request.method === "GET" && request.url === "/health") return respond(response, 200, { ok: true });
  if (request.method === "POST" && request.url === "/jobs") {
    try {
      const body = await readJson(request);
      const claim = readJobTicket(body.ticket);
      const now = Date.now();
      const job = { id: crypto.randomUUID(), sourceUrl: claim.sourceUrl, sourceId: claim.sourceId, filename: claim.filename, status: "queued", stage: "queued", progress: 0, error: null, result: null, createdAt: now, updatedAt: now };
      await persistJob(job);
      jobs.set(job.id, job);
      enqueueJob(job);
      return respond(response, 202, { id: job.id, status: job.status });
    } catch (error) {
      return respond(response, 400, { error: error instanceof Error ? error.message : "Invalid job request." });
    }
  }
  const retryMatch = request.method === "POST" ? request.url?.match(/^\/jobs\/([a-zA-Z0-9-]+)\/retry$/) : null;
  if (retryMatch) {
    try {
      const body = await readJson(request);
      const claim = readJobTicket(body.ticket);
      const job = jobs.get(retryMatch[1]);
      if (!job) return respond(response, 404, { error: "Job not found or expired." });
      if (job.status !== "error") return respond(response, 409, { error: "Only failed jobs can be resumed." });
      if (job.sourceUrl !== claim.sourceUrl || job.sourceId !== claim.sourceId || job.filename !== claim.filename) {
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
  const match = request.method === "GET" ? request.url?.match(/^\/jobs\/([a-zA-Z0-9-]+)$/) : null;
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
