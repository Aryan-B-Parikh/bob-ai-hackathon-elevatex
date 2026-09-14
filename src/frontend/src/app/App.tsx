import { useState, Suspense } from "react";
import { AppShell } from "../components/layout/AppShell";
import { TABS_REGISTRY } from "./routes";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export default function App() {
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const queryClient = useQueryClient();

  const currentTabConfig = TABS_REGISTRY[activeTab] || TABS_REGISTRY.overview;
  const CurrentPageComponent = currentTabConfig.Component;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
      toast.success("Telemetry updated", {
        description: "Successfully refreshed live port observations and engine state.",
      });
    } catch {
      toast.error("Telemetry refresh failed", {
        description: "Could not reach the FastAPI gateway. Check database and server status.",
      });
    } finally {
      setTimeout(() => setRefreshing(false), 600);
    }
  };

  return (
    <AppShell
      activeTab={activeTab}
      onSelectTab={(tabId) => setActiveTab(tabId)}
      activeTitle={currentTabConfig.title}
      activeSubtitle={currentTabConfig.subtitle}
      onRefresh={handleRefresh}
      refreshing={refreshing}
    >
      <Suspense
        fallback={
          <div className="flex items-center justify-center p-16 text-xs font-mono text-[var(--text-muted)] animate-pulse">
            Synchronizing engine state...
          </div>
        }
      >
        <CurrentPageComponent onNavigateTab={(tabId: string) => setActiveTab(tabId)} />
      </Suspense>
    </AppShell>
  );
}
