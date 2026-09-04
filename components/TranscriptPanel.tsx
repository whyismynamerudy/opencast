"use client";

import { useEffect, useRef } from "react";
import { Eraser, LoaderCircle, RotateCcw, Scissors } from "lucide-react";
import { isWordCut } from "@/lib/edits";
import { workerStageLabel } from "@/lib/mediaStatus";
import { useEditorStore } from "@/lib/store";
import type { TimeRange } from "@/lib/types";

export function TranscriptPanel({ cuts }: { cuts: TimeRange[] }) {
  const words = useEditorStore((state) => state.words);
  const speakers = useEditorStore((state) => state.speakers);
  const sources = useEditorStore((state) => state.mediaSources);
  const activeSourceId = useEditorStore((state) => state.activeSourceId);
  const activeSourceName = useEditorStore((state) => state.mediaSources.find((source) => source.id === state.activeSourceId)?.name);
  const activeSource = useEditorStore((state) => state.mediaSources.find((source) => source.id === state.activeSourceId));
  const selected = useEditorStore((state) => state.selectedWordIds);
  const time = useEditorStore((state) => state.playbackTime);
  const toggle = useEditorStore((state) => state.toggleSelectedWord);
  const setTime = useEditorStore((state) => state.setPlaybackTime);
  const deleteWords = useEditorStore((state) => state.deleteWords);
  const restoreWords = useEditorStore((state) => state.restoreWords);
  const removeFillers = useEditorStore((state) => state.removeFillers);
  const removeSilences = useEditorStore((state) => state.removeSilences);

  const hasActiveSourceTranscript = Boolean(activeSourceId && words.some((word) => word.sourceId === activeSourceId));
  const sourceWords = activeSourceId && hasActiveSourceTranscript
    ? words.filter((word) => word.sourceId === activeSourceId)
    : words;
  const selectedDeleted = sourceWords.filter((word) => selected.includes(word.id) && word.deleted).length;
  const action = () => selectedDeleted === selected.length ? restoreWords(selected) : deleteWords(selected);

  // Auto-detected speakers are stored as "<file name> · <label>" so they stay
  // unique across sources; the printed tag should never carry the file name.
  // When the playhead jumps (a timeline click or a cut skip, rather than the
  // steady advance of playback), bring the word at that moment into view.
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTime = useRef(time);
  useEffect(() => {
    const jumped = Math.abs(time - lastTime.current) > 1.5;
    lastTime.current = time;
    if (!jumped) return;
    const container = scrollRef.current;
    const target = sourceWords.find((word) => word.end >= time) ?? sourceWords[sourceWords.length - 1];
    if (!container || !target) return;
    const element = container.querySelector<HTMLElement>(`[data-word-id="${CSS.escape(target.id)}"]`);
    if (!element) return;
    const containerRect = container.getBoundingClientRect();
    const wordRect = element.getBoundingClientRect();
    if (wordRect.top < containerRect.top + 28 || wordRect.bottom > containerRect.bottom - 28) {
      container.scrollTo({
        top: container.scrollTop + (wordRect.top - containerRect.top) - container.clientHeight / 2,
        behavior: "smooth",
      });
    }
    // sourceWords changes only alongside edits; time is the jump signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time]);

  const speakerLabel = (name: string | undefined, wordSourceId: string | undefined, fallback: number): string => {
    if (!name) return `Speaker ${fallback + 1}`;
    const source = sources.find((item) => item.id === wordSourceId);
    if (source && name.startsWith(`${source.name} · `)) {
      const short = name.slice(source.name.length + 3);
      // On multi-track projects the track itself is the identity: an
      // undiarized placeholder prints as just the role ("host", "guest").
      if (sources.length > 1) return /^Speaker \d+$/.test(short) ? source.role : `${source.role} · ${short}`;
      return short.length <= 2 ? `Speaker ${short}` : short;
    }
    return name;
  };

  return (
    <section className="transcript-panel">
      <header className="transcript-header">
        <div><p className="panel-kicker">Transcript</p><h2>{activeSourceName || "Edit the words. The recording follows."}</h2></div>
        <div className="quick-actions" aria-label="Transcript actions">
          <button type="button" onClick={() => removeFillers()}><Eraser size={14} /> Remove fillers</button>
          <button type="button" onClick={() => removeSilences()}><Scissors size={14} /> Remove silence</button>
          <button type="button" onClick={action} disabled={!selected.length}>{selectedDeleted === selected.length ? <RotateCcw size={14} /> : <Scissors size={14} />}{selectedDeleted === selected.length ? "Restore" : "Cut"}</button>
        </div>
      </header>
      <div className="transcript-scroll" ref={scrollRef}>
        {!sourceWords.length && activeSource && <div className="transcript-pending">
          <LoaderCircle className="spin" size={18} />
          <div>
            <strong>Transcript incoming.</strong>
            <span>{workerStageLabel(activeSource.processingStage ?? activeSource.status)}</span>
          </div>
        </div>}
        {sourceWords.map((word, index) => {
          const speaker = speakers.find((item) => item.id === word.speaker);
          const startsTurn = index === 0 || sourceWords[index - 1].speaker !== word.speaker;
          const active = time >= word.start && time <= word.end;
          const cut = isWordCut(word, cuts);
          return (
            <span className="transcript-word-wrap" key={word.id}>
              {startsTurn && <span className="speaker-chip" style={{ "--speaker": speaker?.color ?? "#31547d" } as React.CSSProperties}>{speakerLabel(speaker?.name, word.sourceId, word.speaker)}</span>}
              <button
                type="button"
                data-word-id={word.id}
                className={`transcript-word ${selected.includes(word.id) ? "selected" : ""} ${cut ? "cut" : ""} ${active ? "active" : ""}`}
                onClick={() => { toggle(word.id); setTime(word.start); }}
                title={`${word.start.toFixed(2)}s master${word.sourceStart !== undefined ? ` · ${word.sourceStart.toFixed(2)}s source` : ""}`}
              >{word.text}</button>
            </span>
          );
        })}
      </div>
    </section>
  );
}
