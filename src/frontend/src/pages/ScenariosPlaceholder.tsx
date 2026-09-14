import { GitCompare, Sliders, RotateCcw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { PageHeader } from "../components/layout/PageHeader";
import { PageContainer } from "../components/layout/PageContainer";

export default function ScenariosPlaceholder() {
  return (
    <PageContainer>
      <PageHeader
        title="What-If Scenario Simulation & Comparison"
        description="Simulate disruption events, berth outages, labor strikes, and crane capacity alterations with CP-SAT rollback."
        breadcrumbs={["Analysis", "Scenarios"]}
        status={<Badge variant="info">Phase 2 Module</Badge>}
      />

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[var(--brand)]" />
              <CardTitle>Capacity Perturbation</CardTitle>
            </div>
            <CardDescription>Crane availability &amp; move rate factor sliders.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--text-secondary)]">
              Parametric stress-testing against baseline OR-Tools CP-SAT berth schedule.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-[var(--status-warning)]" />
              <CardTitle>Baseline vs. Scenario Deltas</CardTitle>
            </div>
            <CardDescription>Quantify dwell time &amp; fleet burn cost impacts.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--text-secondary)]">
              Direct comparison between FIFO baseline, optimized allocation, and disrupted scenarios.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-[var(--status-info)]" />
              <CardTitle>Scenario Rollback</CardTitle>
            </div>
            <CardDescription>Versioned state rollback via POST /api/scenarios/rollback.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--text-secondary)]">
              W3 scenario state tree support with parent-child scenario lineage tracking.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="p-8 rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] text-center space-y-3">
        <GitCompare className="w-8 h-8 text-[var(--brand)] mx-auto opacity-70" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Phase 1 Foundation Active</h3>
        <p className="text-xs text-[var(--text-secondary)] max-w-lg mx-auto">
          The full multi-scenario comparative analyzer will land in Phase 2. You can currently test scenario sliders directly inside the working <strong>Berths &amp; Cranes</strong> tab.
        </p>
      </div>
    </PageContainer>
  );
}
