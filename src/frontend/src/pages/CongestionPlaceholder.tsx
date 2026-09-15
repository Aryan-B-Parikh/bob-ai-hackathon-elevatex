import { Activity, Map, Layers } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { PageHeader } from "../components/layout/PageHeader";
import { PageContainer } from "../components/layout/PageContainer";

export default function CongestionPlaceholder() {
  return (
    <PageContainer>
      <PageHeader
        title="Congestion Intelligence & Heatmap"
        description="Spatiotemporal congestion density across San Pedro Bay container terminals and approach fairways."
        breadcrumbs={["Command", "Congestion"]}
        status={<Badge variant="info">Phase 2 Module</Badge>}
      />

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Map className="w-4 h-4 text-[var(--brand)]" />
              <CardTitle>MapLibre Vector Heatmap</CardTitle>
            </div>
            <CardDescription>Visual AIS vessel density and anchorage queues.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--text-secondary)]">
              Scheduled for Phase 2 implementation using installed MapLibre-GL engine and NOAA AccessAIS spatial boundaries.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--status-warning)]" />
              <CardTitle>Zone Congestion Matrix</CardTitle>
            </div>
            <CardDescription>Live berth vs. yard vs. gate utilization telemetry.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--text-secondary)]">
              Real-time bottleneck identification cross-referenced with SimPy discrete-event simulation queues.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[var(--status-info)]" />
              <CardTitle>Terminal Drill-Down</CardTitle>
            </div>
            <CardDescription>LBCT Pier E · ITS Pier G · PCT Pier J · TTI Pier T</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--text-secondary)]">
              Granular vessel-to-berth allocation curves and quay crane assignment schedules.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="p-8 rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] text-center space-y-3">
        <Activity className="w-8 h-8 text-[var(--brand)] mx-auto opacity-70" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Phase 1 Foundation Active</h3>
        <p className="text-xs text-[var(--text-secondary)] max-w-lg mx-auto">
          The MapLibre geospatial viewer and interactive heatmap will be connected to the backend telemetry pipeline in Phase 2. Explore the live <strong>Overview</strong> and <strong>Forecast</strong> tabs for current congestion predictions.
        </p>
      </div>
    </PageContainer>
  );
}
