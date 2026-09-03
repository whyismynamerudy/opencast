const MEBIBYTE = 1024 * 1024;

/**
 * Audio manifests are durable job checkpoints. Bump this when their shape or
 * preparation strategy changes so a restored job never reuses incompatible
 * artifacts from an earlier worker deployment.
 */
export const AUDIO_INPUT_MANIFEST_VERSION = 3;

const DEFAULT_TRANSCRIPTION_SEGMENT_SECONDS = 900;
const MIN_TRANSCRIPTION_SEGMENT_SECONDS = 60;
// gpt-4o-transcribe-diarize rejected a 1,400-second input in production. Keep
// a real safety margin instead of treating the provider maximum as our target.
const MAX_TRANSCRIPTION_SEGMENT_SECONDS = 1_200;

/**
 * Keep a safety margin below the transcription endpoint's file limit. At the
 * worker's 24 kbps mono Opus bitrate this covers roughly two hours of audio.
 */
export function singleAudioLimitBytes(value = process.env.OPENCAST_SINGLE_AUDIO_MAX_BYTES) {
  const configured = Number(value);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(MEBIBYTE, Math.min(Math.floor(configured), 24 * MEBIBYTE));
  }
  return 20 * MEBIBYTE;
}

export function audioPlanForSize(bytes, limitBytes = singleAudioLimitBytes()) {
  if (!Number.isFinite(bytes) || bytes < 0) throw new Error("Compressed audio size is invalid.");
  return bytes <= limitBytes ? "single" : "segmented";
}

/**
 * Duration is the primary OpenAI safety boundary. At our fixed 24 kbps Opus
 * bitrate, a 15-minute chunk is only about 2.7 MB, but a compact hour-long
 * episode can still be far over the model's duration limit.
 */
export function transcriptionSegmentSeconds(value = process.env.OPENCAST_SEGMENT_SECONDS) {
  const configured = Number(value);
  const seconds = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TRANSCRIPTION_SEGMENT_SECONDS;
  return Math.max(MIN_TRANSCRIPTION_SEGMENT_SECONDS, Math.min(Math.floor(seconds), MAX_TRANSCRIPTION_SEGMENT_SECONDS));
}

export function audioPlanForDuration(durationSeconds, segmentSeconds = transcriptionSegmentSeconds()) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Source audio duration is invalid.");
  if (!Number.isFinite(segmentSeconds) || segmentSeconds <= 0) throw new Error("Transcription segment duration is invalid.");
  return durationSeconds <= segmentSeconds ? "single" : "segmented";
}

/** Validate the format of a resumable, already-prepared audio checkpoint. */
export function isCurrentAudioManifest(manifest) {
  if (!manifest || manifest.version !== AUDIO_INPUT_MANIFEST_VERSION) return false;
  if (manifest.plan !== "single" && manifest.plan !== "segmented") return false;
  if (!Array.isArray(manifest.files) || !manifest.files.length) return false;
  if (manifest.plan === "single" && manifest.files.length !== 1) return false;
  if (manifest.plan === "segmented" && manifest.files.length < 2) return false;
  return manifest.files.every((file, index) => (
    file
    && typeof file.name === "string"
    && /^audio-\d{3}\.ogg$/.test(file.name)
    && Number.isFinite(file.startSeconds)
    && file.startSeconds >= 0
    && Number.isFinite(file.durationSeconds)
    && file.durationSeconds > 0
    && (index === 0 || file.startSeconds >= manifest.files[index - 1].startSeconds)
  ));
}

export function labelForChunk(chunkNumber, totalChunks) {
  return totalChunks === 1 ? "full recording" : `${chunkNumber} of ${totalChunks}`;
}
