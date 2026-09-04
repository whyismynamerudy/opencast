"use client";

import { Clapperboard, Film, Plus, Trash2 } from "lucide-react";
import { segmentsDuration } from "@/lib/compositions";
import { useEditorStore } from "@/lib/store";
import { formatTime } from "./MediaPreview";

/** Named cuts — hooks, clips, highlight reels — assembled from episode ranges. */
export function CompositionsPanel() {
  const compositions = useEditorStore((state) => state.compositions);
  const activeCompositionId = useEditorStore((state) => state.activeCompositionId);
  const duration = useEditorStore((state) => state.duration);
  const createComposition = useEditorStore((state) => state.createComposition);
  const deleteComposition = useEditorStore((state) => state.deleteComposition);
  const renameComposition = useEditorStore((state) => state.renameComposition);
  const setActiveComposition = useEditorStore((state) => state.setActiveComposition);
  const addActivity = useEditorStore((state) => state.addActivity);

  const create = () => {
    const composition = createComposition();
    addActivity("create_composition", `Created “${composition.title}”.`, "success");
  };

  const remove = (id: string, title: string) => {
    if (!window.confirm(`Delete the composition “${title}”? The episode is not affected.`)) return;
    if (deleteComposition(id)) addActivity("delete_composition", `Deleted “${title}”.`, "success");
  };

  return (
    <section className="compositions-panel">
      <header className="source-manager-header">
        <div><p className="panel-kicker">Compositions</p><h2>Cuts of this episode</h2></div>
        <button type="button" className="icon-button" onClick={create} aria-label="New composition"><Plus size={17} /></button>
      </header>
      <div className="composition-list">
        <button
          type="button"
          className={`composition-row ${activeCompositionId === null ? "active" : ""}`}
          onClick={() => setActiveComposition(null)}
        >
          <Film size={14} />
          <span>Full episode</span>
          <small>{formatTime(duration)}</small>
        </button>
        {compositions.map((composition) => (
          // The whole row opens the composition; the title input additionally
          // renames, and the delete button stops the open from firing.
          <div
            className={`composition-row ${composition.id === activeCompositionId ? "active" : ""}`}
            key={composition.id}
            role="button"
            tabIndex={0}
            onClick={() => setActiveComposition(composition.id)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setActiveComposition(composition.id); }}
          >
            <Clapperboard size={14} />
            <input
              aria-label={`Rename ${composition.title}`}
              defaultValue={composition.title}
              onFocus={() => setActiveComposition(composition.id)}
              onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); }}
              onBlur={(event) => {
                const next = event.currentTarget.value.trim();
                if (next && next !== composition.title) renameComposition(composition.id, next);
              }}
            />
            <small>{formatTime(segmentsDuration(composition.segments))}</small>
            <button type="button" className="composition-delete" aria-label={`Delete ${composition.title}`} onClick={(event) => { event.stopPropagation(); remove(composition.id, composition.title); }}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      {!compositions.length && <p className="source-manager-copy">Select words in the episode, then add them to a new composition to shape a hook or clip.</p>}
    </section>
  );
}
