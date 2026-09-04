"use client";

import { useRef, useState } from "react";
import { Captions, CaptionsOff, FolderOpen, ImagePlus, Trash2, UserRound } from "lucide-react";
import { useEditorStore } from "@/lib/store";
import { formatTime } from "./MediaPreview";

/**
 * Local images are stored inside the project as data URLs, so they survive
 * reloads, always render in exports (same-origin), and stay small enough for
 * the 4MB project snapshot: downscaled and JPEG-compressed unless the format
 * suggests transparency worth keeping.
 */
async function fileToCompressedDataUrl(file: File, maxWidth = 1600): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Could not read this image file."));
      element.src = objectUrl;
    });
    const scale = Math.min(1, maxWidth / Math.max(1, image.naturalWidth));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const wantsAlpha = file.type === "image/png" || file.type === "image/webp";
    if (wantsAlpha) {
      const png = canvas.toDataURL("image/png");
      if (png.length < 1_500_000) return png;
    }
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

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
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [layer, setLayer] = useState<"over" | "under">("over");
  const [error, setError] = useState<string | null>(null);

  const place = (imageUrl: string, name?: string) => {
    setError(null);
    try {
      const state = useEditorStore.getState();
      const selectedWords = state.words.filter((word) => state.selectedWordIds.includes(word.id));
      // The selection scopes the image; otherwise it runs 5s from the playhead.
      const start = selectedWords.length ? Math.min(...selectedWords.map((word) => word.start)) : state.playbackTime;
      const end = selectedWords.length ? Math.max(...selectedWords.map((word) => word.end)) : Math.min(state.duration || start + 5, start + 5);
      const overlay = addImageOverlay({ url: imageUrl, start, end, layer, name });
      setUrl("");
      addActivity("add_image_overlay", `Placed “${overlay.name}” (${overlay.layer}) from ${formatTime(overlay.start)} to ${formatTime(overlay.end)}.`, "success");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add this image.");
    }
  };

  const add = () => place(url);

  const addLocalFile = async (file: File) => {
    setError(null);
    try {
      place(await fileToCompressedDataUrl(file), file.name.replace(/\.[a-z0-9]+$/i, ""));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read this image file.");
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
        <button type="button" onClick={() => fileInput.current?.click()} aria-label="Add image from this computer"><FolderOpen size={14} /></button>
        <button type="button" onClick={add} disabled={!url.trim()} aria-label="Add image"><ImagePlus size={14} /></button>
      </div>
      <input ref={fileInput} className="sr-only" type="file" accept="image/*" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void addLocalFile(file);
      }} />
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
