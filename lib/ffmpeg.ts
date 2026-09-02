"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { MediaKind, TimeRange } from "./types";
import { TRANSCRIPTION_SAMPLE_RATE } from "./audio";

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

async function loadFfmpeg(onProgress?: (ratio: number) => void): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg;
  if (loading) return loading;

  loading = (async () => {
    const instance = new FFmpeg();
    instance.on("progress", ({ progress }) => onProgress?.(progress));
    const base = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
    await instance.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpeg = instance;
    return instance;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export async function renderCutMedia({
  file,
  kind,
  keepRanges,
  format,
  onProgress,
}: {
  file: File;
  kind: MediaKind;
  keepRanges: TimeRange[];
  format: "mp4" | "mp3";
  onProgress?: (ratio: number) => void;
}): Promise<Blob> {
  if (!keepRanges.length) throw new Error("There is no media left to export.");
  const engine = await loadFfmpeg(onProgress);
  const input = `input-${crypto.randomUUID()}.${file.name.split(".").pop() || "media"}`;
  const output = `opencast-${crypto.randomUUID()}.${format}`;
  await engine.writeFile(input, await fetchFile(file));

  try {
    const isAudio = kind === "audio" || format === "mp3";
    const filter = isAudio
      ? audioFilter(keepRanges)
      : videoFilter(keepRanges);
    const map = isAudio ? ["-map", "[outa]", "-c:a", "libmp3lame", "-b:a", "192k"] : ["-map", "[outv]", "-map", "[outa]", "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart"];
    const exitCode = await engine.exec(["-i", input, "-filter_complex", filter, ...map, output]);
    if (exitCode !== 0) throw new Error("The local render engine could not complete this export.");
    const data = await engine.readFile(output);
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const ownedBytes = new Uint8Array(bytes.byteLength);
    ownedBytes.set(bytes);
    return new Blob([ownedBytes.buffer], { type: isAudio ? "audio/mpeg" : "video/mp4" });
  } finally {
    await engine.deleteFile(input).catch(() => undefined);
    await engine.deleteFile(output).catch(() => undefined);
  }
}

/** Decode any browser-supported audio/video file into mono 16 kHz Float32 PCM. */
export async function extractMono16kPcm(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<Float32Array> {
  const engine = await loadFfmpeg(onProgress);
  const extension = file.name.split(".").pop() || "media";
  const input = `source-${crypto.randomUUID()}.${extension}`;
  const output = `audio-${crypto.randomUUID()}.f32`;
  await engine.writeFile(input, await fetchFile(file));
  try {
    const exitCode = await engine.exec([
      "-i", input,
      "-vn",
      "-ac", "1",
      "-ar", String(TRANSCRIPTION_SAMPLE_RATE),
      "-f", "f32le",
      output,
    ]);
    if (exitCode !== 0) throw new Error("OpenCast could not decode this recording to mono 16 kHz audio.");
    const data = await engine.readFile(output);
    if (typeof data === "string") throw new Error("The audio extraction engine returned text instead of PCM audio.");
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    return new Float32Array(bytes.buffer);
  } finally {
    await engine.deleteFile(input).catch(() => undefined);
    await engine.deleteFile(output).catch(() => undefined);
  }
}

function audioFilter(ranges: TimeRange[]): string {
  const segments = ranges.map((range, index) =>
    `[0:a]atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS[a${index}]`,
  );
  const inputs = ranges.map((_, index) => `[a${index}]`).join("");
  return `${segments.join(";")};${inputs}concat=n=${ranges.length}:v=0:a=1[outa]`;
}

function videoFilter(ranges: TimeRange[]): string {
  const segments = ranges.flatMap((range, index) => [
    `[0:v]trim=start=${range.start}:end=${range.end},setpts=PTS-STARTPTS[v${index}]`,
    `[0:a]atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS[a${index}]`,
  ]);
  const inputs = ranges.map((_, index) => `[v${index}][a${index}]`).join("");
  return `${segments.join(";")};${inputs}concat=n=${ranges.length}:v=1:a=1[outv][outa]`;
}
