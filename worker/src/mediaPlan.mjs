const MEBIBYTE = 1024 * 1024;

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

export function labelForChunk(chunkNumber, totalChunks) {
  return totalChunks === 1 ? "full recording" : `${chunkNumber} of ${totalChunks}`;
}
