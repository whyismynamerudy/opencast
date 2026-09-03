import type { Speaker, SpeakerTurn, Word } from "./types";

export type LocalDiarizationFrame = {
  start: number;
  end: number;
  activeSpeakers: number[];
  confidence: number;
};

export type DiarizationWindow = {
  index: number;
  frames: LocalDiarizationFrame[];
};

const COLORS = ["#a8402f", "#31547d", "#5d6b2f", "#96650f", "#2f6b62", "#7a4a38"];

/**
 * Stitches pyannote's local speaker tracks across overlapping windows. The model's
 * speaker slots are permutation-invariant, so overlap evidence determines whether
 * a new local slot represents an existing global speaker.
 */
export function stitchDiarizationWindows(windows: DiarizationWindow[]): SpeakerTurn[] {
  const timeline = new Map<number, { speaker: number; confidence: number; start: number; end: number }>();
  let nextSpeaker = 0;
  const ordered = windows.slice().sort((a, b) => a.index - b.index);

  for (const window of ordered) {
    const slots = [...new Set(window.frames.flatMap((frame) => frame.activeSpeakers))];
    const mapping = new Map<number, number>();
    for (const slot of slots) {
      const overlap = new Map<number, number>();
      for (const frame of window.frames) {
        if (!frame.activeSpeakers.includes(slot)) continue;
        const existing = timeline.get(Math.round(frame.start * 1000));
        if (existing) overlap.set(existing.speaker, (overlap.get(existing.speaker) ?? 0) + (frame.end - frame.start));
      }
      const best = [...overlap.entries()].sort((a, b) => b[1] - a[1])[0];
      mapping.set(slot, best && best[1] >= 0.08 ? best[0] : nextSpeaker++);
    }

    for (const frame of window.frames) {
      const slot = frame.activeSpeakers[0];
      if (slot === undefined) continue;
      const key = Math.round(frame.start * 1000);
      const candidate = { speaker: mapping.get(slot)!, confidence: frame.confidence, start: frame.start, end: frame.end };
      const existing = timeline.get(key);
      if (!existing || candidate.confidence >= existing.confidence) timeline.set(key, candidate);
    }
  }

  const frames = [...timeline.values()].sort((a, b) => a.start - b.start);
  const turns: SpeakerTurn[] = [];
  for (const frame of frames) {
    const previous = turns.at(-1);
    if (previous && previous.speaker === frame.speaker && frame.start - previous.end < 0.06) {
      previous.end = Math.max(previous.end, frame.end);
      previous.confidence = Math.max(previous.confidence, frame.confidence);
    } else {
      turns.push({ start: frame.start, end: frame.end, speaker: frame.speaker, confidence: frame.confidence });
    }
  }
  return turns;
}

export function applySpeakerTurns(words: Word[], turns: SpeakerTurn[]): Word[] {
  if (!turns.length) return words;
  return words.map((word) => {
    const midpoint = (word.start + word.end) / 2;
    const overlapping = turns.filter((turn) => turn.end > word.start && turn.start < word.end);
    const best = overlapping.sort((a, b) => overlap(word, b) - overlap(word, a))[0]
      ?? turns.find((turn) => midpoint >= turn.start && midpoint <= turn.end);
    return best ? { ...word, speaker: best.speaker } : word;
  });
}

export function speakersFromTurns(turns: SpeakerTurn[]): Speaker[] {
  const ids = [...new Set(turns.map((turn) => turn.speaker))].sort((a, b) => a - b);
  return ids.map((id) => ({ id, name: `Speaker ${id + 1}`, color: COLORS[id % COLORS.length] }));
}

function overlap(word: Word, turn: SpeakerTurn): number {
  return Math.max(0, Math.min(word.end, turn.end) - Math.max(word.start, turn.start));
}
