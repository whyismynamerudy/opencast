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

/** Prefer MP4 (H.264/AAC) where the browser can record it; WebM otherwise. */
function pickContainer(): { mimeType: string; extension: "mp4" | "webm" } {
  const candidates: Array<{ mimeType: string; extension: "mp4" | "webm" }> = [
    { mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", extension: "mp4" },
    { mimeType: "video/mp4", extension: "mp4" },
    { mimeType: "video/webm;codecs=vp9,opus", extension: "webm" },
    { mimeType: "video/webm;codecs=vp8,opus", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" },
  ];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate.mimeType)) return candidate;
  }
  return { mimeType: "", extension: "webm" };
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

export type ComposedRender = { blob: Blob; extension: "mp4" | "webm" };

export async function renderComposedMedia({ src, kind, keepRanges, words, captionsEnabled, overlays, backgroundRemoval, onProgress }: ComposeOptions): Promise<ComposedRender> {
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

  // Frames are pushed explicitly from a Worker-timed loop: browsers freeze
  // requestAnimationFrame (and throttle main-thread timers) in hidden tabs,
  // which used to freeze the picture and captions if the person switched
  // away during a realtime render. Worker timers keep ticking.
  const canvasStream = canvas.captureStream(0);
  const canvasTrack = canvasStream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
  const chunks: BlobPart[] = [];
  const { mimeType, extension } = pickContainer();
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

  const tickerUrl = URL.createObjectURL(new Blob(
    [`setInterval(() => postMessage(0), ${Math.max(10, Math.round(1000 / FRAME_RATE))});`],
    { type: "text/javascript" },
  ));
  const ticker = new Worker(tickerUrl);

  return await new Promise<ComposedRender>((resolve, reject) => {
    let rangeIndex = 0;
    let renderedBefore = 0;
    let finished = false;
    let lastMediaTime = -1;
    let lastAdvanceAt = performance.now();

    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      ticker.terminate();
      URL.revokeObjectURL(tickerUrl);
      window.clearInterval(watchdog);
      video.pause();
      recorder.onstop = () => {
        void audioContext.close().catch(() => undefined);
        if (error) reject(error);
        else resolve({ blob: new Blob(chunks, { type: mimeType || "video/webm" }), extension });
      };
      if (recorder.state !== "inactive") recorder.stop();
      else recorder.onstop?.(new Event("stop") as never);
    };

    const step = () => {
      if (finished || recorder.state !== "recording") return;
      const range = ranges[rangeIndex];
      const time = video.currentTime;
      if (time > lastMediaTime + 0.005) {
        lastMediaTime = time;
        lastAdvanceAt = performance.now();
      }
      drawFrame(time);
      canvasTrack.requestFrame?.();
      onProgress?.(Math.min(0.99, (renderedBefore + Math.max(0, time - range.start)) / totalSeconds), "rendering");
      if (time >= range.end - 0.03 || video.ended) {
        renderedBefore += range.end - range.start;
        rangeIndex += 1;
        if (rangeIndex >= ranges.length) { finish(); return; }
        video.currentTime = ranges[rangeIndex].start;
      }
    };
    ticker.onmessage = step;

    // Heavily edited episodes seek across dozens of cut boundaries over the
    // network, so a fixed "duration + grace" deadline is wrong. Instead the
    // watchdog only fires when playback genuinely stops advancing.
    const watchdog = window.setInterval(() => {
      if (performance.now() - lastAdvanceAt > 60_000) {
        finish(new Error("Rendering stalled — the media stream stopped advancing for 60 seconds."));
      }
    }, 5_000);
    video.onseeked = () => {
      lastAdvanceAt = performance.now();
      if (recorder.state === "inactive") {
        recorder.start(500);
        void video.play().catch(() => finish(new Error("Playback for rendering was blocked.")));
      }
    };
    video.onerror = () => finish(new Error("The source media failed during rendering."));
    video.currentTime = Math.max(0.01, ranges[0].start);
  });
}
