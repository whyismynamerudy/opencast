import type { Word } from "./types";

export type CtcAlignment = {
  starts: number[];
  ends: number[];
  score: number;
};

/** Viterbi alignment for a CTC emission matrix (frames × vocabulary). */
export function ctcViterbiAlign(logits: Float32Array, frames: number, vocabulary: number, targets: number[], blankId: number): CtcAlignment | null {
  if (!targets.length || !frames || vocabulary <= blankId || logits.length !== frames * vocabulary) return null;
  const states = targets.length * 2 + 1;
  const labels = Array.from({ length: states }, (_, state) => state % 2 ? targets[(state - 1) / 2] : blankId);
  let previous = new Float64Array(states).fill(Number.NEGATIVE_INFINITY);
  let current = new Float64Array(states).fill(Number.NEGATIVE_INFINITY);
  const backtrace = new Int32Array(frames * states).fill(-1);

  previous[0] = logProbability(logits, 0, blankId, vocabulary);
  if (states > 1) previous[1] = logProbability(logits, 0, labels[1], vocabulary);

  for (let frame = 1; frame < frames; frame++) {
    current.fill(Number.NEGATIVE_INFINITY);
    for (let state = 0; state < states; state++) {
      const candidates = [state, state - 1];
      if (state > 1 && labels[state] !== blankId && labels[state] !== labels[state - 2]) candidates.push(state - 2);
      let best = -1;
      for (const candidate of candidates) {
        if (candidate >= 0 && (best < 0 || previous[candidate] > previous[best])) best = candidate;
      }
      if (best < 0 || !Number.isFinite(previous[best])) continue;
      current[state] = previous[best] + logProbability(logits, frame, labels[state], vocabulary);
      backtrace[frame * states + state] = best;
    }
    [previous, current] = [current, previous];
  }

  let state = previous[states - 1] > previous[states - 2] ? states - 1 : states - 2;
  if (!Number.isFinite(previous[state])) return null;
  const tokenFrames: number[][] = targets.map(() => []);
  for (let frame = frames - 1; frame >= 0; frame--) {
    if (state % 2 === 1) tokenFrames[(state - 1) / 2].push(frame);
    state = frame ? backtrace[frame * states + state] : state;
    if (state < 0 && frame) return null;
  }
  return {
    starts: tokenFrames.map((indices) => indices.length ? Math.min(...indices) : -1),
    ends: tokenFrames.map((indices) => indices.length ? Math.max(...indices) + 1 : -1),
    score: previous[previous.length - 1],
  };
}

export function refineWordsFromAlignment(words: Word[], tokenOwners: number[], alignment: CtcAlignment, audioDuration: number, frames: number): Word[] {
  const bounds = new Map<number, { start: number; end: number }>();
  tokenOwners.forEach((owner, tokenIndex) => {
    const startFrame = alignment.starts[tokenIndex];
    const endFrame = alignment.ends[tokenIndex];
    if (owner < 0 || startFrame < 0 || endFrame < 0) return;
    const start = audioDuration * startFrame / frames;
    const end = audioDuration * endFrame / frames;
    const current = bounds.get(owner);
    bounds.set(owner, current ? { start: Math.min(current.start, start), end: Math.max(current.end, end) } : { start, end });
  });
  return words.map((word, index) => {
    const bound = bounds.get(index);
    if (!bound || bound.end - bound.start < 0.015) return word;
    return { ...word, start: Math.max(0, bound.start), end: Math.min(audioDuration, Math.max(bound.end, bound.start + 0.02)) };
  });
}

function logProbability(logits: Float32Array, frame: number, token: number, vocabulary: number): number {
  const offset = frame * vocabulary;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < vocabulary; index++) max = Math.max(max, logits[offset + index]);
  let sum = 0;
  for (let index = 0; index < vocabulary; index++) sum += Math.exp(logits[offset + index] - max);
  return logits[offset + token] - max - Math.log(sum);
}
