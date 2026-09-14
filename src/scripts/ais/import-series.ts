#!/usr/bin/env bun
// ============================================================================
// scripts/ais/import-series.ts — load a congestion-series CSV into Prisma.
//
//   bun scripts/ais/import-series.ts <series.csv>
//
// Input : CSV produced by build-congestion.ts (or any file with the same shape):
//           zoneCode,ts,queueCount,avgWaitHrs,index
// Action: writes the rows into the CongestionReading table with source="AIS"
//         and hoursAgo computed from the timestamps (0 = most recent in the
//         file). REPLACES the whole CongestionReading table first so the
//         history stays one coherent series (mixing the AIS series with the
//         demo series would corrupt model training). `bun run db:seed`
//         restores the labelled demo series at any time.
// Deps  : @prisma/client + node:fs only.
// ============================================================================

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const HOUR_MS = 3_600_000;
const BATCH = 1000;

interface SeriesRow {
  zoneCode: string;
  tsMs: number;
  queueCount: number;
  avgWaitHrs: number;
  index: number;
}

// ------------------------------------------------------------------ CSV utils
// (duplicated from build-congestion.ts on purpose: both scripts stay self-contained)
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function parseTs(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(" ", "T").replace(/\s+UTC$/i, "");
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += "Z";
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

interface HeaderIdx {
  zone: number;
  ts: number;
  queue: number;
  wait: number;
  index: number;
}

function resolveHeader(headerLine: string): HeaderIdx | null {
  const cols = parseCsvLine(headerLine.replace(/^\uFEFF/, "")).map((c) => c.trim().toLowerCase());
  const idx = (...names: string[]): number => {
    for (const nm of names) {
      const i = cols.indexOf(nm);
      if (i >= 0) return i;
    }
    return -1;
  };
  const h: HeaderIdx = {
    zone: idx("zonecode", "zone_code", "zone"),
    ts: idx("ts", "timestamp", "basedatetime", "time"),
    queue: idx("queuecount", "queue_count", "queue"),
    wait: idx("avgwaithrs", "avg_wait_hrs", "wait"),
    index: idx("index", "congestion_index"),
  };
  if (h.zone < 0 || h.ts < 0 || h.queue < 0 || h.wait < 0 || h.index < 0) return null;
  return h;
}

// ------------------------------------------------------------------ main
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length !== 1 || argv[0] === "-h" || argv[0] === "--help") {
    console.log("Usage: bun scripts/ais/import-series.ts <series.csv>");
    console.log("  Loads a congestion-series CSV (zoneCode,ts,queueCount,avgWaitHrs,index)");
    console.log("  into CongestionReading with source=\"AIS\". Replaces the existing history.");
    process.exit(argv.length && argv[0] !== "--help" ? 1 : 0);
  }
  const csvPath = argv[0] as string;

  const text = readFileSync(csvPath, "utf8");
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) {
    console.error("ERROR: input file is empty.");
    process.exit(1);
  }
  const header = resolveHeader(lines[0] as string);
  if (!header) {
    console.error('ERROR: expected header "zoneCode,ts,queueCount,avgWaitHrs,index".');
    process.exit(1);
  }

  // ---- parse + validate rows ----------------------------------------------
  const rows: SeriesRow[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i] as string);
    const zoneCode = (cells[header.zone] ?? "").trim();
    const tsMs = parseTs(cells[header.ts] ?? "");
    const queueCount = Number((cells[header.queue] ?? "").trim());
    const avgWaitHrs = Number((cells[header.wait] ?? "").trim());
    const index = Number((cells[header.index] ?? "").trim());
    if (!zoneCode || tsMs === null || !Number.isFinite(queueCount) || !Number.isFinite(avgWaitHrs) || !Number.isFinite(index)) {
      skipped++;
      continue;
    }
    rows.push({ zoneCode, tsMs, queueCount: Math.round(queueCount), avgWaitHrs, index });
  }
  if (rows.length === 0) {
    console.error("ERROR: no valid data rows found.");
    process.exit(1);
  }

  const latestTs = rows.reduce((m, r) => Math.max(m, r.tsMs), rows[0].tsMs);
  const zones = [...new Set(rows.map((r) => r.zoneCode))].sort();
  const unexpected = zones.filter((z) => !["Z-PORT", "Z-LBCT", "Z-ITS", "Z-PCT", "Z-TTI"].includes(z));
  if (unexpected.length) {
    console.warn(`  WARNING: unexpected zone code(s) ${unexpected.join(", ")} — the engine only reads Z-PORT/Z-LBCT/Z-ITS/Z-PCT/Z-TTI.`);
  }

  // hoursAgo from ts (0 = most recent in the file); dedupe on (zoneCode, hoursAgo)
  const seen = new Set<string>();
  const prepared: (SeriesRow & { hoursAgo: number })[] = [];
  let dups = 0;
  for (const r of rows) {
    const hoursAgo = Math.max(0, Math.round((latestTs - r.tsMs) / HOUR_MS));
    const key = `${r.zoneCode}|${hoursAgo}`;
    if (seen.has(key)) {
      dups++;
      continue;
    }
    seen.add(key);
    prepared.push({ ...r, hoursAgo });
  }

  // ---- write to DB (replace-all, documented) -------------------------------
  const db = new PrismaClient();
  try {
    const existing = await db.congestionReading.count();
    await db.congestionReading.deleteMany();
    for (let i = 0; i < prepared.length; i += BATCH) {
      const chunk = prepared.slice(i, i + BATCH).map((r) => ({
        zoneCode: r.zoneCode,
        ts: new Date(r.tsMs),
        hoursAgo: r.hoursAgo,
        queueCount: r.queueCount,
        avgWaitHrs: r.avgWaitHrs,
        index: r.index,
        source: "AIS",
      }));
      await db.congestionReading.createMany({ data: chunk });
    }

    const stored = await db.congestionReading.count();
    const oldest = new Date(latestTs - Math.max(...prepared.map((p) => p.hoursAgo)) * HOUR_MS);
    console.log("import-series.ts — done");
    console.log(`  file             : ${csvPath}`);
    console.log(`  parsed rows      : ${rows.length.toLocaleString()} (skipped ${skipped}, merged duplicate zone+hour ${dups})`);
    console.log(`  zones            : ${zones.join(", ")}`);
    console.log(`  window           : ${oldest.toISOString().replace(".000Z", "Z")} → ${new Date(latestTs).toISOString().replace(".000Z", "Z")}`);
    console.log(`  DB               : replaced ${existing.toLocaleString()} existing reading(s); inserted ${stored.toLocaleString()} row(s) with source=\"AIS\"`);
    console.log("  vessel queue     : untouched (stays the labelled demo dataset)");
    console.log("  next             : reload /api/overview (or restart bun run dev) — the forecast now trains on the AIS series.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
