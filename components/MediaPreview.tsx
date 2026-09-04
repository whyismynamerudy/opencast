"use client";

import { useEffect, useRef, useState } from "react";
import { Captions, CaptionsOff, Pause, Play } from "lucide-react";
import { captionWindow } from "@/lib/captions";
import { rangeAt } from "@/lib/edits";
import { masterToSourceTime, sourceToMasterTime } from "@/lib/multicam";
import { useEditorStore } from "@/lib/store";
import type { TimeRange } from "@/lib/types";

export function MediaPreview({ cuts }: { cuts: TimeRange[] }) {
  const mediaUrl = useEditorStore((state) => state.mediaUrl);
  const mediaKind = useEditorStore((state) => state.mediaKind);
  const mediaName = useEditorStore((state) => state.mediaName);
  const words = useEditorStore((state) => state.words);
  const overlays = useEditorStore((state) => state.overlays);
  const captionsEnabled = useEditorStore((state) => state.captionsEnabled);
  const setCaptionsEnabled = useEditorStore((state) => state.setCaptionsEnabled);
  const backgroundRemoval = useEditorStore((state) => state.backgroundRemoval);
  const segCanvasRef = useRef<HTMLCanvasElement>(null);
  const [segReady, setSegReady] = useState(false);

  // Captions and image layers must composite against the footage's own
  // frame, not the preview pane: a 16:9 video letterboxed in a tall pane
  // would otherwise get a portrait background and far-away captions. The
  // stage frame tracks the source aspect ratio (16:9 for audio) and fits
  // inside the pane — the same geometry the composed export renders.
  const stageRef = useRef<HTMLDivElement>(null);
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || !rect.width || !rect.height) return;
      let width = rect.width;
      let height = width / videoAspect;
      if (height > rect.height) {
        height = rect.height;
        width = height * videoAspect;
      }
      setFrameSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [videoAspect, mediaUrl]);
  const activeSourceId = useEditorStore((state) => state.activeSourceId);
  const activeSource = useEditorStore((state) => state.mediaSources.find((source) => source.id === state.activeSourceId));
  const time = useEditorStore((state) => state.playbackTime);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const setPlaybackTime = useEditorStore((state) => state.setPlaybackTime);
  const setIsPlaying = useEditorStore((state) => state.setIsPlaying);
  const mediaRef = useRef<HTMLMediaElement>(null);
  const [storedMedia, setStoredMedia] = useState<{ sourceId: string; url: string } | null>(null);

  useEffect(() => {
    if (activeSource?.localUrl || !activeSource?.storagePath) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/media/playback-ticket", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceId: activeSource.id }),
          signal: controller.signal,
        });
        const payload = await response.json() as { url?: string };
        if (!response.ok || !payload.url) throw new Error("Could not load the stored media preview.");
        if (!controller.signal.aborted) setStoredMedia({ sourceId: activeSource.id, url: payload.url });
      } catch { /* The empty preview is clearer than an expired stored URL. */ }
    })();
    return () => controller.abort();
  }, [activeSource?.id, activeSource?.localUrl, activeSource?.storagePath]);

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

  // Live background removal: the footage draws to a canvas with the person
  // isolated, so the under layer shows through in real time.
  useEffect(() => {
    if (!backgroundRemoval || mediaKind !== "video") return;
    let disposed = false;
    let frame = 0;
    void import("@/lib/segmentation").then(async ({ createBackgroundRemover }) => {
      try {
        const remover = await createBackgroundRemover();
        if (disposed) return;
        setSegReady(true);
        const loop = () => {
          if (disposed) return;
          const video = mediaRef.current as HTMLVideoElement | null;
          const canvas = segCanvasRef.current;
          const context = canvas?.getContext("2d");
          if (video && canvas && context && video.videoWidth) {
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }
            context.clearRect(0, 0, canvas.width, canvas.height);
            remover.draw(context, video, video.videoWidth, video.videoHeight, canvas.width, canvas.height);
          }
          frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
      } catch {
        if (!disposed) {
          useEditorStore.getState().addActivity("set_background_removal", "The background model could not load in this browser; showing the full frame.", "error");
        }
      }
    });
    return () => { disposed = true; cancelAnimationFrame(frame); };
  }, [backgroundRemoval, mediaKind]);

  const segActive = segReady && backgroundRemoval && mediaKind === "video";
  const previewUrl = mediaUrl ?? (storedMedia && storedMedia.sourceId === activeSource?.id ? storedMedia.url : null);

  if (!previewUrl) {
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
    src: previewUrl,
    onTimeUpdate: () => setPlaybackTime(sourceToMasterTime(mediaRef.current?.currentTime ?? 0, activeSource?.syncOffset)),
    onEnded: () => setIsPlaying(false),
    onLoadedMetadata: () => {
      const video = mediaRef.current as HTMLVideoElement | null;
      if (video?.videoWidth && video.videoHeight) setVideoAspect(video.videoWidth / video.videoHeight);
    },
  };

  const underImage = overlays.findLast((overlay) => overlay.layer === "under" && time >= overlay.start && time <= overlay.end);
  const overImage = overlays.findLast((overlay) => overlay.layer === "over" && time >= overlay.start && time <= overlay.end);
  const caption = captionsEnabled ? captionWindow(words, time) : { words: [], activeId: null };

  return (
    <section className={`preview ${mediaKind === "audio" ? "audio-preview" : ""}`}>
      <div className="media-stage" ref={stageRef}>
        <div className="stage-frame" style={frameSize ? { width: frameSize.width, height: frameSize.height } : undefined}>
          {underImage && <img className="stage-layer stage-under" src={underImage.url} alt={underImage.name} />}
          {mediaKind === "video" ? <video {...shared} playsInline className={segActive ? "video-hidden" : ""} /> : <audio {...shared} />}
          {segActive && <canvas ref={segCanvasRef} className="stage-layer stage-person" aria-hidden="true" />}
          {mediaKind === "audio" && !overImage && <div className="audio-art"><span>OPENCAST</span><strong>{mediaName}</strong><i /></div>}
          {overImage && <img className="stage-layer stage-over" src={overImage.url} alt={overImage.name} />}
          {caption.words.length > 0 && (
            <p className="caption-track" aria-live="off">
              {caption.words.map((word) => (
                <span key={word.id} className={word.id === caption.activeId ? "active" : ""}>{word.text}</span>
              ))}
            </p>
          )}
        </div>
      </div>
      <div className="preview-controls">
        <span className="preview-time">{formatTime(time)}</span>
        <button type="button" className="round-control" aria-label={isPlaying ? "Pause" : "Play"} onClick={() => setIsPlaying(!isPlaying)}>
          {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <span className="preview-side">
          <button type="button" className="caption-toggle" aria-label={captionsEnabled ? "Hide captions" : "Show captions"} onClick={() => setCaptionsEnabled(!captionsEnabled)}>
            {captionsEnabled ? <Captions size={15} /> : <CaptionsOff size={15} />}
          </button>
          <span className="muted">{activeSourceId ? "angle preview · master time" : "edited playback"}</span>
        </span>
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
