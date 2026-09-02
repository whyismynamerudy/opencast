import { createServer } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const run = promisify(execFile);
const port = Number(process.env.PORT || 8080);
const jobs = new Map();
const OPENAI_TRANSCRIPT_URL = "https://api.openai.com/v1/audio/transcriptions";

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

function jobView(job) {
  return job.status === "complete"
    ? { id: job.id, status: job.status, progress: 1, result: job.result }
    : { id: job.id, status: job.status, progress: job.progress, ...(job.error ? { error: job.error } : {}) };
}

async function downloadSource(url, path) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Could not download source media (${response.status}).`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
}

async function makeAudioSegments(sourcePath, outputDirectory) {
  const seconds = Math.max(60, Math.min(Number(process.env.OPENCAST_SEGMENT_SECONDS || 600), 1_800));
  const output = join(outputDirectory, "audio-%03d.ogg");
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath,
    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k",
    "-f", "segment", "-segment_time", String(seconds), "-reset_timestamps", "1", output,
  ]);
  return (await readdir(outputDirectory)).filter((name) => /^audio-\d+\.ogg$/.test(name)).sort().map((name) => join(outputDirectory, name));
}

async function transcribeRequest(filePath, model, responseFormat, extra = []) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Media worker is missing OPENAI_API_KEY.");
  const buffer = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/ogg" }), "audio.ogg");
  form.append("model", model);
  form.append("response_format", responseFormat);
  for (const [key, value] of extra) form.append(key, value);
  const response = await fetch(OPENAI_TRANSCRIPT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI transcription failed (${response.status}).`);
  return payload;
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
  const speakers = [...speakersByLabel.entries()].map(([label, id]) => ({ id, name: label.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), color: ["#dd6953", "#6e9cdb", "#a477d4", "#d6a540", "#4da58a"][id % 5] }));
  return { words: words.filter((word) => word.text), speakers: speakers.length ? speakers : [{ id: 0, name: "Speaker 1", color: "#6e9cdb" }], speakerTurns };
}

async function processJob(job) {
  let workDirectory;
  try {
    job.status = "processing";
    job.progress = 0.03;
    workDirectory = await mkdtemp(join(tmpdir(), "opencast-"));
    const extension = extname(job.filename || new URL(job.sourceUrl).pathname) || ".media";
    const sourcePath = join(workDirectory, `source${extension.replace(/[^.a-zA-Z0-9]/g, "")}`);
    await downloadSource(job.sourceUrl, sourcePath);
    job.progress = 0.15;
    const segments = await makeAudioSegments(sourcePath, workDirectory);
    if (!segments.length) throw new Error("No audio track was found in this media source.");
    const segmentSeconds = Math.max(60, Math.min(Number(process.env.OPENCAST_SEGMENT_SECONDS || 600), 1_800));
    const chunks = [];
    for (let index = 0; index < segments.length; index++) {
      const [diarized, timed] = await Promise.all([
        transcribeRequest(segments[index], "gpt-4o-transcribe-diarize", "diarized_json", [["chunking_strategy", "auto"]]),
        transcribeRequest(segments[index], "whisper-1", "verbose_json", [["timestamp_granularities[]", "word"]]),
      ]);
      chunks.push({ diarized, timed });
      job.progress = 0.15 + ((index + 1) / segments.length) * 0.8;
    }
    const result = normalizeChunks(chunks, segmentSeconds);
    if (!result.words.length) throw new Error("OpenAI did not return timed words for this source.");
    job.status = "complete";
    job.progress = 1;
    job.result = result;
  } catch (error) {
    job.status = "error";
    job.error = error instanceof Error ? error.message : "Media worker failed.";
  } finally {
    if (workDirectory) await rm(workDirectory, { recursive: true, force: true });
  }
}

const server = createServer(async (request, response) => {
  setCors(response);
  if (request.method === "OPTIONS") return response.writeHead(204).end();
  if (request.method === "GET" && request.url === "/health") return respond(response, 200, { ok: true });
  if (request.method === "POST" && request.url === "/jobs") {
    try {
      const body = await readJson(request);
      if (typeof body.sourceUrl !== "string" || !allowedSourceUrl(body.sourceUrl)) return respond(response, 400, { error: "sourceUrl must be an allowed HTTPS project-media URL." });
      const job = { id: crypto.randomUUID(), sourceUrl: body.sourceUrl, filename: typeof body.filename === "string" ? body.filename : "source.media", status: "queued", progress: 0, error: null, result: null };
      jobs.set(job.id, job);
      void processJob(job);
      setTimeout(() => jobs.delete(job.id), 60 * 60 * 1000).unref();
      return respond(response, 202, { id: job.id, status: job.status });
    } catch (error) {
      return respond(response, 400, { error: error instanceof Error ? error.message : "Invalid job request." });
    }
  }
  const match = request.method === "GET" ? request.url?.match(/^\/jobs\/([a-zA-Z0-9-]+)$/) : null;
  if (match) {
    const job = jobs.get(match[1]);
    return job ? respond(response, 200, jobView(job)) : respond(response, 404, { error: "Job not found or expired." });
  }
  respond(response, 404, { error: "Not found." });
});

server.listen(port, () => console.log(`OpenCast media worker listening on :${port}`));
