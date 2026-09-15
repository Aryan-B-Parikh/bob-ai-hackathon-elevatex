import React from "react";
import OverviewTab from "../tabs/Overview";
import ForecastTab from "../tabs/Forecast";
import BerthCranesTab from "../tabs/BerthCranes";
import RoutingTab from "../tabs/Routing";
import PlanTab from "../tabs/Plan";
import BobTab from "../tabs/Bob";
const CongestionPage = React.lazy(() => import("../pages/CongestionPage"));
const ScenarioPage = React.lazy(() =>
  import("../features/scenarios").then((m) => ({ default: m.ScenarioPage }))
);
const QualityPage = React.lazy(() => import("../pages/QualityPage"));
import { PageContainer } from "../components/layout/PageContainer";
import { PageHeader } from "../components/layout/PageHeader";
import { StatusBadge } from "../components/ui/StatusBadge";

export interface TabConfig {
  id: string;
  title: string;
  subtitle: string;
  breadcrumbs: string[];
  status?: React.ReactNode;
  Component: React.ComponentType<{ onNavigateTab?: (tabId: string) => void }>;
}

export const TABS_REGISTRY: Record<string, TabConfig> = {
  overview: {
    id: "overview",
    title: "Port Operations Overview",
    subtitle: "Real-time San Pedro Bay KPIs, binding constraints, and Isolation Forest anomaly flags",
    breadcrumbs: ["Command", "Overview"],
    status: <StatusBadge status="OPERATIONAL" size="xs" />,
    Component: () => (
      <PageContainer>
        <PageHeader
          title="San Pedro Bay Operations Cockpit"
          description="Synthesized 14-day telemetry and 72-hour congestion horizon across Ports of Long Beach & Los Angeles."
          breadcrumbs={["Command", "Overview"]}
          status={<StatusBadge status="OPERATIONAL" size="xs" />}
        />
        <OverviewTab />
      </PageContainer>
    ),
  },
  congestion: {
    id: "congestion",
    title: "Congestion Intelligence",
    subtitle: "MapLibre spatiotemporal density, terminal markers, and anchorage queues",
    breadcrumbs: ["Command", "Congestion"],
    status: <StatusBadge status="OPERATIONAL" label="Live Heatmap" size="xs" />,
    Component: CongestionPage,
  },
  forecast: {
    id: "forecast",
    title: "Congestion Forecast",
    subtitle: "LightGBM gradient boosted quantile regression (24h / 48h / 72h) with uncertainty bands",
    breadcrumbs: ["Command", "Forecast"],
    status: <StatusBadge status="FEASIBLE" label="LightGBM v0.1" size="xs" />,
    Component: () => (
      <PageContainer>
        <PageHeader
          title="72-Hour Congestion Forecast Engine"
          description="Zone-level quantile regression (10th/90th percentile bounds) trained on terminal capacity and vessel arrival queues."
          breadcrumbs={["Command", "Forecast"]}
          status={<StatusBadge status="FEASIBLE" label="LightGBM v0.1" size="xs" />}
        />
        <ForecastTab />
      </PageContainer>
    ),
  },
  berth: {
    id: "berth",
    title: "Berths & Cranes Optimizer",
    subtitle: "OR-Tools CP-SAT discrete optimization for Berth Allocation (BAP) and Quay Crane Assignment (QCAP)",
    breadcrumbs: ["Operations", "Berths & Cranes"],
    status: <StatusBadge status="ASSIGNED" label="CP-SAT Solver" size="xs" />,
    Component: () => (
      <PageContainer>
        <PageHeader
          title="Berth Allocation & Quay Crane Optimization"
          description="Solves BAP/QCAP under strict physical bounds (LOA, alongside depth, crane reach) contrasted with a FIFO baseline."
          breadcrumbs={["Operations", "Berths & Cranes"]}
          status={<StatusBadge status="ASSIGNED" label="OR-Tools CP-SAT" size="xs" />}
        />
        <BerthCranesTab />
      </PageContainer>
    ),
  },
  routing: {
    id: "routing",
    title: "Dynamic Vessel Routing",
    subtitle: "Alternate routing recommendations: divert, slow-steam, priority window, or hold at anchorage",
    breadcrumbs: ["Operations", "Routing"],
    status: <StatusBadge status="WAITING" label="Dynamic" size="xs" />,
    Component: ({ onNavigateTab }) => (
      <PageContainer>
        <PageHeader
          title="Vessel Routing & Anchorage Diversions"
          description="Decision-support recommendations calculated against fuel burn rates, port congestion indices, and demurrage risks."
          breadcrumbs={["Operations", "Routing"]}
          status={<StatusBadge status="WAITING" label="Dynamic" size="xs" />}
        />
        <RoutingTab onNavigateTab={onNavigateTab} />
      </PageContainer>
    ),
  },
  plan: {
    id: "plan",
    title: "72-Hour Operations Plan",
    subtitle: "12-shift physical operations plan, terminal move rates, crane hours, and action timeline",
    breadcrumbs: ["Operations", "72-Hour Plan"],
    status: <StatusBadge status="OPERATIONAL" label="72h Plan" size="xs" />,
    Component: () => (
      <PageContainer>
        <PageHeader
          title="72-Hour Master Operations Plan"
          description="Deterministic operational plan synchronized across 13 berths, 62 cranes, and 12 shifts with exportable schedule."
          breadcrumbs={["Operations", "72-Hour Plan"]}
          status={<StatusBadge status="OPERATIONAL" label="72h Plan" size="xs" />}
        />
        <PlanTab />
      </PageContainer>
    ),
  },
  scenarios: {
    id: "scenarios",
    title: "Scenario Center & Stress Testing",
    subtitle: "What-if simulation, capacity perturbations, and fleet economic impact (OR-Tools CP-SAT)",
    breadcrumbs: ["Analysis", "Scenarios"],
    status: <StatusBadge status="FEASIBLE" label="CP-SAT Solver" size="xs" />,
    Component: ({ onNavigateTab }) => <ScenarioPage onNavigateTab={onNavigateTab} />,
  },
  quality: {
    id: "quality",
    title: "Data Quality & Ingestion",
    subtitle: "Completeness scoring, weather ingestion, and schedule revision audit trail",
    breadcrumbs: ["Analysis", "Data Quality"],
    Component: QualityPage,
  },
  bob: {
    id: "bob",
    title: "Bob AI Assistant",
    subtitle: "Model Context Protocol (MCP) decision-support agent connected to live engine tools",
    breadcrumbs: ["AI", "Bob AI"],
    status: <StatusBadge status="HEALTHY" label="MCP Agent" size="xs" />,
    Component: () => (
      <PageContainer>
        <PageHeader
          title="Bob — Operations Intelligence Assistant"
          description="Conversational interface powered by 11 MCP tools that execute real LightGBM, CP-SAT, and routing pipelines on demand."
          breadcrumbs={["AI", "Bob AI"]}
          status={<StatusBadge status="HEALTHY" label="MCP Agent" size="xs" />}
        />
        <BobTab />
      </PageContainer>
    ),
  },
};
