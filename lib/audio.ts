export const TRANSCRIPTION_SAMPLE_RATE = 16_000;

/** Compact amplitude envelope for the timeline; it is generated from local PCM only. */
export function buildWaveformEnvelope(samples: Float32Array, buckets = 420): number[] {
  if (!samples.length) return [];
  const stride = Math.max(1, Math.ceil(samples.length / buckets));
  const waveform: number[] = [];
  for (let start = 0; start < samples.length; start += stride) {
    let peak = 0;
    for (let index = start; index < Math.min(samples.length, start + stride); index++) {
      peak = Math.max(peak, Math.abs(samples[index]));
    }
    waveform.push(Math.min(1, Math.sqrt(peak)));
  }
  return waveform;
}

export function clipAudio(samples: Float32Array, startSeconds: number, endSeconds: number, sampleRate = TRANSCRIPTION_SAMPLE_RATE): Float32Array {
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.max(start, Math.min(samples.length, Math.ceil(endSeconds * sampleRate)));
  return samples.slice(start, end);
}

export function secondsForSamples(samples: Float32Array, sampleRate = TRANSCRIPTION_SAMPLE_RATE): number {
  return samples.length / sampleRate;
}
