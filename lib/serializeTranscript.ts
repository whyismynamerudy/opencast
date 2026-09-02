import type { Word } from "./types";

function timestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":") + `,${String(ms).padStart(3, "0")}`;
}

export function wordsToSrt(words: Word[]): string {
  return words
    .filter((word) => !word.deleted)
    .map((word, index) => `${index + 1}\n${timestamp(word.start)} --> ${timestamp(word.end)}\n${word.text}`)
    .join("\n\n");
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
