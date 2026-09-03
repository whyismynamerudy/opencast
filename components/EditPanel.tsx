"use client";

import { useState } from "react";
import { Check, Eraser, Redo2, RotateCcw, Scissors, Undo2 } from "lucide-react";
import { useEditorStore } from "@/lib/store";
import { formatTime } from "./MediaPreview";

/** Human controls over the same shared action hub the WebMCP tools call. */
export function EditPanel() {
  const words = useEditorStore((state) => state.words);
  const selected = useEditorStore((state) => state.selectedWordIds);
  const speakers = useEditorStore((state) => state.speakers);
  const sources = useEditorStore((state) => state.mediaSources);
  const playbackTime = useEditorStore((state) => state.playbackTime);
  const history = useEditorStore((state) => state.history);
  const future = useEditorStore((state) => state.future);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const deleteWords = useEditorStore((state) => state.deleteWords);
  const restoreWords = useEditorStore((state) => state.restoreWords);
  const removeFillers = useEditorStore((state) => state.removeFillers);
  const removeSilences = useEditorStore((state) => state.removeSilences);
  const splitAt = useEditorStore((state) => state.splitAt);
  const correctText = useEditorStore((state) => state.correctText);
  const renameSpeaker = useEditorStore((state) => state.renameSpeaker);
  const reassignSpeaker = useEditorStore((state) => state.reassignSpeaker);
  const addActivity = useEditorStore((state) => state.addActivity);
  const [correction, setCorrection] = useState("");

  const selectedDeleted = words.filter((word) => selected.includes(word.id) && word.deleted).length;
  const allSelectedDeleted = selected.length > 0 && selectedDeleted === selected.length;
  const selectedText = words.filter((word) => selected.includes(word.id)).map((word) => word.text).join(" ");

  const displayName = (name: string): string => {
    for (const source of sources) {
      if (name.startsWith(`${source.name} · `)) {
        const short = name.slice(source.name.length + 3);
        if (sources.length > 1) return `${source.role} · ${short}`;
        return short.length <= 2 ? `Speaker ${short}` : short;
      }
    }
    return name;
  };

  const cleanFillers = () => {
    const removed = removeFillers();
    addActivity("remove_fillers", removed ? `Removed ${removed} filler words.` : "No filler words left.", "success");
  };
  const cleanSilences = () => {
    const { count, seconds } = removeSilences();
    addActivity("remove_silences", count ? `Removed ${count} silent gaps (${seconds.toFixed(1)}s).` : "No long silences left.", "success");
  };
  const split = () => {
    if (splitAt(playbackTime)) addActivity("split_at", `Split the clip at ${formatTime(playbackTime)}.`, "success");
  };
  const cutSelection = () => {
    if (allSelectedDeleted) { restoreWords(selected); addActivity("restore_words", `Restored ${selected.length} words.`, "success"); }
    else { deleteWords(selected); addActivity("delete_words", `Cut ${selected.length} words.`, "success"); }
  };
  const applyCorrection = () => {
    const text = correction.trim();
    if (!text || !correctText(selected, text)) return;
    setCorrection("");
    addActivity("correct_text", `Corrected the selection to “${text}”.`, "success");
  };
  const reassign = (speakerId: number) => {
    const moved = reassignSpeaker(selected, speakerId);
    if (moved) addActivity("reassign_speaker", `Reassigned ${moved} words.`, "success");
  };
  const rename = (id: number, previous: string, next: string) => {
    const value = next.trim();
    if (!value || value === previous) return;
    if (renameSpeaker(id, value)) addActivity("rename_speaker", `Renamed a speaker to “${value}”.`, "success");
  };

  return (
    <section className="edit-hub">
      <div><p className="panel-kicker">Edit</p><h2>Cutting desk</h2></div>

      <div className="hub-actions">
        <button type="button" onClick={cleanFillers}><Eraser size={13} /> Remove fillers</button>
        <button type="button" onClick={cleanSilences}><Scissors size={13} /> Remove silence</button>
        <button type="button" onClick={split} disabled={!words.length}><Scissors size={13} /> Split at {formatTime(playbackTime)}</button>
        <button type="button" onClick={() => undo()} disabled={!history.length}><Undo2 size={13} /> Undo</button>
        <button type="button" onClick={() => redo()} disabled={!future.length}><Redo2 size={13} /> Redo</button>
      </div>

      {selected.length > 0 && (
        <div className="hub-selection">
          <p className="panel-kicker">Selection · {selected.length} word{selected.length === 1 ? "" : "s"}</p>
          <blockquote>{selectedText.length > 90 ? `${selectedText.slice(0, 90)}…` : selectedText}</blockquote>
          <div className="hub-selection-actions">
            <button type="button" onClick={cutSelection}>{allSelectedDeleted ? <><RotateCcw size={13} /> Restore</> : <><Scissors size={13} /> Cut</>}</button>
            {speakers.length > 1 && (
              <select aria-label="Reassign selection to speaker" value="" onChange={(event) => reassign(Number(event.target.value))}>
                <option value="" disabled>Assign speaker…</option>
                {speakers.map((speaker) => <option key={speaker.id} value={speaker.id}>{displayName(speaker.name)}</option>)}
              </select>
            )}
          </div>
          <div className="hub-correct">
            <input
              aria-label="Correct the selected text"
              placeholder="Correct selection to…"
              value={correction}
              onChange={(event) => setCorrection(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") applyCorrection(); }}
            />
            <button type="button" onClick={applyCorrection} disabled={!correction.trim()} aria-label="Apply correction"><Check size={13} /></button>
          </div>
        </div>
      )}

      {speakers.length > 0 && (
        <div className="speaker-list">
          <p className="panel-kicker">Speakers</p>
          {speakers.map((speaker) => {
            const shown = displayName(speaker.name);
            return (
              <div className="speaker-row" key={`${speaker.id}-${shown}`}>
                <i className="speaker-swatch" style={{ background: speaker.color }} aria-hidden="true" />
                <input
                  aria-label={`Rename ${shown}`}
                  defaultValue={shown}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                  onBlur={(event) => rename(speaker.id, shown, event.currentTarget.value)}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
