import { useState, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Toaster } from "sonner";
import { cn } from "../../lib/utils";

export interface AppShellProps {
  activeTab: string;
  onSelectTab: (id: string) => void;
  activeTitle?: string;
  activeSubtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: React.ReactNode;
}

export function AppShell({
  activeTab,
  onSelectTab,
  activeTitle,
  activeSubtitle,
  onRefresh,
  refreshing = false,
  children,
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Body scroll lock and Escape key handler for mobile drawer
  useEffect(() => {
    if (!mobileMenuOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileMenuOpen]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)]">
      {/* Toast notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--bg-surface-elevated)",
            borderColor: "var(--border-default)",
            color: "var(--text-primary)",
            fontSize: "12px",
          },
        }}
      />

      {/* Desktop Navigation Sidebar (>= 768px) */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        className="hidden md:flex"
      />

      {/* Mobile Drawer Navigation (< 768px) */}
      {mobileMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation Menu"
          className="fixed inset-0 z-50 md:hidden flex"
        >
          {/* Dark Backdrop */}
          <div
            className="fixed inset-0 bg-black/65 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Panel */}
          <div className="relative z-50 w-72 max-w-[85vw] h-full flex flex-col shadow-2xl animate-in slide-in-from-left duration-200">
            <Sidebar
              activeTab={activeTab}
              onSelectTab={(tab) => {
                onSelectTab(tab);
                setMobileMenuOpen(false);
              }}
              collapsed={false}
              onCloseMobile={() => setMobileMenuOpen(false)}
              className="w-full h-full border-r-0"
            />
          </div>
        </div>
      )}

      {/* Right Content Column */}
      <div className="flex-1 flex flex-col min-w-0 w-full overflow-hidden">
        {/* Topbar */}
        <Topbar
          activeTitle={activeTitle}
          activeSubtitle={activeSubtitle}
          onRefresh={onRefresh}
          refreshing={refreshing}
          onToggleMobileMenu={() => setMobileMenuOpen(true)}
        />

        {/* Scrollable Page Body */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 flex flex-col justify-between">
          <div className="flex-1 pb-10 w-full min-w-0">{children}</div>

          {/* Operational Methodology Footer */}
          <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-4 text-[11px] text-[var(--text-muted)] space-y-1 select-none shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <strong className="text-[var(--text-secondary)] font-medium">Engines:</strong> LightGBM Quantile Regression (24/48/72h) · OR-Tools CP-SAT (BAP/QCAP) · SimPy Operations Layer
                </span>
                <span>·</span>
                <span>
                  <strong className="text-[var(--text-secondary)] font-medium">Anomaly:</strong> Isolation Forest
                </span>
                <span>·</span>
                <span>
                  <strong className="text-[var(--text-secondary)] font-medium">Assistant:</strong> IBM Bob via MCP
                </span>
              </div>
              <div className="font-mono text-[10px] text-[var(--text-muted)]">
                PortFlow SBX v0.1.0 · San Pedro Bay (POLB/POLA)
              </div>
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">
              Data Honesty: Terminal capacity = official Port of Long Beach fact sheets. Vessel queue and 14-day hourly history = labelled synthetic <code className="text-[var(--text-accent)] font-mono">DEMO_AIS</code>.
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
