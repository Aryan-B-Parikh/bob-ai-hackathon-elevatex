"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type BobMessage } from "@/lib/api";
import { SectionHeader } from "@/components/dashboard/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Bot, Send, Sparkles, Wrench } from "lucide-react";

const QUICK_PROMPTS = [
  "What's the congestion outlook for the next 72 hours?",
  "Which vessels should divert?",
  "Optimise berth assignments",
  "Generate the 72h plan summary",
];

const GREETING =
  "Hi, I'm Bob. Ask me about congestion outlook, berth assignments, divert options, or the 72-hour plan — I run the engines live and answer with their numbers.";

// Tiny **bold** renderer (no markdown dependency): split on "**" pairs, alternate strong.
function renderInline(text: string): ReactNode[] {
  return text.split("**").map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function RichText({ content }: { content: string }) {
  return (
    <div className="space-y-1">
      {content.split("\n").map((line, i) => (
        <div key={i}>{line.length > 0 ? renderInline(line) : "\u00A0"}</div>
      ))}
    </div>
  );
}

function ActionChips({ meta }: { meta: BobMessage["meta"] }) {
  const actions = meta?.actions ?? [];
  if (actions.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {actions.map((a, i) => (
        <span
          key={i}
          title={a.detail}
          className="inline-flex max-w-[280px] items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
        >
          <Wrench className="h-2.5 w-2.5 shrink-0" aria-hidden />
          <span className="truncate">
            {a.tool}: {a.detail}
          </span>
        </span>
      ))}
      {meta?.mode ? (
        <Badge
          variant="outline"
          className={cn(
            "px-1.5 py-0 font-mono text-[9px]",
            meta.mode === "llm"
              ? "border-teal-500/40 bg-teal-500/10 text-teal-300"
              : "border-amber-500/40 bg-amber-500/10 text-amber-300",
          )}
        >
          {meta.mode === "llm" ? "engine-grounded" : "offline fallback"}
        </Badge>
      ) : null}
    </div>
  );
}

export default function BobTab() {
  const { data } = useQuery({ queryKey: ["bob"], queryFn: api.bobHistory });
  const [messages, setMessages] = useState<BobMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Display list: server history until the user starts chatting locally, then
  // the local list (which contains the user message + Bob's replies).
  const shown = messages.length > 0 ? messages : (data?.messages ?? []);

  const mutation = useMutation({
    mutationFn: (message: string) => api.sendBob(message),
    onSuccess: (res) => setMessages((prev) => [...prev, res.reply]),
    onError: () => toast.error("Bob is unavailable right now — try again shortly"),
  });
  const pending = mutation.isPending;

  const send = (text: string) => {
    const message = text.trim();
    if (!message || pending) return;
    const history = data?.messages ?? [];
    setMessages((prev) => [
      ...(prev.length > 0 ? prev : history),
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: message,
        createdAt: new Date().toISOString(),
      },
    ]);
    mutation.mutate(message);
  };

  // Auto-scroll to the newest message (or the pending placeholder).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    send(input);
    setInput("");
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Bob AI"
        desc="Load-bearing assistant — it actually calls the forecast, optimiser, routing and plan engines server-side"
        icon={Bot}
      />

      <Card className="flex h-[calc(100vh-260px)] min-h-[420px] flex-col gap-0 overflow-hidden border-border/60 bg-card/70 py-0">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-teal-500/30 bg-teal-500/10">
            <Bot className="h-5 w-5 text-teal-300" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Bob — port operations assistant</div>
            <div className="truncate text-[11px] text-muted-foreground">
              Answers are grounded in live engine output: forecast · optimiser · routing · plan
            </div>
          </div>
        </div>

        {/* messages */}
        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-label="Bob conversation"
          className="flex flex-1 flex-col space-y-3 overflow-y-auto p-4"
        >
          {shown.length === 0 && !pending ? (
            <div className="max-w-[85%] self-start rounded-xl border border-border/60 bg-card px-3.5 py-2.5 text-sm leading-relaxed text-muted-foreground">
              {GREETING}
            </div>
          ) : null}

          {shown.map((m) => {
            const isUser = m.role === "user";
            return (
              <div
                key={m.id}
                className={cn(
                  "max-w-[85%] rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed",
                  isUser
                    ? "self-end border-teal-500/30 bg-teal-600/20"
                    : "self-start border-border/60 bg-card",
                )}
              >
                <RichText content={m.content} />
                {!isUser ? <ActionChips meta={m.meta} /> : null}
              </div>
            );
          })}

          {pending ? (
            <div
              className="self-start rounded-xl border border-border/60 bg-card px-4 py-3"
              aria-label="Bob is thinking"
            >
              <div className="flex items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* input */}
        <form onSubmit={onSubmit} className="border-t border-border/60 p-3">
          <div className="flex flex-wrap gap-1.5 pb-2.5">
            {QUICK_PROMPTS.map((p) => (
              <Button
                key={p}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full px-2.5 text-[11px] font-normal"
                disabled={pending}
                onClick={() => send(p)}
              >
                <Sparkles className="h-3 w-3 text-teal-300" aria-hidden />
                {p}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about congestion, berths, routing, or the 72-hour plan…"
              disabled={pending}
              maxLength={600}
              aria-label="Message Bob"
            />
            <Button type="submit" disabled={pending || input.trim().length === 0}>
              <Send className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Send</span>
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
