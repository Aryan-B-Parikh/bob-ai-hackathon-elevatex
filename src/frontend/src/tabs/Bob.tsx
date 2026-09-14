// Bob AI tab. Owner: W4. (Integrator keeps the MCP server + services/bob.py in sync.)
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Card } from "../components/ui";

type Msg = { role: string; content: string; actions?: string[]; mode?: string };

export default function Bob() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function send(q?: string) {
    const message = (q ?? text).trim();
    if (!message) return;
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setText(""); setBusy(true);
    try {
      const r = await api.bob(message);
      setMsgs((m) => [...m, { role: "assistant", content: r.content, actions: r.actions, mode: r.mode }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `error: ${e}` }]);
    } finally { setBusy(false); }
  }

  const quick = [
    "what is the congestion outlook for the next 72 hours?",
    "which terminal is the hotspot and what is binding it?",
    "how does the CP-SAT optimiser compare to FIFO?",
    "which vessels should divert and what would we save?",
  ];
  return (
    <div className="grid lg:grid-cols-[1fr_260px] gap-4">
      <Card className="flex flex-col">
        <h3 className="font-semibold mb-2">Bob — engine-grounded ops assistant</h3>
        <div className="flex-1 space-y-3 overflow-y-auto pr-1" style={{ maxHeight: "58vh" }}>
          {!msgs.length && <div className="muted text-sm">Ask about congestion, hotspots, the optimiser, routing or the 72h plan. Every answer runs the engines; `mode` shows llm vs deterministic fallback. (IBM Bob uses the same brain via MCP.)</div>}
          {msgs.map((m, i) => (
            <div key={i} className={`card-2 p-2 ${m.role === "user" ? "ml-10" : "mr-10"}`}>
              <div className="text-xs muted">{m.role}{m.mode ? ` · ${m.mode}` : ""}</div>
              <div className="text-sm whitespace-pre-wrap">{m.content}</div>
              {!!m.actions?.length && <div className="mt-1 flex flex-wrap gap-1">{m.actions.map((a) => <span key={a} className="chip muted text-[10px]">{a}</span>)}</div>}
            </div>
          ))}
          {busy && <div className="muted text-sm">Bob is running the engines…</div>}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 mt-3">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="e.g. what's the congestion outlook for the next 72 hours?"
            className="card-2 flex-1 px-3 py-2 text-sm" style={{ color: "var(--text)" }} />
          <button onClick={() => send()} disabled={busy} className="chip" style={{ background: "var(--accent)", color: "#04231f", borderColor: "transparent" }}>Ask</button>
        </div>
      </Card>
      <Card>
        <h3 className="font-semibold mb-2 text-sm">Quick prompts</h3>
        <div className="space-y-2">
          {quick.map((q) => <button key={q} onClick={() => send(q)} className="chip block w-full text-left text-xs">{q}</button>)}
        </div>
      </Card>
    </div>
  );
}
