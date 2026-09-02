"use client";

import { Bot, CheckCircle2, CircleAlert, Radio, Sparkles } from "lucide-react";
import { useEditorStore } from "@/lib/store";

export function AgentActivityPanel({ webMcpAvailable }: { webMcpAvailable: boolean }) {
  const activity = useEditorStore((state) => state.activity);
  const removeFillers = useEditorStore((state) => state.removeFillers);
  const removeSilences = useEditorStore((state) => state.removeSilences);
  const addActivity = useEditorStore((state) => state.addActivity);

  const demoTool = (name: "remove_fillers" | "remove_silences") => {
    if (name === "remove_fillers") {
      const removed = removeFillers();
      addActivity(name, `Removed ${removed} filler words through the shared action hub.`, "success");
    } else {
      const result = removeSilences();
      addActivity(name, `Removed ${result.count} silent gaps (${result.seconds.toFixed(1)} seconds).`, "success");
    }
  };

  return (
    <aside className="agent-panel">
      <div className="agent-heading">
        <div className="agent-icon"><Bot size={18} /></div>
        <div><p className="panel-kicker">AGENT ACTIVITY</p><h2>Co-editor</h2></div>
        <span className={`connection ${webMcpAvailable ? "live" : ""}`}><Radio size={12} />{webMcpAvailable ? "WebMCP live" : "Preview mode"}</span>
      </div>
      <p className="agent-copy">{webMcpAvailable ? "Your browser exposed OpenCast’s tools to the agent." : "Open in a WebMCP-enabled browser to expose the live tool surface."}</p>
      <div className="tool-chips">
        <button type="button" onClick={() => demoTool("remove_fillers")}><Sparkles size={13} /> Test remove_fillers</button>
        <button type="button" onClick={() => demoTool("remove_silences")}><Sparkles size={13} /> Test remove_silences</button>
      </div>
      <div className="activity-list" aria-live="polite">
        {!activity.length && <div className="activity-empty">Waiting for your first edit or agent tool call.</div>}
        {activity.map((item) => <div className={`activity-row ${item.status}`} key={item.id}>
          {item.status === "error" ? <CircleAlert size={15} /> : <CheckCircle2 size={15} />}
          <div><strong>{item.tool}</strong><span>{item.detail}</span></div>
          <time>{new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        </div>)}
      </div>
    </aside>
  );
}
