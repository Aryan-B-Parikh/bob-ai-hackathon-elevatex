// Bob AI tab — MCP-grounded assistant with streaming indicator + action chips
import { useEffect, useRef, useState } from "react";
import { Send, Cpu, Zap, MessageSquare, HelpCircle } from "lucide-react";
import { api } from "../lib/api";

type Msg = { role: string; content: string; actions?: string[]; mode?: string };

const QUICK_PROMPTS = [
  "What is the 72-hour congestion outlook for San Pedro Bay?",
  "Which terminal is the hotspot and what resource is binding it?",
  "How does the CP-SAT optimiser compare to FIFO? Give me the deltas.",
  "Which vessels should divert and what is the estimated total savings?",
  "What are the top 3 actions in the next 6-hour shift?",
  "Are there any anomalies detected? Describe the kind and severity.",
];

function ModeChip({ mode }: { mode?: string }) {
  if (!mode) return null;
  const isLlm = mode.includes("llm") || mode.includes("bob") || mode.includes("claude");
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono border"
      style={{
        color: isLlm ? "var(--accent)" : "var(--text-muted)",
        borderColor: isLlm ? "var(--accent)" : "var(--border-subtle)",
        background: isLlm ? `var(--accent)18` : "transparent",
      }}>
      <Cpu className="w-2.5 h-2.5" />
      {mode}
    </span>
  );
}

function ActionChips({ actions }: { actions?: string[] }) {
  if (!actions?.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {actions.map((a) => (
        <span key={a} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--brand)]">
          <Zap className="w-2.5 h-2.5" />
          {a}
        </span>
      ))}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] w-fit">
      <Cpu className="w-3.5 h-3.5 text-[var(--brand)] animate-spin" />
      <span className="text-xs text-[var(--text-muted)]">Running engines…</span>
      <span className="flex gap-0.5">
        {[0,1,2].map((i) => (
          <span key={i} className="w-1 h-1 rounded-full bg-[var(--brand)]"
            style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
        ))}
      </span>
    </div>
  );
}

export default function Bob() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  async function send(q?: string) {
    const message = (q ?? text).trim();
    if (!message || busy) return;
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setText("");
    setBusy(true);
    try {
      const r = await api.bob(message);
      setMsgs((m) => [...m, { role: "assistant", content: r.content, actions: r.actions, mode: r.mode }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `⚠ Engine error: ${e}` }]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="grid lg:grid-cols-[1fr_260px] gap-4 h-full">
      {/* Chat panel */}
      <div className="flex flex-col rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[var(--brand)]" />
            <span className="font-semibold text-sm">Bob — Operations Intelligence</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--text-muted)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)]" />
            MCP · 11 tools live
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: "55vh" }}>
          {!msgs.length && (
            <div className="text-sm text-[var(--text-muted)] space-y-2">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-[var(--brand)] shrink-0" />
                <span>Ask about congestion, hotspots, the CP-SAT optimiser, routing, or the 72h operations plan.</span>
              </div>
              <p className="text-xs">Every answer executes the real engines via MCP tools. The <code className="font-mono text-[10px] px-1 py-0.5 rounded bg-[var(--bg-surface-elevated)]">mode</code> chip shows whether IBM Bob, Claude, or the deterministic fallback phrased the response.</p>
            </div>
          )}

          {msgs.map((m, i) => (
            <div
              key={i}
              className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                m.role === "user"
                  ? "bg-[var(--brand-soft)] border border-[var(--brand-border)] ml-8"
                  : "bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] mr-8"
              }`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">{m.role}</span>
                  <ModeChip mode={m.mode} />
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                <ActionChips actions={m.actions} />
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex items-start">
              <TypingIndicator />
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about congestion, hotspots, the optimiser, routing…"
              disabled={busy}
              className="flex-1 min-w-0 px-3 py-2 rounded-md text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--brand)] disabled:opacity-50 transition-colors"
            />
            <button
              onClick={() => send()}
              disabled={busy || !text.trim()}
              aria-label="Send message"
              className="flex items-center justify-center w-9 h-9 rounded-md bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="text-[9px] text-[var(--text-muted)] mt-1.5 font-mono">Enter to send · Shift+Enter for newline</div>
        </div>
      </div>

      {/* Quick prompts sidebar */}
      <div className="flex flex-col rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]">
          <span className="font-semibold text-sm">Quick prompts</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              disabled={busy}
              className="w-full text-left text-xs px-3 py-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-[var(--text-secondary)]"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="px-4 py-2.5 border-t border-[var(--border-subtle)]">
          <div className="text-[9px] text-[var(--text-muted)] font-mono">
            IBM Bob 2.0 · MCP stdio · 11 tools · Claude / deterministic fallback
          </div>
        </div>
      </div>
    </div>
  );
}
