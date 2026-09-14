import { Database, FileCheck, ShieldCheck } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { PageHeader } from "../components/layout/PageHeader";
import { PageContainer } from "../components/layout/PageContainer";

export default function QualityPlaceholder() {
  return (
    <PageContainer>
      <PageHeader
        title="Data Quality & Ingestion Hygiene"
        description="Monitor AIS message ingestion, schema completeness scores, and schedule revision validation."
        breadcrumbs={["Analysis", "Data Quality"]}
        status={<Badge variant="info">Phase 2 Module</Badge>}
      />

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[var(--status-success)]" />
              <CardTitle>Completeness Audit</CardTitle>
            </div>
            <CardDescription>Field-level completeness across POLB terminal tables.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--text-secondary)]">
              Audits mandatory physical parameters: draft, LOA, beam, reefer connections, and crane outreach.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-[var(--brand)]" />
              <CardTitle>Schedule Upload Validation</CardTitle>
            </div>
            <CardDescription>CSV schema verification via POST /api/vessels/upload.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--text-secondary)]">
              Drag-and-drop ingestion pipeline with ETA revision history tracking and error reporting.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[var(--status-info)]" />
              <CardTitle>Normalisation Pipeline</CardTitle>
            </div>
            <CardDescription>SI units conversion and vessel code resolution.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--text-secondary)]">
              Tracks raw unit payloads vs. standardized metric quantities across all vessel calls.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="p-8 rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] text-center space-y-3">
        <Database className="w-8 h-8 text-[var(--brand)] mx-auto opacity-70" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Phase 1 Foundation Active</h3>
        <p className="text-xs text-[var(--text-secondary)] max-w-lg mx-auto">
          The W1 Ingestion and Data Quality inspector UI will be connected in Phase 2 once backend feature flags are enabled.
        </p>
      </div>
    </PageContainer>
  );
}
