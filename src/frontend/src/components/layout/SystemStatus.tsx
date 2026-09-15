import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Database, Cpu, Radio } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SystemHealth {
  api: "connected" | "connecting" | "unavailable";
  database: "connected" | "connecting" | "unavailable";
  forecastEngine: "ready" | "connecting" | "unavailable";
  dataSource: "DEMO_AIS" | "AIS" | "OFFLINE";
}

export function SystemStatus({ compact = false, className }: { compact?: boolean; className?: string }) {
  const [health, setHealth] = useState<SystemHealth>({
    api: "connecting",
    database: "connecting",
    forecastEngine: "connecting",
    dataSource: "DEMO_AIS",
  });

  useEffect(() => {
    let alive = true;
    const checkHealth = async () => {
      try {
        const res = await fetch("/health");
        if (res.ok) {
          if (alive) {
            setHealth({
              api: "connected",
              database: "connected",
              forecastEngine: "ready",
              dataSource: "DEMO_AIS",
            });
          }
        } else {
          if (alive) {
            setHealth({
              api: "unavailable",
              database: "unavailable",
              forecastEngine: "unavailable",
              dataSource: "OFFLINE",
            });
          }
        }
      } catch {
        if (alive) {
          setHealth({
            api: "unavailable",
            database: "unavailable",
            forecastEngine: "unavailable",
            dataSource: "OFFLINE",
          });
        }
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  if (compact) {
    const isOk = health.api === "connected";
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border select-none",
          isOk
            ? "bg-[var(--status-success-bg)] text-[var(--status-success)] border-[var(--status-success-border)]"
            : "bg-[var(--status-critical-bg)] text-[var(--status-critical)] border-[var(--status-critical-border)]",
          className
        )}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: isOk ? "var(--status-success)" : "var(--status-critical)" }} />
        <span className="tracking-wide uppercase font-semibold text-[10px] sm:text-[11px]">{isOk ? "OPERATIONAL" : "UNAVAILABLE"}</span>
        <span className="hidden sm:inline text-[var(--text-muted)] font-normal text-[10px]">({health.dataSource})</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "p-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-elevated)] text-xs space-y-2 select-none",
        className
      )}
    >
      <div className="flex items-center justify-between font-semibold text-[11px] uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border-subtle)] pb-1.5">
        <span>System Telemetry</span>
        <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-accent)] font-mono">
          {health.dataSource}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
          <div className="truncate">
            <div className="text-[10px] text-[var(--text-muted)]">API Gateway</div>
            <div className="flex items-center gap-1 font-medium text-[11px]">
              {health.api === "connected" ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-[var(--status-success)]" />
                  <span className="text-[var(--status-success)]">Connected</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3 h-3 text-[var(--status-critical)]" />
                  <span className="text-[var(--status-critical)]">Offline</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
          <div className="truncate">
            <div className="text-[10px] text-[var(--text-muted)]">PostgreSQL</div>
            <div className="flex items-center gap-1 font-medium text-[11px]">
              {health.database === "connected" ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-[var(--status-success)]" />
                  <span className="text-[var(--status-success)]">Connected</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3 h-3 text-[var(--status-critical)]" />
                  <span className="text-[var(--status-critical)]">Offline</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
          <div className="truncate">
            <div className="text-[10px] text-[var(--text-muted)]">ML Engine</div>
            <div className="flex items-center gap-1 font-medium text-[11px]">
              {health.forecastEngine === "ready" ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-[var(--status-success)]" />
                  <span className="text-[var(--status-success)]">CP-SAT / LGBM</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3 h-3 text-[var(--status-critical)]" />
                  <span className="text-[var(--status-critical)]">Standby</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
