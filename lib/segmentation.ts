"use client";

/**
 * Person/background separation with MediaPipe's selfie segmenter — the same
 * in-browser model family video calls use for virtual backgrounds. The wasm
 * runtime and model load lazily from Google's CDN on first use, so projects
 * that never touch background removal pay nothing.
 */

import type { ImageSegmenter as ImageSegmenterType } from "@mediapipe/tasks-vision";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
/** Segmentation runs at a reduced size; the mask upscales cleanly. */
const WORK_WIDTH = 512;

let segmenterPromise: Promise<ImageSegmenterType> | null = null;

async function getSegmenter(): Promise<ImageSegmenterType> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      const options = {
        runningMode: "VIDEO" as const,
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      };
      try {
        return await ImageSegmenter.createFromOptions(vision, { ...options, baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" } });
      } catch {
        // Embedded browsers may lack a usable GPU delegate; CPU still works.
        return await ImageSegmenter.createFromOptions(vision, { ...options, baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" } });
      }
    })();
    segmenterPromise.catch(() => { segmenterPromise = null; });
  }
  return segmenterPromise;
}

export type BackgroundRemover = {
  /** Draw only the person from `source` onto `target` at the given size. */
  draw: (target: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, destWidth: number, destHeight: number) => void;
  dispose: () => void;
};

export async function createBackgroundRemover(): Promise<BackgroundRemover> {
  const segmenter = await getSegmenter();
  const work = document.createElement("canvas");
  const workCtx = work.getContext("2d", { willReadFrequently: true })!;
  const masked = document.createElement("canvas");
  const maskedCtx = masked.getContext("2d")!;
  let maskImage: ImageData | null = null;
  let lastTimestamp = 0;

  const draw: BackgroundRemover["draw"] = (target, source, sourceWidth, sourceHeight, destWidth, destHeight) => {
    if (!sourceWidth || !sourceHeight) return;
    const width = Math.min(WORK_WIDTH, sourceWidth);
    const height = Math.max(2, Math.round(width * (sourceHeight / sourceWidth)));
    if (work.width !== width || work.height !== height) {
      work.width = width;
      work.height = height;
      masked.width = width;
      masked.height = height;
      maskImage = null;
    }
    workCtx.drawImage(source, 0, 0, width, height);
    // segmentForVideo requires monotonically increasing timestamps.
    lastTimestamp = Math.max(lastTimestamp + 1, Math.round(performance.now()));
    const result = segmenter.segmentForVideo(work, lastTimestamp);
    const confidence = result.confidenceMasks?.[0];
    if (!confidence) { result.close(); return; }
    const values = confidence.getAsFloat32Array();
    if (!maskImage) maskImage = workCtx.createImageData(width, height);
    const pixels = maskImage.data;
    for (let index = 0; index < values.length; index++) {
      pixels[index * 4 + 3] = values[index] > 0.5 ? 255 : values[index] > 0.25 ? Math.round(values[index] * 2 * 255) : 0;
    }
    result.close();
    maskedCtx.clearRect(0, 0, width, height);
    maskedCtx.putImageData(maskImage, 0, 0);
    maskedCtx.globalCompositeOperation = "source-in";
    maskedCtx.drawImage(work, 0, 0, width, height);
    maskedCtx.globalCompositeOperation = "source-over";
    target.drawImage(masked, 0, 0, width, height, 0, 0, destWidth, destHeight);
  };

  return { draw, dispose: () => { /* the segmenter is shared; keep it warm */ } };
}
