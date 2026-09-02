/// <reference lib="webworker" />

import * as ort from "onnxruntime-web";
import { TRANSCRIPTION_SAMPLE_RATE, clipAudio, secondsForSamples } from "../lib/audio";
import { applySpeakerTurns, speakersFromTurns, stitchDiarizationWindows, type DiarizationWindow } from "../lib/diarization";
import { ctcViterbiAlign, refineWordsFromAlignment } from "../lib/forcedAlignment";
import { wordsFromWhisperChunks, type WhisperChunk } from "../lib/transcriptCleanup";
import type { Speaker, SpeakerTurn, Word } from "../lib/types";

type Options = { diarize: boolean; align: boolean; language?: string };
type Request = { type: "transcribe"; jobId: string; samples: ArrayBuffer; options: Options } | { type: "cancel"; jobId: string };
type WhisperOutput = { chunks?: WhisperChunk[] };
type WhisperPipeline = (audio: Float32Array, options: Record<string, unknown>) => Promise<WhisperOutput | WhisperOutput[]>;
type TokenIds = { data: ArrayLike<number> };
type Tokenizer = ((text: string, options: { add_special_tokens: boolean }) => Promise<{ input_ids?: TokenIds | TokenIds[] }>) & {
  pad_token_id?: number;
  model?: { config?: { pad_token_id?: number } };
};
type AlignmentProcessor = ((audio: Float32Array, options: { sampling_rate: number }) => Promise<{ input_values: unknown }>) & { tokenizer: Tokenizer };
type CtcModel = (inputs: { input_values: unknown }) => Promise<{ logits: { data: Float32Array; dims: number[] } }>;
type TransformersModule = {
  env: { allowLocalModels?: boolean; useBrowserCache?: boolean };
  pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<WhisperPipeline>;
  AutoProcessor: { from_pretrained: (model: string, options: Record<string, unknown>) => Promise<AlignmentProcessor> };
  AutoModelForCTC: { from_pretrained: (model: string, options: Record<string, unknown>) => Promise<CtcModel> };
};

type Progress = { type: "progress"; jobId: string; stage: string; progress: number; message: string };
type Complete = { type: "complete"; jobId: string; words: Word[]; speakers: Speaker[]; speakerTurns: SpeakerTurn[]; duration: number };

const SILERO_MODEL = "https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx";
const PYANNOTE_MODEL = "https://huggingface.co/onnx-community/pyannote-segmentation-3.0/resolve/main/onnx/model.onnx";
const WHISPER_MODEL = "Xenova/whisper-small.en";
const ALIGNMENT_MODEL = "Xenova/wav2vec2-base-960h";
let cancelledJob: string | null = null;
let whisperPipeline: WhisperPipeline | null = null;
let whisperDevice: "webgpu" | "wasm" | null = null;

function send(message: Progress | Complete | { type: "error"; jobId: string; message: string }) {
  self.postMessage(message);
}

function progress(jobId: string, stage: Progress["stage"], value: number, message: string) {
  send({ type: "progress", jobId, stage, progress: Math.max(0, Math.min(1, value)), message });
}

function assertNotCancelled(jobId: string) {
  if (cancelledJob === jobId) throw new DOMException("Transcription cancelled.", "AbortError");
}

async function run(jobId: string, samples: Float32Array, options: Options) {
  const duration = secondsForSamples(samples);
  if (duration < 0.08) throw new Error("This recording is too short to transcribe.");

  progress(jobId, "voice_activity", 0.08, "Finding speech with Silero VAD…");
  const speech = await detectSpeech(samples, jobId);
  assertNotCancelled(jobId);
  const windows = makeWhisperWindows(speech, duration);

  progress(jobId, "transcribing", 0.18, "Loading Whisper locally (cached after first use)…");
  const whisperChunks = await transcribeSpeechWindows(samples, windows, options, jobId);
  let words = wordsFromWhisperChunks(whisperChunks, duration);
  if (!words.length) throw new Error("Whisper did not return timed words for this recording.");
  assertNotCancelled(jobId);

  if (options.align) {
    progress(jobId, "aligning", 0.66, "Refining word boundaries with CTC alignment…");
    try {
      words = await alignWords(samples, words, jobId);
    } catch (error) {
      progress(jobId, "aligning", 0.72, `Keeping Whisper timings: ${friendlyError(error)}`);
    }
  }
  assertNotCancelled(jobId);

  let speakerTurns: SpeakerTurn[] = [];
  let speakers: Speaker[] = [{ id: 0, name: "Speaker 1", color: "#dd6953" }];
  if (options.diarize) {
    progress(jobId, "diarizing", 0.76, "Detecting speakers with pyannote segmentation…");
    try {
      speakerTurns = await diarize(samples, jobId);
      if (speakerTurns.length) {
        words = applySpeakerTurns(words, speakerTurns);
        speakers = speakersFromTurns(speakerTurns);
      }
    } catch (error) {
      progress(jobId, "diarizing", 0.94, `Keeping one speaker: ${friendlyError(error)}`);
    }
  }

  progress(jobId, "finalizing", 0.97, "Finalizing the editable transcript…");
  const finalWords = enforceMonotonicTimes(words, duration);
  send({ type: "complete", jobId, words: finalWords, speakers, speakerTurns, duration });
}

async function detectSpeech(samples: Float32Array, jobId: string): Promise<Array<{ start: number; end: number }>> {
  try {
    const session = await createSession(SILERO_MODEL);
    let state: ort.Tensor = new ort.Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
    const frames: Array<{ start: number; end: number; speech: boolean }> = [];
    for (let offset = 0; offset < samples.length; offset += 512) {
      assertNotCancelled(jobId);
      const frame = new Float32Array(512);
      frame.set(samples.subarray(offset, Math.min(samples.length, offset + 512)));
      const feeds: Record<string, ort.Tensor> = {
        [session.inputNames[0]]: new ort.Tensor("float32", frame, [1, 512]),
      };
      const stateName = session.inputNames.find((name) => /state/i.test(name));
      if (stateName) feeds[stateName] = state;
      const sampleRateName = session.inputNames.find((name) => /sr|sample_rate/i.test(name));
      if (sampleRateName) feeds[sampleRateName] = new ort.Tensor("int64", BigInt64Array.of(BigInt(TRANSCRIPTION_SAMPLE_RATE)), []);
      const output = await session.run(feeds);
      const first = output[session.outputNames[0]].data as Float32Array;
      const nextState = output[session.outputNames.find((name) => /state/i.test(name)) ?? ""];
      if (nextState) state = nextState;
      frames.push({ start: offset / TRANSCRIPTION_SAMPLE_RATE, end: Math.min(samples.length, offset + 512) / TRANSCRIPTION_SAMPLE_RATE, speech: first[0] >= 0.5 });
      if (offset % (512 * 75) === 0) progress(jobId, "voice_activity", 0.08 + 0.08 * (offset / samples.length), "Finding speech with Silero VAD…");
    }
    return framesToSegments(frames);
  } catch {
    // Energy VAD is only a resilience fallback; the primary path above is Silero ONNX.
    return energySpeechSegments(samples);
  }
}

async function transcribeSpeechWindows(samples: Float32Array, windows: Array<{ start: number; end: number }>, options: Options, jobId: string): Promise<WhisperChunk[]> {
  const transcriber = await loadWhisper(jobId);
  const chunks: WhisperChunk[] = [];
  for (let index = 0; index < windows.length; index++) {
    assertNotCancelled(jobId);
    const window = windows[index];
    progress(jobId, "transcribing", 0.2 + 0.43 * (index / windows.length), `Transcribing speech ${index + 1} of ${windows.length}…`);
    const audio = clipAudio(samples, window.start, window.end);
    const output = await transcriber(audio, {
      return_timestamps: "word",
      chunk_length_s: 29,
      stride_length_s: 4,
      ...(options.language ? { language: options.language, task: "transcribe" } : {}),
    });
    const entries = (Array.isArray(output) ? output[0] : output)?.chunks ?? [];
    for (const entry of entries as WhisperChunk[]) {
      const timestamp = entry.timestamp;
      chunks.push({
        text: entry.text,
        timestamp: timestamp ? [Number(timestamp[0]) + window.start, Number(timestamp[1]) + window.start] : undefined,
      });
    }
  }
  return chunks;
}

async function loadWhisper(jobId: string) {
  if (whisperPipeline) return whisperPipeline;
  const transformers = await import("@huggingface/transformers") as unknown as TransformersModule;
  transformers.env.allowLocalModels = false;
  transformers.env.useBrowserCache = true;
  const create = async (device: "webgpu" | "wasm") => transformers.pipeline(
    "automatic-speech-recognition",
    WHISPER_MODEL,
    {
      device,
      dtype: device === "webgpu" ? "fp16" : "q8",
      progress_callback: (event: { status?: string; progress?: number }) => {
        if (event.status === "progress" && typeof event.progress === "number") {
          progress(jobId, "transcribing", 0.18 + event.progress * 0.08, "Downloading the local Whisper model…");
        }
      },
    },
  );
  try {
    whisperPipeline = await create("webgpu");
    whisperDevice = "webgpu";
  } catch {
    whisperPipeline = await create("wasm");
    whisperDevice = "wasm";
  }
  return whisperPipeline;
}

async function alignWords(samples: Float32Array, words: Word[], jobId: string): Promise<Word[]> {
  assertNotCancelled(jobId);
  const transformers = await import("@huggingface/transformers") as unknown as TransformersModule;
  const processor = await transformers.AutoProcessor.from_pretrained(ALIGNMENT_MODEL, { dtype: "q8" });
  let model: CtcModel;
  try {
    model = await transformers.AutoModelForCTC.from_pretrained(ALIGNMENT_MODEL, { dtype: "q8", device: whisperDevice === "webgpu" ? "webgpu" : "wasm" });
  } catch {
    model = await transformers.AutoModelForCTC.from_pretrained(ALIGNMENT_MODEL, { dtype: "q8", device: "wasm" });
  }
  const prepared = await processor(samples, { sampling_rate: TRANSCRIPTION_SAMPLE_RATE });
  const output = await model({ input_values: prepared.input_values });
  const logitsTensor = output.logits;
  const dims: number[] = logitsTensor.dims;
  const frames = dims.at(-2);
  const vocabulary = dims.at(-1);
  if (!frames || !vocabulary) return words;

  const tokenizer = processor.tokenizer;
  const { targets, owners } = await encodeWordTargets(tokenizer, words);
  const blankId = Number(tokenizer.pad_token_id ?? tokenizer.model?.config?.pad_token_id ?? 0);
  const alignment = ctcViterbiAlign(logitsTensor.data as Float32Array, frames, vocabulary, targets, blankId);
  return alignment ? refineWordsFromAlignment(words, owners, alignment, secondsForSamples(samples), frames) : words;
}

async function encodeWordTargets(tokenizer: Tokenizer, words: Word[]): Promise<{ targets: number[]; owners: number[] }> {
  let accumulated = "";
  let previous: number[] = [];
  const targets: number[] = [];
  const owners: number[] = [];
  for (let index = 0; index < words.length; index++) {
    accumulated += `${index ? " " : ""}${words[index].text}`;
    const encoded = await tokenizer(accumulated, { add_special_tokens: false });
    const ids = Array.isArray(encoded.input_ids) ? encoded.input_ids[0] : encoded.input_ids;
    const raw = ids?.data ?? [];
    const next = Array.from(raw, Number);
    for (const token of next.slice(previous.length)) {
      targets.push(token);
      owners.push(index);
    }
    previous = next;
  }
  return { targets, owners };
}

async function diarize(samples: Float32Array, jobId: string): Promise<SpeakerTurn[]> {
  const session = await createSession(PYANNOTE_MODEL);
  const windowSamples = 160_000;
  const hopSamples = 80_000;
  const frameStep = 0.016875;
  const windows: DiarizationWindow[] = [];

  for (let offset = 0, index = 0; offset < samples.length; offset += hopSamples, index++) {
    assertNotCancelled(jobId);
    const input = new Float32Array(windowSamples);
    input.set(samples.subarray(offset, Math.min(samples.length, offset + windowSamples)));
    const output = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 1, windowSamples]) });
    const tensor = output[session.outputNames[0]];
    const dims = tensor.dims;
    const frames = dims.at(-2) ?? 0;
    const classes = dims.at(-1) ?? 0;
    const values = tensor.data as Float32Array;
    const localFrames = Array.from({ length: frames }, (_, frame) => {
      const { activeSpeakers, confidence } = decodePowersetFrame(values, frame * classes, classes);
      const start = offset / TRANSCRIPTION_SAMPLE_RATE + frame * frameStep;
      return { start, end: start + frameStep, activeSpeakers, confidence };
    }).filter((frame) => frame.start < secondsForSamples(samples));
    windows.push({ index, frames: localFrames });
    progress(jobId, "diarizing", 0.77 + 0.18 * Math.min(1, (offset + hopSamples) / samples.length), "Attributing words to speaker turns…");
  }
  return stitchDiarizationWindows(windows);
}

function decodePowersetFrame(values: Float32Array, offset: number, classes: number): { activeSpeakers: number[]; confidence: number } {
  let best = 0;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (let index = 0; index < classes; index++) max = Math.max(max, values[offset + index]);
  for (let index = 0; index < classes; index++) sum += Math.exp(values[offset + index] - max);
  for (let index = 0; index < classes; index++) if (values[offset + index] > values[offset + best]) best = index;
  const confidence = Math.exp(values[offset + best] - max) / sum;
  // segmentation-3.0 encodes active combinations for up to three local speakers.
  const powerset = [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]];
  return { activeSpeakers: confidence >= 0.42 ? (powerset[best] ?? []) : [], confidence };
}

async function createSession(url: string): Promise<ort.InferenceSession> {
  try {
    return await ort.InferenceSession.create(url, { executionProviders: ["webgpu", "wasm"] });
  } catch {
    return ort.InferenceSession.create(url, { executionProviders: ["wasm"] });
  }
}

function framesToSegments(frames: Array<{ start: number; end: number; speech: boolean }>): Array<{ start: number; end: number }> {
  const segments: Array<{ start: number; end: number }> = [];
  let start: number | null = null;
  let quietFrames = 0;
  for (const frame of frames) {
    if (frame.speech) {
      if (start === null) start = frame.start;
      quietFrames = 0;
    } else if (start !== null && ++quietFrames >= 5) {
      segments.push({ start: Math.max(0, start - 0.12), end: frame.start + 0.08 });
      start = null;
      quietFrames = 0;
    }
  }
  if (start !== null) segments.push({ start: Math.max(0, start - 0.12), end: frames.at(-1)?.end ?? start });
  return segments.filter((segment) => segment.end - segment.start >= 0.18);
}

function energySpeechSegments(samples: Float32Array): Array<{ start: number; end: number }> {
  const frameSize = 512;
  const frames = Array.from({ length: Math.ceil(samples.length / frameSize) }, (_, index) => {
    const start = index * frameSize;
    let energy = 0;
    for (let sample = start; sample < Math.min(samples.length, start + frameSize); sample++) energy += samples[sample] ** 2;
    return { start: start / TRANSCRIPTION_SAMPLE_RATE, end: Math.min(samples.length, start + frameSize) / TRANSCRIPTION_SAMPLE_RATE, speech: Math.sqrt(energy / frameSize) > 0.012 };
  });
  return framesToSegments(frames);
}

function makeWhisperWindows(segments: Array<{ start: number; end: number }>, duration: number): Array<{ start: number; end: number }> {
  const merged = segments.length ? segments : [{ start: 0, end: duration }];
  const grouped: Array<{ start: number; end: number }> = [];
  for (const segment of merged) {
    const previous = grouped.at(-1);
    if (previous && segment.start - previous.end < 0.45 && segment.end - previous.start < 28) previous.end = segment.end;
    else grouped.push({ ...segment });
  }
  return grouped.flatMap((segment) => {
    const slices: Array<{ start: number; end: number }> = [];
    for (let start = segment.start; start < segment.end; start += 27) slices.push({ start, end: Math.min(segment.end, start + 29) });
    return slices;
  });
}

function enforceMonotonicTimes(words: Word[], duration: number): Word[] {
  let cursor = 0;
  return words
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((word, index) => {
      const start = Math.max(cursor, Math.min(duration - 0.02, word.start));
      const end = Math.max(start + 0.02, Math.min(duration, word.end));
      cursor = end;
      return { ...word, id: `word-${index}`, start, end };
    });
}

function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\.$/, "") : "model unavailable";
}

self.onmessage = (event: MessageEvent<Request>) => {
  if (event.data.type === "cancel") {
    cancelledJob = event.data.jobId;
    return;
  }
  cancelledJob = null;
  const { jobId, samples, options } = event.data;
  void run(jobId, new Float32Array(samples), options).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") return;
    send({ type: "error", jobId, message: friendlyError(error) });
  });
};
