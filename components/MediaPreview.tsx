"use client";

import { useEffect, useRef } from "react";
import { Pause, Play } from "lucide-react";
import { rangeAt } from "@/lib/edits";
import { masterToSourceTime, sourceToMasterTime } from "@/lib/multicam";
import { useEditorStore } from "@/lib/store";
import type { TimeRange } from "@/lib/types";

export function MediaPreview({ cuts }: { cuts: TimeRange[] }) {
  const mediaUrl = useEditorStore((state) => state.mediaUrl);
  const mediaKind = useEditorStore((state) => state.mediaKind);
  const mediaName = useEditorStore((state) => state.mediaName);
  const activeSourceId = useEditorStore((state) => state.activeSourceId);
  const activeSource = useEditorStore((state) => state.mediaSources.find((source) => source.id === state.activeSourceId));
  const time = useEditorStore((state) => state.playbackTime);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const setPlaybackTime = useEditorStore((state) => state.setPlaybackTime);
  const setIsPlaying = useEditorStore((state) => state.setIsPlaying);
  const mediaRef = useRef<HTMLMediaElement>(null);

  useEffect(() => {
    const media = mediaRef.current;
    const sourceTime = masterToSourceTime(time, activeSource?.syncOffset);
    if (!media || Math.abs(media.currentTime - sourceTime) < 0.3) return;
    media.currentTime = sourceTime;
  }, [activeSource?.syncOffset, time]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (isPlaying) void media.play().catch(() => setIsPlaying(false));
    else media.pause();
  }, [isPlaying, setIsPlaying]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !isPlaying) return;
    let frame = 0;
    const advance = () => {
      const masterTime = sourceToMasterTime(media.currentTime, activeSource?.syncOffset);
      const cut = rangeAt(masterTime, cuts);
      if (cut) media.currentTime = Math.min(media.duration || cut.end, masterToSourceTime(cut.end + 0.006, activeSource?.syncOffset));
      setPlaybackTime(sourceToMasterTime(media.currentTime, activeSource?.syncOffset));
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [activeSource?.syncOffset, cuts, isPlaying, setPlaybackTime]);

  if (!mediaUrl) {
    return (
      <section className="preview empty-preview">
        <div className="empty-preview-content">
          <span className="preview-orb">◒</span>
          <p>Import matching media to preview the edit.</p>
          <small>The transcript editor is already ready.</small>
        </div>
      </section>
    );
  }

  const shared = {
    ref: mediaRef as React.RefObject<HTMLVideoElement> & React.RefObject<HTMLAudioElement>,
    src: mediaUrl,
    onTimeUpdate: () => setPlaybackTime(sourceToMasterTime(mediaRef.current?.currentTime ?? 0, activeSource?.syncOffset)),
    onEnded: () => setIsPlaying(false),
  };

  return (
    <section className={`preview ${mediaKind === "audio" ? "audio-preview" : ""}`}>
      <div className="media-stage">
        {mediaKind === "video" ? <video {...shared} playsInline /> : <audio {...shared} />}
        {mediaKind === "audio" && <div className="audio-art"><span>OPENCAST</span><strong>{mediaName}</strong><i /></div>}
      </div>
      <div className="preview-controls">
        <span className="preview-time">{formatTime(time)}</span>
        <button type="button" className="round-control" aria-label={isPlaying ? "Pause" : "Play"} onClick={() => setIsPlaying(!isPlaying)}>
          {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <span className="muted">{activeSourceId ? "angle preview · master time" : "edited playback"}</span>
      </div>
    </section>
  );
}

export function formatTime(value: number): string {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
