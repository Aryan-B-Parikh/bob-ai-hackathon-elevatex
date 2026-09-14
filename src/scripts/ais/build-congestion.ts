#!/usr/bin/env bun
// ============================================================================
// scripts/ais/build-congestion.ts — REAL AIS → congestion-series pipeline.
//
//   bun scripts/ais/build-congestion.ts <ais.csv> <out.csv> [--min-anchor-min 0] [--sog-max 1.0]
//
// Input : NOAA AccessAIS "clip and ship" export for San Pedro Bay
//         (NOAA Office for Coastal Management — https://marinecadastre.gov/accessais/).
//         Required columns (case-insensitive): MMSI, BaseDateTime, LAT, LON, SOG.
//         VesselName is used when present. Extra columns are ignored.
// Output: CSV with header  zoneCode,ts,queueCount,avgWaitHrs,index
//         (index formula IDENTICAL to src/lib/engine/forecast.ts).
//
// Method (documented approximations — see scripts/ais/README.md):
//   1. keep rows inside the San Pedro Bay bounding box (lat 33.55–33.85, lon −118.45…−118.05)
//   2. a row is "at anchor" when SOG < sog-max AND the position is inside one of the
//      documented anchorage rectangles (San Pedro A/B, Long Beach C)
//   3. per MMSI: dwell = last anchored timestamp − first anchored timestamp
//   4. zone = nearest terminal anchor point from the vessel's mean anchored position
//   5. hourly aggregation per zone → queueCount + avg dwell → congestion index
//
// Self-contained: uses only node:fs — no extra packages. Streams the input file
// in fixed-size chunks so memory stays flat on multi-GB AccessAIS exports.
// ============================================================================

import { closeSync, openSync, readSync, writeFileSync } from "node:fs";

// ------------------------------------------------------------------ constants
const HOUR_MS = 3_600_000;

/** San Pedro Bay bounding box (Ports of LA / Long Beach approach + anchorages). */
const BBOX = { latMin: 33.55, latMax: 33.85, lonMin: -118.45, lonMax: -118.05 } as const;

/**
 * Documented-approximation anchorage rectangles (NOT official chart polygons).
 * A row is "at anchor" only if it falls inside one of these and SOG < threshold.
 */
const ANCHORAGE_RECTS = [
  { name: "San Pedro Anchorage A/B (documented approximation)", latMin: 33.6, latMax: 33.72, lonMin: -118.3, lonMax: -118.18 },
  { name: "Long Beach Anchorage C (documented approximation)", latMin: 33.68, latMax: 33.76, lonMin: -118.15, lonMax: -118.05 },
] as const;

/**
 * Terminal anchor points used for nearest-terminal zone assignment
 * (documented approximations of the real terminal positions).
 */
const TERMINAL_ANCHORS = [
  { zoneCode: "Z-LBCT", label: "LBCT · Pier E", lat: 33.75, lon: -118.217 },
  { zoneCode: "Z-ITS", label: "ITS · Pier G", lat: 33.746, lon: -118.203 },
  { zoneCode: "Z-PCT", label: "PCT · Pier J", lat: 33.741, lon: -118.181 },
  { zoneCode: "Z-TTI", label: "TTI · Pier T", lat: 33.736, lon: -118.21 },
] as const;

const TERMINAL_ZONES = TERMINAL_ANCHORS.map((t) => t.zoneCode);

// Identical definition to src/lib/engine/forecast.ts — do not change one without the other.
function congestionIndex(queue: number, waitHrs: number): number {
  const x = 60 * (queue / 20) + 40 * (waitHrs / 72);
  return Math.min(100, Math.max(0, x));
}

// ------------------------------------------------------------------ CLI
interface Args {
  aisPath: string;
  outPath: string;
  /** Minimum span (minutes) between first and last anchored sighting for a vessel to count. 0 = pure spec. */
  minAnchorMin: number;
  /** SOG threshold (kn) below which a position counts as "at anchor". */
  sogMax: number;
}

function usage(code: number): never {
  const msg = [
    "build-congestion.ts — NOAA AccessAIS CSV → per-zone hourly congestion series",
    "",
    "Usage:",
    "  bun scripts/ais/build-congestion.ts <ais.csv> <out.csv> [options]",
    "",
    "Arguments:",
    "  <ais.csv>              AccessAIS export (MMSI, BaseDateTime, LAT, LON, SOG, VesselName, …)",
    "  <out.csv>              output series CSV: zoneCode,ts,queueCount,avgWaitHrs,index",
    "",
    "Options:",
    "  --min-anchor-min <m>   min span (minutes) between first/last anchored sighting for a",
    "                         vessel to count as a queue member (default 0 = no filter;",
    "                         try 60 to suppress passing-traffic noise)",
    "  --sog-max <kn>         SOG threshold for 'at anchor' (default 1.0)",
    "  -h, --help             show this help",
    "",
    "Example:",
    "  bun scripts/ais/build-congestion.ts zone10_202101-202102.csv congestion-series.csv --min-anchor-min 60",
  ].join("\n");
  if (code === 0) console.log(msg);
  else console.error(msg);
  process.exit(code);
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let minAnchorMin = 0;
  let sogMax = 1.0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") usage(0);
    else if (a === "--min-anchor-min") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0) usage(1);
      minAnchorMin = v;
    } else if (a === "--sog-max") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v <= 0) usage(1);
      sogMax = v;
    } else if (a.startsWith("--")) {
      console.error(`unknown option: ${a}`);
      usage(1);
    } else positional.push(a);
  }
  if (positional.length !== 2) usage(positional.length ? 1 : 0);
  return { aisPath: positional[0] as string, outPath: positional[1] as string, minAnchorMin, sogMax };
}

// ------------------------------------------------------------------ CSV utils
/** Parse one CSV line honouring double-quoted fields ("" escapes a quote). */
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

/**
 * Parse an AccessAIS timestamp. BaseDateTime is UTC ("2021-01-01T00:00:00");
 * tolerate "YYYY-MM-DD HH:MM:SS" and a trailing " UTC".
 */
function parseTs(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(" ", "T").replace(/\s+UTC$/i, "");
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += "Z";
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

interface HeaderIdx {
  mmsi: number;
  ts: number;
  lat: number;
  lon: number;
  sog: number;
  name: number; // -1 when the column is absent
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
    mmsi: idx("mmsi"),
    ts: idx("basedatetime", "base datetime", "datetime", "time"),
    lat: idx("lat", "latitude"),
    lon: idx("lon", "longitude", "lgt"),
    sog: idx("sog", "speed over ground"),
    name: idx("vesselname", "vessel name", "shipname", "name"),
  };
  if (h.mmsi < 0 || h.ts < 0 || h.lat < 0 || h.lon < 0 || h.sog < 0) return null;
  return h;
}

// ------------------------------------------------------------------ streaming reader
/** Yields lines from a (possibly multi-GB) file without loading it into memory. */
function* readLines(path: string, chunkBytes = 8 * 1024 * 1024): Generator<string> {
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(chunkBytes);
  let carry = "";
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, chunkBytes, null);
      if (n === 0) break;
      const chunk = carry + buf.toString("utf8", 0, n);
      const lines = chunk.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) yield line;
    }
    if (carry) yield carry;
  } finally {
    closeSync(fd);
  }
}

// ------------------------------------------------------------------ geometry
function inBbox(lat: number, lon: number): boolean {
  return lat >= BBOX.latMin && lat <= BBOX.latMax && lon >= BBOX.lonMin && lon <= BBOX.lonMax;
}

function inAnchorageRect(lat: number, lon: number): boolean {
  for (const r of ANCHORAGE_RECTS) {
    if (lat >= r.latMin && lat <= r.latMax && lon >= r.lonMin && lon <= r.lonMax) return true;
  }
  return false;
}

function nearestZone(lat: number, lon: number): string {
  let best = TERMINAL_ANCHORS[0].zoneCode;
  let bestD = Infinity;
  for (const t of TERMINAL_ANCHORS) {
    const d = (t.lat - lat) ** 2 + (t.lon - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t.zoneCode;
    }
  }
  return best;
}

// ------------------------------------------------------------------ aggregation
interface VesselAgg {
  name: string;
  firstTs: number; // first anchored sighting
  lastTs: number; // last anchored sighting
  sumLat: number;
  sumLon: number;
  n: number; // anchored position reports
}

interface SeriesRow {
  zoneCode: string;
  ts: string;
  queueCount: number;
  avgWaitHrs: number;
  index: number;
}

// ------------------------------------------------------------------ main
function main(): void {
  const args = parseArgs(process.argv.slice(2));

  let header: HeaderIdx | null = null;
  const stats = { rowsRead: 0, inBbox: 0, anchoredRows: 0, skipped: 0 };
  const vessels = new Map<string, VesselAgg>();

  for (const raw of readLines(args.aisPath)) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    if (!header) {
      header = resolveHeader(line);
      if (!header) {
        console.error("ERROR: first line is not an AccessAIS header (need MMSI, BaseDateTime, LAT, LON, SOG).");
        process.exit(1);
      }
      continue;
    }
    const cells = parseCsvLine(line);
    const mmsi = (cells[header.mmsi] ?? "").trim();
    if (!mmsi) {
      stats.skipped++;
      continue;
    }
    const ts = parseTs(cells[header.ts] ?? "");
    const lat = Number((cells[header.lat] ?? "").trim());
    const lon = Number((cells[header.lon] ?? "").trim());
    const sog = Number((cells[header.sog] ?? "").trim());
    if (ts === null || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(sog)) {
      stats.skipped++;
      continue;
    }
    stats.rowsRead++;
    if (!inBbox(lat, lon)) continue;
    stats.inBbox++;
    if (sog >= args.sogMax) continue; // moving under way → not at anchor
    if (!inAnchorageRect(lat, lon)) continue;
    stats.anchoredRows++;

    let v = vessels.get(mmsi);
    if (!v) {
      v = { name: header.name >= 0 ? (cells[header.name] ?? "").trim() : "", firstTs: ts, lastTs: ts, sumLat: 0, sumLon: 0, n: 0 };
      vessels.set(mmsi, v);
    }
    if (!v.name && header.name >= 0) v.name = (cells[header.name] ?? "").trim();
    v.firstTs = Math.min(v.firstTs, ts);
    v.lastTs = Math.max(v.lastTs, ts);
    v.sumLat += lat;
    v.sumLon += lon;
    v.n++;
  }

  if (!header) {
    console.error("ERROR: input file is empty.");
    process.exit(1);
  }
  if (vessels.size === 0) {
    console.error(
      "ERROR: no anchored vessel sightings found inside the anchorage rectangles. " +
        "Check that the export covers San Pedro Bay (bbox lat 33.55–33.85, lon −118.45…−118.05) " +
        `and that SOG units are knots (threshold ${args.sogMax}).`,
    );
    process.exit(1);
  }

  // optional noise filter: span between first/last anchored sighting
  const minSpanMs = args.minAnchorMin * 60_000;
  const queued = [...vessels.entries()].filter(([, v]) => v.lastTs - v.firstTs >= minSpanMs);

  // ---- zone assignment + hourly interval overlap -------------------------
  interface HourCell {
    q: number;
    dwellSum: number;
  }
  const perZoneHour = new Map<string, HourCell>(); // `${zoneCode}|${hourIndex}`
  let minHour = Infinity;
  let maxHour = -Infinity;
  const perZoneVessels = new Map<string, number>();

  for (const [mmsi, v] of queued) {
    const zone = nearestZone(v.sumLat / v.n, v.sumLon / v.n);
    perZoneVessels.set(zone, (perZoneVessels.get(zone) ?? 0) + 1);
    const dwellHrs = (v.lastTs - v.firstTs) / HOUR_MS;
    const startHour = Math.floor(v.firstTs / HOUR_MS);
    const endHour = Math.floor(v.lastTs / HOUR_MS);
    if (startHour < minHour) minHour = startHour;
    if (endHour > maxHour) maxHour = endHour;
    for (let hr = startHour; hr <= endHour; hr++) {
      const key = `${zone}|${hr}`;
      const cell = perZoneHour.get(key) ?? { q: 0, dwellSum: 0 };
      cell.q++;
      cell.dwellSum += dwellHrs;
      perZoneHour.set(key, cell);
    }
  }

  // ---- emit rows (every hour × 5 zones, hours with no queue → zeros) -----
  const rows: SeriesRow[] = [];
  for (let hr = minHour; hr <= maxHour; hr++) {
    const ts = new Date(hr * HOUR_MS).toISOString().replace(".000Z", "Z");
    const zones: { q: number; w: number }[] = [];
    for (const zone of TERMINAL_ZONES) {
      const cell = perZoneHour.get(`${zone}|${hr}`);
      const q = cell?.q ?? 0;
      const w = cell && cell.q > 0 ? cell.dwellSum / cell.q : 0;
      zones.push({ q, w });
      rows.push({
        zoneCode: zone,
        ts,
        queueCount: q,
        avgWaitHrs: +w.toFixed(2),
        index: +congestionIndex(q, w).toFixed(2),
      });
    }
    // port-wide aggregate: queue = Σ zones, wait = queue-weighted mean (same as prisma/seed.ts)
    let qSum = 0;
    let wSum = 0;
    for (const z of zones) {
      qSum += z.q;
      wSum += z.q * z.w;
    }
    const portWait = qSum > 0 ? wSum / qSum : 0;
    rows.push({
      zoneCode: "Z-PORT",
      ts,
      queueCount: qSum,
      avgWaitHrs: +portWait.toFixed(2),
      index: +congestionIndex(qSum, portWait).toFixed(2),
    });
  }

  // ---- write output -------------------------------------------------------
  const out =
    ["zoneCode,ts,queueCount,avgWaitHrs,index", ...rows.map((r) => `${r.zoneCode},${r.ts},${r.queueCount},${r.avgWaitHrs},${r.index}`)].join("\n") + "\n";
  writeFileSync(args.outPath, out);

  const fmt = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
  console.log("build-congestion.ts — done");
  console.log(`  input            : ${args.aisPath}`);
  console.log(`  rows read        : ${stats.rowsRead.toLocaleString()} (skipped ${stats.skipped.toLocaleString()} malformed)`);
  console.log(`  in San Pedro bbox: ${stats.inBbox.toLocaleString()}`);
  console.log(`  anchored rows    : ${stats.anchoredRows.toLocaleString()} (SOG < ${args.sogMax} kn, inside documented rectangles)`);
  console.log(`  vessels (MMSI)   : ${vessels.size.toLocaleString()} unique, ${queued.length.toLocaleString()} kept (min span ${args.minAnchorMin} min)`);
  for (const zone of TERMINAL_ZONES) {
    console.log(`    ${zone}: ${perZoneVessels.get(zone) ?? 0} vessels`);
  }
  console.log(`  window           : ${fmt(minHour * HOUR_MS)} → ${fmt((maxHour + 1) * HOUR_MS)}`);
  console.log(`  output           : ${args.outPath} — ${rows.length.toLocaleString()} rows (zoneCode,ts,queueCount,avgWaitHrs,index)`);
  console.log("  note: anchorage rectangles + terminal anchors are documented approximations (scripts/ais/README.md).");
  console.log("  next : bun scripts/ais/import-series.ts " + args.outPath);
}

main();
