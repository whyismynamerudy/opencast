"use client";

import { Scissors } from "lucide-react";
import { originalToEdited } from "@/lib/edits";
import { useEditorStore } from "@/lib/store";
import type { ClipSegment, TimeRange, Word } from "@/lib/types";
import { formatTime } from "./MediaPreview";

export function Timeline({ cuts, clips, words }: { cuts: TimeRange[]; clips: ClipSegment[]; words: Word[] }) {
  const duration = useEditorStore((state) => state.duration);
  const playbackTime = useEditorStore((state) => state.playbackTime);
  const setPlaybackTime = useEditorStore((state) => state.setPlaybackTime);
  const splitAt = useEditorStore((state) => state.splitAt);
  const waveform = useEditorStore((state) => state.transcription.waveform);
  const programSegments = useEditorStore((state) => state.programSegments);
  const sources = useEditorStore((state) => state.mediaSources);
  const editedSeconds = Math.max(0, duration - cuts.reduce((total, cut) => total + cut.end - cut.start, 0));

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const box = event.currentTarget.getBoundingClientRect();
    const time = ((event.clientX - box.left) / box.width) * duration;
    setPlaybackTime(Math.max(0, Math.min(duration, time)));
  };

  return (
    <section className="timeline-panel">
      <div className="timeline-heading">
        <div><p className="panel-kicker">ORIGINAL TIMELINE</p><h2>Every edit has a visible cause.</h2></div>
        <div className="timeline-metrics"><span>{formatTime(editedSeconds)} edited</span><span>{cuts.length} cuts</span><span>{clips.length} clips</span></div>
      </div>
      <div className="ruler"><span>0:00</span><span>{formatTime(duration / 2)}</span><span>{formatTime(duration)}</span></div>
      {programSegments.length > 0 && <div className="program-lane" aria-label="Program angle timeline">
        {programSegments.map((segment) => {
          const source = sources.find((item) => item.id === segment.sourceId);
          return <span key={segment.id} title={`${source?.name ?? "Unknown source"}: ${formatTime(segment.start)}–${formatTime(segment.end)}`} style={{ left: `${duration ? (segment.start / duration) * 100 : 0}%`, width: `${duration ? ((segment.end - segment.start) / duration) * 100 : 0}%` }}>{source?.role ?? "source"}</span>;
        })}
      </div>}
      <div className="timeline-track" role="slider" tabIndex={0} aria-label="Timeline" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={playbackTime} onClick={seek}>
        <div className="timeline-base">{waveform.length > 0 && <div className="waveform" aria-hidden="true">{waveform.map((value, index) => <i key={index} style={{ height: `${Math.max(8, value * 100)}%` }} />)}</div>}</div>
        {clips.map((clip) => <div key={clip.id} className="clip-band" style={{ left: `${(clip.start / duration) * 100}%`, width: `${((clip.end - clip.start) / duration) * 100}%` }} />)}
        {cuts.map((cut, index) => <div key={`${cut.start}-${index}`} className="cut-band" style={{ left: `${(cut.start / duration) * 100}%`, width: `${((cut.end - cut.start) / duration) * 100}%` }} />)}
        <div className="word-lane">
          {words.map((word) => <i key={word.id} className={word.deleted ? "word-tick deleted" : "word-tick"} style={{ left: `${(word.start / duration) * 100}%`, width: `${Math.max(0.35, ((word.end - word.start) / duration) * 100)}%` }} />)}
        </div>
        <div className="playhead" style={{ left: `${duration ? (playbackTime / duration) * 100 : 0}%` }}><b /></div>
      </div>
      <div className="timeline-footer">
        <span>Original {formatTime(playbackTime)} · Cut timeline {formatTime(originalToEdited(playbackTime, cuts))}</span>
        <button type="button" onClick={() => splitAt(playbackTime)} disabled={!duration}><Scissors size={14} /> Split at playhead</button>
      </div>
    </section>
  );
}
