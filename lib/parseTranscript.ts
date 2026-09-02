import type { Speaker, Word } from "./types";

export type ParsedTranscript = { words: Word[]; speakers: Speaker[] };

const COLORS = ["#dd6953", "#6e9cdb", "#a477d4", "#d6a540", "#4da58a"];

export function parseTranscript(source: string, filename = "transcript"): ParsedTranscript {
  const text = source.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("The transcript file is empty.");
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json") || /^[{[]/.test(text)) return parseJson(text);
  const cues = lower.endsWith(".vtt") || /^WEBVTT/i.test(text) ? parseVtt(text) : parseSrt(text);
  if (!cues.length) throw new Error("OpenCast could not find timed captions in this file.");
  return makeWords(cues);
}

export async function parseTranscriptFile(file: File): Promise<ParsedTranscript> {
  return parseTranscript(await file.text(), file.name);
}

type Cue = { start: number; end: number; text: string; speaker?: string };

function parseJson(text: string): ParsedTranscript {
  const parsed: unknown = JSON.parse(text);
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { words?: unknown[] }).words)
      ? (parsed as { words: unknown[] }).words
      : null;
  if (!entries) throw new Error("JSON transcripts need a words array.");

  const speakerIds = new Map<string, number>();
  const words: Word[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const textValue = String(row.text ?? row.word ?? "").trim();
    const start = Number(row.start);
    const end = Number(row.end);
    if (!textValue || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const rawSpeaker = row.speaker ?? "Speaker 1";
    const speakerKey = String(rawSpeaker);
    if (!speakerIds.has(speakerKey)) speakerIds.set(speakerKey, speakerIds.size);
    words.push({
      id: `word-${words.length}`,
      text: textValue,
      start: Math.max(0, start),
      end: Math.max(start + 0.02, end),
      speaker: speakerIds.get(speakerKey) ?? 0,
      deleted: Boolean(row.deleted),
    });
  }
  if (!words.length) throw new Error("The JSON file had no usable timed words.");
  const speakers = [...speakerIds.entries()].map(([name, id]) => ({ id, name, color: COLORS[id % COLORS.length] }));
  return { words, speakers };
}

function parseSrt(text: string): Cue[] {
  return text.replace(/\r/g, "").split(/\n{2,}/).flatMap((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) return [];
    const timing = readTiming(lines[timeIndex]);
    const body = lines.slice(timeIndex + 1).join(" ");
    return timing && body ? [{ ...timing, ...readSpeaker(body) }] : [];
  });
}

function parseVtt(text: string): Cue[] {
  const body = text.replace(/\r/g, "").replace(/^WEBVTT[^\n]*\n?/i, "");
  return parseSrt(body);
}

function readTiming(line: string): TimeRange | null {
  const [from, to] = line.split(/\s*-->\s*/);
  if (!from || !to) return null;
  const start = timestamp(from);
  const end = timestamp(to.trim().split(/\s+/)[0]);
  return start === null || end === null ? null : { start, end: Math.max(end, start + 0.02) };
}

type TimeRange = { start: number; end: number };

function timestamp(input: string): number | null {
  const parts = input.trim().replace(",", ".").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) return null;
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

function readSpeaker(raw: string): { text: string; speaker?: string } {
  const voice = raw.match(/<v\s+([^>]+)>([\s\S]*?)<\/v>/i);
  const label = raw.match(/^([\w .'-]{2,40}):\s*/);
  const speaker = voice?.[1]?.trim() ?? label?.[1]?.trim();
  const text = (voice?.[2] ?? raw.replace(/^([\w .'-]{2,40}):\s*/, ""))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { text, speaker };
}

function makeWords(cues: Cue[]): ParsedTranscript {
  const speakers = new Map<string, number>();
  const words: Word[] = [];
  for (const cue of cues) {
    const parts = cue.text.match(/\S+/g) ?? [];
    if (!parts.length) continue;
    const name = cue.speaker || "Speaker 1";
    if (!speakers.has(name)) speakers.set(name, speakers.size);
    const span = Math.max(0.02, cue.end - cue.start);
    const totalWeight = parts.reduce((sum, part) => sum + Math.max(1, part.length), 0);
    let cursor = cue.start;
    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      const duration = isLast ? cue.end - cursor : span * (Math.max(1, part.length) / totalWeight);
      words.push({
        id: `word-${words.length}`,
        text: part,
        start: cursor,
        end: Math.max(cursor + 0.02, cursor + duration),
        speaker: speakers.get(name) ?? 0,
        deleted: false,
      });
      cursor += duration;
    });
  }
  return {
    words,
    speakers: [...speakers.entries()].map(([name, id]) => ({ id, name, color: COLORS[id % COLORS.length] })),
  };
}
