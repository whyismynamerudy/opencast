import { NextResponse } from "next/server";
import {
  normalizeHostedTranscription,
  type OpenAiDiarizedSegment,
  type OpenAiTimedWord,
} from "@/lib/hostedTranscription";

export const runtime = "nodejs";
export const maxDuration = 60;

const OPENAI_TRANSCRIPT_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MAX_UPLOAD_MB = 25;
const SUPPORTED_EXTENSIONS = new Set(["flac", "m4a", "mp3", "mp4", "mpeg", "mpga", "ogg", "wav", "webm"]);

type DiarizedResponse = {
  duration?: number;
  segments?: OpenAiDiarizedSegment[];
};

type TimedResponse = {
  words?: OpenAiTimedWord[];
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return error("OpenCast is not configured for cloud transcription. Add OPENAI_API_KEY to the deployment environment.", 503);
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return error("Choose an audio or video file to transcribe.", 400);

    const maxBytes = maxUploadBytes();
    if (!isSupportedAudioFile(file)) {
      return error("OpenAI transcription accepts FLAC, M4A, MP3, MP4, MPEG, MPGA, OGG, WAV, or WebM files.", 415);
    }
    if (file.size === 0) return error("The selected file is empty.", 400);
    if (file.size > maxBytes) {
      return error(`This file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB OpenCast transcription limit.`, 413);
    }

    const [diarized, timed] = await Promise.all([
      requestOpenAi<DiarizedResponse>(apiKey, createDiarizationRequest(file)),
      requestOpenAi<TimedResponse>(apiKey, createWordTimingRequest(file)),
    ]);
    const result = normalizeHostedTranscription(timed.words ?? [], diarized.segments ?? [], diarized.duration ?? 0);
    if (!result.words.length) return error("OpenAI did not return word timings for this recording. Try a clearer or shorter clip.", 422);

    return NextResponse.json(result);
  } catch (reason) {
    console.error("OpenCast transcription failed", reason);
    const message = reason instanceof OpenAiRequestError
      ? reason.message
      : "Cloud transcription could not complete. Please try again.";
    return error(message, reason instanceof OpenAiRequestError ? reason.status : 500);
  }
}

function createDiarizationRequest(file: File): FormData {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("model", "gpt-4o-transcribe-diarize");
  form.append("response_format", "diarized_json");
  form.append("chunking_strategy", "auto");
  return form;
}

function createWordTimingRequest(file: File): FormData {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  return form;
}

async function requestOpenAi<T>(apiKey: string, body: FormData): Promise<T> {
  const response = await fetch(OPENAI_TRANSCRIPT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    cache: "no-store",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const message = objectMessage(payload) || "OpenAI could not transcribe this recording.";
    throw new OpenAiRequestError(message, response.status >= 500 ? 502 : response.status);
  }
  return payload as T;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function objectMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const error = "error" in payload ? payload.error : null;
  if (!error || typeof error !== "object" || !("message" in error) || typeof error.message !== "string") return null;
  return error.message;
}

function isSupportedAudioFile(file: File): boolean {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  return SUPPORTED_EXTENSIONS.has(extension);
}

function maxUploadBytes(): number {
  const configured = Number(process.env.OPENCAST_MAX_UPLOAD_MB);
  const megabytes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_MB;
  return megabytes * 1024 * 1024;
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

class OpenAiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
