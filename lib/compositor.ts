"use client";

import { captionWindow } from "./captions";
import { createBackgroundRemover, type BackgroundRemover } from "./segmentation";
import type { ImageOverlay, MediaKind, TimeRange, Word } from "./types";

/**
 * The composed render: play the kept ranges of the source once, drawing every
 * frame through the layer stack — under-image, footage (optionally with its
 * background removed), over-image, burned-in captions — and record the canvas
 * plus the source audio to a WebM that YouTube accepts directly. Rendering is
 * realtime (a 40-second clip takes ~40 seconds), which fits clips and hooks.
 */
export type ComposeOptions = {
  src: string;
  kind: MediaKind;
  keepRanges: TimeRange[];
  words: Word[];
  captionsEnabled: boolean;
  overlays: ImageOverlay[];
  backgroundRemoval: boolean;
  onProgress?: (fraction: number, note: string) => void;
};

const MAX_WIDTH = 1280;
const FRAME_RATE = 30;
const INK = "oklch(17% 0.024 32)";
const BONE = "oklch(97% 0.012 78)";
const RED = "oklch(52% 0.2 25)";

function pickMimeType(): string {
  for (const candidate of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

async function loadOverlayImages(overlays: ImageOverlay[]): Promise<Map<string, HTMLImageElement>> {
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(overlays.map((overlay) => new Promise<void>((resolve) => {
    const image = new Image();
    // Without CORS approval the canvas would taint and recording would fail,
    // so non-CORS images are skipped rather than breaking the whole render.
    image.crossOrigin = "anonymous";
    image.onload = () => { images.set(overlay.id, image); resolve(); };
    image.onerror = () => resolve();
    image.src = overlay.url;
  })));
  return images;
}

function drawCaptions(ctx: CanvasRenderingContext2D, words: Word[], time: number, width: number, height: number) {
  const caption = captionWindow(words, time);
  if (!caption.words.length) return;
  const fontSize = Math.max(18, Math.round(height * 0.052));
  ctx.font = `600 ${fontSize}px "Bricolage Grotesque", system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  const padX = Math.round(fontSize * 0.38);
  const gap = Math.round(fontSize * 0.28);
  const chips = caption.words.map((word) => ({
    word,
    width: Math.ceil(ctx.measureText(word.text).width) + padX * 2,
  }));
  let visible = chips;
  while (visible.length > 1 && visible.reduce((total, chip) => total + chip.width + gap, -gap) > width * 0.86) {
    visible = visible.slice(1);
  }
  const totalWidth = visible.reduce((total, chip) => total + chip.width + gap, -gap);
  let x = (width - totalWidth) / 2;
  const y = height - Math.round(height * 0.11);
  const chipHeight = Math.round(fontSize * 1.55);
  for (const { word, width: chipWidth } of visible) {
    ctx.fillStyle = word.id === caption.activeId ? RED : "rgba(26, 20, 18, 0.85)";
    ctx.fillRect(x, y - chipHeight / 2, chipWidth, chipHeight);
    ctx.fillStyle = BONE;
    ctx.fillText(word.text, x + padX, y + fontSize * 0.04);
    x += chipWidth + gap;
  }
}

export async function renderComposedMedia({ src, kind, keepRanges, words, captionsEnabled, overlays, backgroundRemoval, onProgress }: ComposeOptions): Promise<Blob> {
  const ranges = keepRanges.filter((range) => range.end - range.start > 0.05);
  if (!ranges.length) throw new Error("There is nothing to render — every range is cut.");
  const totalSeconds = ranges.reduce((total, range) => total + range.end - range.start, 0);

  onProgress?.(0.01, "loading media");
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.src = src;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("The source media could not be loaded for rendering."));
  });

  const sourceWidth = kind === "video" && video.videoWidth ? video.videoWidth : 1280;
  const sourceHeight = kind === "video" && video.videoHeight ? video.videoHeight : 720;
  const scale = Math.min(1, MAX_WIDTH / sourceWidth);
  const width = Math.round(sourceWidth * scale / 2) * 2;
  const height = Math.round(sourceHeight * scale / 2) * 2;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  await document.fonts.ready.catch(() => undefined);
  const images = await loadOverlayImages(overlays);
  let remover: BackgroundRemover | null = null;
  if (backgroundRemoval && kind === "video") {
    onProgress?.(0.03, "loading the background model");
    remover = await createBackgroundRemover();
  }

  const audioContext = new AudioContext();
  const audioSource = audioContext.createMediaElementSource(video);
  const audioDestination = audioContext.createMediaStreamDestination();
  audioSource.connect(audioDestination); // stream only; nothing to the speakers

  const canvasStream = canvas.captureStream(FRAME_RATE);
  const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
  const chunks: BlobPart[] = [];
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };

  const overlayAt = (time: number, layer: "under" | "over") =>
    overlays.findLast((overlay) => overlay.layer === layer && time >= overlay.start && time <= overlay.end && images.has(overlay.id));

  const drawFrame = (time: number) => {
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, width, height);
    const under = overlayAt(time, "under");
    if (under) ctx.drawImage(images.get(under.id)!, 0, 0, width, height);
    if (kind === "video") {
      if (remover) remover.draw(ctx, video, video.videoWidth, video.videoHeight, width, height);
      else ctx.drawImage(video, 0, 0, width, height);
    }
    const over = overlayAt(time, "over");
    if (over) ctx.drawImage(images.get(over.id)!, 0, 0, width, height);
    if (captionsEnabled) drawCaptions(ctx, words, time, width, height);
  };

  return await new Promise<Blob>((resolve, reject) => {
    let rangeIndex = 0;
    let renderedBefore = 0;
    let frame = 0;
    let finished = false;

    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      video.pause();
      recorder.onstop = () => {
        void audioContext.close().catch(() => undefined);
        if (error) reject(error);
        else resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
      };
      if (recorder.state !== "inactive") recorder.stop();
      else recorder.onstop?.(new Event("stop") as never);
    };

    const step = () => {
      if (finished) return;
      const range = ranges[rangeIndex];
      const time = video.currentTime;
      drawFrame(time);
      onProgress?.(Math.min(0.99, (renderedBefore + Math.max(0, time - range.start)) / totalSeconds), "rendering");
      if (time >= range.end - 0.03 || video.ended) {
        renderedBefore += range.end - range.start;
        rangeIndex += 1;
        if (rangeIndex >= ranges.length) { finish(); return; }
        video.currentTime = ranges[rangeIndex].start;
      }
      frame = requestAnimationFrame(step);
    };

    // A hard ceiling so a stalled decode can never hang the export forever.
    const watchdog = window.setTimeout(() => finish(new Error("Rendering timed out.")), (totalSeconds + 30) * 1000);
    video.onseeked = () => {
      if (recorder.state === "inactive") {
        recorder.start(500);
        void video.play().catch(() => finish(new Error("Playback for rendering was blocked.")));
        frame = requestAnimationFrame(step);
      }
    };
    video.onerror = () => { window.clearTimeout(watchdog); finish(new Error("The source media failed during rendering.")); };
    video.currentTime = Math.max(0.01, ranges[0].start);
  });
}
