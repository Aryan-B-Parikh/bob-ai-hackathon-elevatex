/* Debug the optimiser directly (bun scripts/debug-optimiser.ts) */
import { PrismaClient } from "@prisma/client";
import { forecastZone, buildArrivalSchedule } from "../lib/engine/forecast";
import { optimise } from "../lib/engine/optimiser";

const db = new PrismaClient();

async function main() {
  const [terminals, berthsRaw, vesselsRaw, readings] = await Promise.all([
    db.terminal.findMany({ orderBy: { code: "asc" } }),
    db.berth.findMany({ orderBy: { seq: "asc" } }),
    db.vessel.findMany({ orderBy: { anchoredHours: "desc" } }),
    db.congestionReading.findMany({ orderBy: { hoursAgo: "asc" } }),
  ]);
  const t0 = readings[readings.length - 1].ts;
  const H = 336;
  const termMap = new Map(terminals.map((t) => [t.id, t]));
  const berths = berthsRaw.map((b) => {
    const t = termMap.get(b.terminalId)!;
    return { ...b, terminalCode: t.code, terminalName: t.name, pier: t.pier, zoneCode: t.zoneCode };
  });
  const vessels = vesselsRaw as never[];
  const history: Record<string, { ts: Date; queueCount: number; avgWaitHrs: number; index: number }[]> = {};
  for (const r of readings) {
    (history[r.zoneCode] ??= []).push({ ts: r.ts, queueCount: r.queueCount, avgWaitHrs: r.avgWaitHrs, index: r.index });
  }

  // zone forecasts (just to see stability)
  for (const zone of ["Z-PORT", "Z-LBCT", "Z-ITS", "Z-PCT", "Z-TTI"]) {
    const zoneVessels = zone === "Z-PORT" ? vessels : vessels.filter((v: never) => (v as { destZoneCode: string }).destZoneCode === zone);
    const fc = forecastZone({
      zoneCode: zone,
      zoneName: zone,
      history: history[zone] ?? [],
      vessels: zoneVessels as never,
      capacity: {
        berths: berths.filter((b) => b.zoneCode === zone).length || 13,
        cranes: berths.filter((b) => b.zoneCode === zone).reduce((a, b) => a + b.cranesMax, 0) || 62,
        berthLengthFt: 1000,
      },
      t0,
    });
    console.log(`${zone}: now=${fc.current.index} peak=${fc.peak.index}@+${fc.peak.hour}h mae72=${fc.model.mae72} r2=${fc.model.r2}`);
  }

  const out = optimise(vessels as never, berths as never);
  console.log("\nopt metrics:", out.metrics);
  console.log("fifo metrics:", out.baseline);
  console.log("\nassignments by start:");
  for (const a of out.assignments) {
    console.log(
      `  ${a.vesselName.padEnd(24)} ${a.terminalCode} ${a.berthName}  +${String(a.startHour).padStart(5)} → +${String(a.endHour).padStart(5)}  cranes=${a.cranes} wait=${a.waitHours} moves=${a.moves}`,
    );
  }
  // per-berth gaps
  const byBerth = new Map<string, typeof out.assignments>();
  for (const a of out.assignments) {
    const k = a.berthName;
    (byBerth.get(k) ?? byBerth.set(k, []).get(k)!).push(a);
  }
  console.log("\nberth idle analysis (idle within 0..72):");
  for (const [k, arr] of byBerth) {
    let idle = 0;
    let prev = 0;
    for (const a of arr.sort((x, y) => x.startHour - y.startHour)) {
      idle += Math.max(0, Math.min(a.startHour, 72) - Math.min(prev, 72));
      prev = Math.max(prev, a.endHour);
    }
    idle += Math.max(0, 72 - Math.min(prev, 72));
    console.log(`  ${k}: idle=${idle.toFixed(1)}h vessels=${arr.length}`);
  }
  console.log("\nvessel ready times:", vessels.map((v: never) => (v as unknown as { etaHours: number }).etaHours).sort((a, b) => a - b).join(", "));
}
main().finally(() => db.$disconnect());
