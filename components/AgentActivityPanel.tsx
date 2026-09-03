"use client";

import { useMemo } from "react";
import { CheckCircle2, CircleAlert, Radio } from "lucide-react";
import { buildWebMCPTools } from "@/lib/webmcp/tools";
import { useEditorStore } from "@/lib/store";

export function AgentActivityPanel({ webMcpAvailable }: { webMcpAvailable: boolean }) {
  const activity = useEditorStore((state) => state.activity);
  const toolNames = useMemo(() => buildWebMCPTools(useEditorStore).map((tool) => tool.name), []);

  return (
    <aside className="agent-panel">
      <div className="agent-heading">
        <div><p className="panel-kicker">Log</p><h2>On the record</h2></div>
        <span className={`connection ${webMcpAvailable ? "live" : ""}`}><Radio size={12} />WebMCP</span>
      </div>
      <p className="agent-copy">{toolNames.length} actions exposed through WebMCP.</p>
      <details className="tool-index">
        <summary>Action surface</summary>
        <div>{toolNames.map((name) => <span key={name}>{name}</span>)}</div>
      </details>
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
