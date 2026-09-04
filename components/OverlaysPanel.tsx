"use client";

import { useState } from "react";
import { Captions, CaptionsOff, ImagePlus, Trash2, UserRound } from "lucide-react";
import { useEditorStore } from "@/lib/store";
import { formatTime } from "./MediaPreview";

/** Captions and timed images layered over the preview. */
export function OverlaysPanel() {
  const overlays = useEditorStore((state) => state.overlays);
  const captionsEnabled = useEditorStore((state) => state.captionsEnabled);
  const setCaptionsEnabled = useEditorStore((state) => state.setCaptionsEnabled);
  const backgroundRemoval = useEditorStore((state) => state.backgroundRemoval);
  const setBackgroundRemoval = useEditorStore((state) => state.setBackgroundRemoval);
  const mediaKind = useEditorStore((state) => state.mediaKind);
  const addImageOverlay = useEditorStore((state) => state.addImageOverlay);
  const removeOverlay = useEditorStore((state) => state.removeOverlay);
  const addActivity = useEditorStore((state) => state.addActivity);
  const [url, setUrl] = useState("");
  const [layer, setLayer] = useState<"over" | "under">("over");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    setError(null);
    try {
      const state = useEditorStore.getState();
      const selectedWords = state.words.filter((word) => state.selectedWordIds.includes(word.id));
      // The selection scopes the image; otherwise it runs 5s from the playhead.
      const start = selectedWords.length ? Math.min(...selectedWords.map((word) => word.start)) : state.playbackTime;
      const end = selectedWords.length ? Math.max(...selectedWords.map((word) => word.end)) : Math.min(state.duration || start + 5, start + 5);
      const overlay = addImageOverlay({ url, start, end, layer });
      setUrl("");
      addActivity("add_image_overlay", `Placed “${overlay.name}” (${overlay.layer}) from ${formatTime(overlay.start)} to ${formatTime(overlay.end)}.`, "success");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add this image.");
    }
  };

  return (
    <section className="overlays-panel">
      <div><p className="panel-kicker">On screen</p><h2>Captions &amp; images</h2></div>
      <button type="button" className="captions-row" onClick={() => setCaptionsEnabled(!captionsEnabled)}>
        {captionsEnabled ? <Captions size={14} /> : <CaptionsOff size={14} />}
        <span>Auto captions</span>
        <small>{captionsEnabled ? "On" : "Off"}</small>
      </button>
      {mediaKind === "video" && (
        <button type="button" className="captions-row" onClick={() => setBackgroundRemoval(!backgroundRemoval)}>
          <UserRound size={14} />
          <span>Remove background</span>
          <small>{backgroundRemoval ? "On" : "Off"}</small>
        </button>
      )}
      {overlays.length > 0 && (
        <div className="overlay-list">
          {overlays.map((overlay) => (
            <div className="overlay-row" key={overlay.id}>
              <em>{overlay.layer}</em>
              <span>{overlay.name}</span>
              <small>{formatTime(overlay.start)}–{formatTime(overlay.end)}</small>
              <button type="button" className="composition-delete" aria-label={`Remove ${overlay.name}`} onClick={() => { if (removeOverlay(overlay.id)) addActivity("remove_overlay", `Removed “${overlay.name}”.`, "success"); }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="overlay-add">
        <input
          aria-label="Image URL"
          placeholder="Image URL — spans the selection, or 5s at the playhead"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") add(); }}
        />
        <select aria-label="Layer" value={layer} onChange={(event) => setLayer(event.target.value as "over" | "under")}>
          <option value="over">over</option>
          <option value="under">under</option>
        </select>
        <button type="button" onClick={add} disabled={!url.trim()} aria-label="Add image"><ImagePlus size={14} /></button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
