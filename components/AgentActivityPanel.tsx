"use client";

import { Bot, CheckCircle2, CircleAlert, Radio, Terminal } from "lucide-react";
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
        <div><p className="panel-kicker">Agent</p><h2>Co-editor</h2></div>
        <span className={`connection ${webMcpAvailable ? "live" : ""}`}><Radio size={12} />{webMcpAvailable ? "Live" : "Preview"}</span>
      </div>
      <p className="agent-copy">{webMcpAvailable ? "Shared controls are live." : "Awaiting a WebMCP browser."}</p>
      <div className="tool-chips">
        <button type="button" onClick={() => demoTool("remove_fillers")}><Terminal size={13} /> remove_fillers</button>
        <button type="button" onClick={() => demoTool("remove_silences")}><Terminal size={13} /> remove_silences</button>
      </div>
      <div className="activity-list" aria-live="polite">
        {!activity.length && <div className="activity-empty">Awaiting the first edit.</div>}
        {activity.map((item) => <div className={`activity-row ${item.status}`} key={item.id}>
          {item.status === "error" ? <CircleAlert size={15} /> : <CheckCircle2 size={15} />}
          <div><strong>{item.tool}</strong><span>{item.detail}</span></div>
          <time>{new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        </div>)}
      </div>
    </aside>
  );
}
