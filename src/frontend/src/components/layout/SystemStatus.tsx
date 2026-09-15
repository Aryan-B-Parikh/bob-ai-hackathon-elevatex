import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Radio } from "lucide-react";
import { cn } from "../../lib/utils";

interface SystemHealth {
  api: "connected" | "connecting" | "unavailable";
  dataSource: string;
}

export function SystemStatus({ compact = false, className }: { compact?: boolean; className?: string }) {
  const [health, setHealth] = useState<SystemHealth>({
    api: "connecting",
    dataSource: "…",
  });

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        // Use /api/overview — it returns the real dataset.source the engines are using
        const res = await fetch("/api/overview");
        if (!alive) return;
        if (res.ok) {
          const body = await res.json();
          setHealth({
            api: "connected",
            dataSource: body?.dataset?.source ?? "AIS",
          });
        } else {
          setHealth({ api: "unavailable", dataSource: "—" });
        }
      } catch {
        if (alive) setHealth({ api: "unavailable", dataSource: "—" });
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const isOk = health.api === "connected";

  if (compact) {
    return (
      <div className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border select-none",
        isOk
          ? "bg-[var(--status-success-bg)] text-[var(--status-success)] border-[var(--status-success-border)]"
          : "bg-[var(--status-critical-bg)] text-[var(--status-critical)] border-[var(--status-critical-border)]",
        className,
      )}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: isOk ? "var(--status-success)" : "var(--status-critical)" }} />
        <span className="tracking-wide uppercase font-semibold text-[10px] sm:text-[11px]">
          {isOk ? "OPERATIONAL" : "UNAVAILABLE"}
        </span>
        {isOk && (
          <span className="hidden sm:inline text-[var(--text-muted)] font-normal text-[10px]">
            ({health.dataSource})
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={cn(
      "p-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-elevated)] text-xs space-y-2 select-none",
      className,
    )}>
      <div className="flex items-center justify-between font-semibold text-[11px] uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border-subtle)] pb-1.5">
        <span>System Telemetry</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-accent)] font-mono">
          {health.dataSource}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Radio className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
        <div className="truncate">
          <div className="text-[10px] text-[var(--text-muted)]">API Gateway</div>
          <div className="flex items-center gap-1 font-medium text-[11px]">
            {isOk ? (
              <>
                <CheckCircle2 className="w-3 h-3 text-[var(--status-success)]" />
                <span className="text-[var(--status-success)]">Connected</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3 h-3 text-[var(--status-critical)]" />
                <span className="text-[var(--status-critical)]">
                  {health.api === "connecting" ? "Connecting…" : "Offline"}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
