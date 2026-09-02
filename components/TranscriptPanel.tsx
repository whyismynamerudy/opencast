"use client";

import { RotateCcw, Scissors, Search, WandSparkles } from "lucide-react";
import { isWordCut } from "@/lib/edits";
import { useEditorStore } from "@/lib/store";
import type { TimeRange } from "@/lib/types";

export function TranscriptPanel({ cuts }: { cuts: TimeRange[] }) {
  const words = useEditorStore((state) => state.words);
  const speakers = useEditorStore((state) => state.speakers);
  const selected = useEditorStore((state) => state.selectedWordIds);
  const time = useEditorStore((state) => state.playbackTime);
  const toggle = useEditorStore((state) => state.toggleSelectedWord);
  const setTime = useEditorStore((state) => state.setPlaybackTime);
  const deleteWords = useEditorStore((state) => state.deleteWords);
  const restoreWords = useEditorStore((state) => state.restoreWords);
  const removeFillers = useEditorStore((state) => state.removeFillers);
  const removeSilences = useEditorStore((state) => state.removeSilences);

  const selectedDeleted = words.filter((word) => selected.includes(word.id) && word.deleted).length;
  const action = () => selectedDeleted === selected.length ? restoreWords(selected) : deleteWords(selected);

  return (
    <section className="transcript-panel">
      <header className="transcript-header">
        <div><p className="panel-kicker">TRANSCRIPT</p><h2>Edit the words. The recording follows.</h2></div>
        <button type="button" className="icon-button" aria-label="Search transcript"><Search size={17} /></button>
      </header>
      <div className="quick-actions">
        <button type="button" onClick={() => removeFillers()}><WandSparkles size={14} /> Remove fillers</button>
        <button type="button" onClick={() => removeSilences()}><Scissors size={14} /> Remove silence</button>
        <button type="button" onClick={action} disabled={!selected.length}>{selectedDeleted === selected.length ? <RotateCcw size={14} /> : <Scissors size={14} />}{selectedDeleted === selected.length ? "Restore" : "Cut"} selection</button>
      </div>
      <div className="transcript-scroll">
        {words.map((word, index) => {
          const speaker = speakers.find((item) => item.id === word.speaker);
          const startsTurn = index === 0 || words[index - 1].speaker !== word.speaker;
          const active = time >= word.start && time <= word.end;
          const cut = isWordCut(word, cuts);
          return (
            <span className="transcript-word-wrap" key={word.id}>
              {startsTurn && <span className="speaker-chip" style={{ "--speaker": speaker?.color ?? "#6e9cdb" } as React.CSSProperties}>{speaker?.name ?? `Speaker ${word.speaker + 1}`}</span>}
              <button
                type="button"
                className={`transcript-word ${selected.includes(word.id) ? "selected" : ""} ${cut ? "cut" : ""} ${active ? "active" : ""}`}
                onClick={() => { toggle(word.id); setTime(word.start); }}
                title={`${word.start.toFixed(2)}s`}
              >{word.text}</button>
            </span>
          );
        })}
      </div>
    </section>
  );
}
