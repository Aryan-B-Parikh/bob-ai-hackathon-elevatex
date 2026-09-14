/**
 * PortFlow SBX — database seed.
 *
 *   bun prisma/seed.ts          (or: bun run db:seed)
 *
 * WHAT IS REAL
 *   • Terminal capacity table below = published Port of Long Beach terminal fact
 *     sheets (berth length / deepsea berths / gantry cranes). Cited in
 *     docs/setup-guide.md. These are the hard constraints fed to the optimiser.
 *
 * WHAT IS DEMO (clearly labelled, source: "DEMO_AIS")
 *   • The 14-day hourly congestion history and the vessel queue. The sandbox
 *     cannot download the ~2 GB AccessAIS export; scripts/ais contains the real
 *     pipeline that replaces this demo series with AIS-derived data when you run
 *     it against an AccessAIS CSV (NOAA MarineCadastre).
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// ------------------------------------------------------------------ rng
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20240817);
const gauss = (mu: number, sd: number) => {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// official congestion-index definition used everywhere in the app (see docs)
export function congestionIndex(queue: number, waitHrs: number) {
  return clamp(60 * (queue / 20) + 40 * (waitHrs / 72), 0, 100);
}

// ------------------------------------------------------------------ terminals (REAL data)
const TERMINALS = [
  {
    code: "LBCT",
    name: "Long Beach Container Terminal",
    pier: "Pier E",
    berthLengthFt: 4200,
    deepseaBerths: 3,
    gantryCranes: 18,
    capacityTeuM: 3.5,
    zoneCode: "Z-LBCT",
    note: "3.5M+ TEU annual capacity; 18 STS dual-hoist/tandem cranes (POLB fact sheet)",
    berthDepth: 50,
  },
  {
    code: "ITS",
    name: "International Transportation Service",
    pier: "Pier G",
    berthLengthFt: 4250,
    deepseaBerths: 3,
    gantryCranes: 14,
    capacityTeuM: null,
    zoneCode: "Z-ITS",
    note: "4,250 ft continuous berth (POLB fact sheet)",
    berthDepth: 50,
  },
  {
    code: "PCT",
    name: "Pier J Port Container Terminal",
    pier: "Pier J",
    berthLengthFt: 5902,
    deepseaBerths: 4,
    gantryCranes: 14,
    capacityTeuM: null,
    zoneCode: "Z-PCT",
    note: "5,902 ft berth, longest in the harbour (POLB fact sheet)",
    berthDepth: 52,
  },
  {
    code: "TTI",
    name: "Total Terminals International",
    pier: "Pier T",
    berthLengthFt: 5000,
    deepseaBerths: 3,
    gantryCranes: 16,
    capacityTeuM: null,
    zoneCode: "Z-TTI",
    note: "5,000 ft berth (POLB fact sheet)",
    berthDepth: 50,
  },
] as const;

// even split of the published totals into working berths
function splitBerths(code: string, totalFt: number, n: number, cranes: number, depth: number) {
  const per = Math.floor(totalFt / n);
  return Array.from({ length: n }, (_, i) => ({
    name: `${code[0]}-${i + 1}`,
    seq: i + 1,
    lengthFt: per,
    depthFt: depth,
    cranesMax: Math.max(2, Math.round(cranes / n - (i === n - 1 ? 0.4 : 0))),
  }));
}

// ------------------------------------------------------------------ vessels (DEMO)
const CARRIERS = [
  "Pacific Gateway Line",
  "Meridian Container Co.",
  "TransPacific Express",
  "Blue Harbour Shipping",
  "Golden Anchor Lines",
  "Osprey Maritime",
];
const NAME_A = [
  "Pacific", "Meridian", "Osprey", "Golden", "Harbour", "Coral", "Trade",
  "Marlin", "Albatross", "Cobalt", "Sierra", "Aurora", "Keel", "Tidewater",
];
const NAME_B = ["Star", "Voyager", "Trader", "Pioneer", "Guardian", "Runner", "Banner", "Comet", "Pilot", "Crest"];
const ORIGINS = [
  "Busan", "Shanghai", "Yokohama", "Xiamen", "Kaohsiung", "Hong Kong",
  "Vancouver BC", "Oakland", "Manzanillo", "Qingdao", "Ningbo", "Kobe",
];
const ANCH_ZONES = [
  "San Pedro Anchorage A",
  "San Pedro Anchorage B",
  "Long Beach Anchorage C",
  "Anchorage 241-243",
  "Outside Point Fermin (drift)",
];

type ClassDef = {
  cls: string; loa: number; beam: number; draft: number; teu: [number, number]; moves: [number, number]; w: number;
};
const CLASSES: ClassDef[] = [
  { cls: "ULCV", loa: 1312, beam: 200, draft: 50.5, teu: [20000, 24000], moves: [8500, 12500], w: 3 },
  { cls: "POST_PANAMAX", loa: 1148, beam: 158, draft: 49, teu: [13000, 16000], moves: [6000, 9000], w: 5 },
  { cls: "NEO_PANAMAX", loa: 1200, beam: 168, draft: 50, teu: [15000, 16800], moves: [6500, 9500], w: 4 },
  { cls: "PANAMAX", loa: 964, beam: 124, draft: 45, teu: [5000, 6500], moves: [3200, 4800], w: 6 },
  { cls: "FEEDER", loa: 636, beam: 106, draft: 36, teu: [1800, 2800], moves: [1200, 2200], w: 4 },
];
const ZONES = ["Z-LBCT", "Z-ITS", "Z-PCT", "Z-TTI"];
const ZONE_W = [0.32, 0.24, 0.22, 0.22];

function pickClass(): ClassDef {
  const total = CLASSES.reduce((s, c) => s + c.w, 0);
  let r = rand() * total;
  for (const c of CLASSES) {
    r -= c.w;
    if (r <= 0) return c;
  }
  return CLASSES[1];
}

function buildVessels() {
  const used = new Set<string>();
  const vessels: Array<Record<string, unknown>> = [];
  const N = 38;
  for (let i = 0; i < N; i++) {
    const c = pickClass();
    let name = `M/V ${NAME_A[Math.floor(rand() * NAME_A.length)]} ${NAME_B[Math.floor(rand() * NAME_B.length)]}`;
    while (used.has(name)) name = `M/V ${NAME_A[Math.floor(rand() * NAME_A.length)]} ${NAME_B[Math.floor(rand() * NAME_B.length)]}`;
    used.add(name);

    const r = rand();
    const status = r < 0.55 ? "ANCHORAGE" : r < 0.7 ? "DRIFTING" : "INBOUND";
    const etaHours =
      status === "ANCHORAGE" ? (rand() < 0.7 ? 0 : gauss(4, 2)) :
      status === "DRIFTING" ? clamp(gauss(12, 6), 4, 26) :
      2 + rand() * 68; // inbound: spread across the 72h horizon
    const anchoredHours =
      status === "ANCHORAGE" ? clamp(gauss(38, 20), 6, 96) :
      status === "DRIFTING" ? clamp(gauss(22, 10), 4, 52) : 0;

    // zone weights
    let zr = rand();
    let destZoneCode = ZONES[0];
    for (let zi = 0; zi < ZONES.length; zi++) {
      zr -= ZONE_W[zi];
      if (zr <= 0) { destZoneCode = ZONES[zi]; break; }
    }

    const importMoves = Math.round(c.moves[0] + rand() * (c.moves[1] - c.moves[0]));
    const exportMoves = Math.round(importMoves * (0.8 + rand() * 0.35));

    vessels.push({
      mmsi: String(367000000 + Math.floor(rand() * 999999)),
      name,
      carrier: CARRIERS[Math.floor(rand() * CARRIERS.length)],
      vesselClass: c.cls,
      loaFt: Math.round(c.loa + gauss(0, 25)),
      beamFt: c.beam,
      draftFt: c.draft,
      teuCapacity: Math.round(c.teu[0] + rand() * (c.teu[1] - c.teu[0])),
      importMoves,
      exportMoves,
      originPort: ORIGINS[Math.floor(rand() * ORIGINS.length)],
      reeferUnits: Math.round(rand() * 480),
      status,
      anchorageZone:
        status === "INBOUND" ? "En route — San Pedro Approach" : ANCH_ZONES[Math.floor(rand() * ANCH_ZONES.length)],
      etaHours: Math.max(0, +etaHours.toFixed(1)),
      anchoredHours: +anchoredHours.toFixed(1),
      destZoneCode,
    });
  }
  return vessels;
}

// ------------------------------------------------------------------ congestion history (DEMO)
const HISTORY_H = 336; // 14 days hourly
type ZoneParams = { base: number; diurnal: number; weekly: number; waitK: number };
const ZP: Record<string, ZoneParams> = {
  "Z-LBCT": { base: 6.0, diurnal: 1.4, weekly: 1.2, waitK: 6.4 },
  "Z-ITS": { base: 4.6, diurnal: 1.1, weekly: 0.9, waitK: 6.0 },
  "Z-PCT": { base: 4.2, diurnal: 1.0, weekly: 0.8, waitK: 5.6 },
  "Z-TTI": { base: 4.0, diurnal: 0.9, weekly: 0.9, waitK: 5.8 },
};

function buildZoneSeries(now: Date) {
  const t0Hour = Math.floor(now.getTime() / 3600000) * 3600000;
  const series: Record<string, { queue: number[]; wait: number[]; idx: number[] }> = {};
  const ar = {} as Record<string, number>;

  for (const zone of Object.keys(ZP)) {
    series[zone] = { queue: [], wait: [], idx: [] };
    ar[zone] = 0;
  }

  for (let h = HISTORY_H - 1; h >= 0; h--) {
    // hoursAgo = h → absolute hour index
    const absH = t0Hour / 3600000 - h;
    const date = new Date(absH * 3600000);
    const hod = date.getUTCHours();
    const dow = date.getUTCDay();
    // port-wide wind-delay incident 144h ago: 20h closure, slow decay
    const incident =
      h <= 144 && h >= 124
        ? 7.5 * Math.exp(-((144 - h) / 9))
        : h < 124 && h > 60
          ? 6.5 * Math.exp(-(124 - h) / 42)
          : 0;
    // PCT crane outage 72..36h ago → service drop at PCT
    const pctOutage = h <= 72 && h >= 36 ? 3.2 : 0;

    for (const zone of Object.keys(ZP)) {
      const p = ZP[zone];
      const outage = zone === "Z-PCT" ? pctOutage : 0;
      ar[zone] = 0.82 * ar[zone] + gauss(0, 0.55);
      const q =
        p.base +
        p.diurnal * Math.sin(((hod - 5) / 24) * 2 * Math.PI) +
        p.weekly * Math.sin(((dow - 2) / 7) * 2 * Math.PI) +
        incident * (zone === "Z-LBCT" ? 1.15 : 0.9) +
        outage +
        ar[zone];
      const queue = clamp(q, 0.5, 26);
      const wait = clamp(queue * p.waitK + gauss(0, 3.5) + (outage > 0 ? 14 : 0) + (incident > 1 ? 10 : 0), 2, 168);
      series[zone].queue.push(+queue.toFixed(2));
      series[zone].wait.push(+wait.toFixed(2));
      series[zone].idx.push(+congestionIndex(queue, wait).toFixed(2));
    }
  }
  return { series, t0: new Date(t0Hour) };
}

// ------------------------------------------------------------------ main
async function main() {
  console.log("Seeding PortFlow SBX …");
  await db.chatMessage.deleteMany();
  await db.opsPlan.deleteMany();
  await db.optimiserRun.deleteMany();
  await db.congestionReading.deleteMany();
  await db.vessel.deleteMany();
  await db.berth.deleteMany();
  await db.terminal.deleteMany();

  // terminals + berths
  for (const t of TERMINALS) {
    const term = await db.terminal.create({
      data: {
        code: t.code,
        name: t.name,
        pier: t.pier,
        berthLengthFt: t.berthLengthFt,
        deepseaBerths: t.deepseaBerths,
        gantryCranes: t.gantryCranes,
        capacityTeuM: t.capacityTeuM,
        zoneCode: t.zoneCode,
        note: t.note,
      },
    });
    for (const b of splitBerths(t.code, t.berthLengthFt, t.deepseaBerths, t.gantryCranes, t.berthDepth)) {
      await db.berth.create({ data: { ...b, terminalId: term.id } });
    }
    console.log(`  terminal ${t.code}: ${t.deepseaBerths} berths / ${t.gantryCranes} cranes`);
  }

  // vessels
  const vessels = buildVessels();
  for (const v of vessels) await db.vessel.create({ data: v as never });
  const waiting = vessels.filter((v) => v.status !== "INBOUND").length;
  console.log(`  vessels: ${vessels.length} (${waiting} at anchor/drift)`);

  // history
  const { series, t0 } = buildZoneSeries(new Date());
  const zones = Object.keys(series);
  for (let i = 0; i < HISTORY_H; i++) {
    const hoursAgo = HISTORY_H - 1 - i;
    const ts = new Date(t0.getTime() - hoursAgo * 3600000);
    let portQ = 0;
    let portW = 0;
    for (const zone of zones) {
      const s = series[zone];
      portQ += s.queue[i];
      portW += s.wait[i] * s.queue[i];
    }
    const rows = zones.map((zone) => {
      const s = series[zone];
      return {
        zoneCode: zone,
        ts,
        hoursAgo,
        queueCount: Math.round(s.queue[i]),
        avgWaitHrs: s.wait[i],
        index: s.idx[i],
        source: "DEMO_AIS",
      };
    });
    rows.push({
      zoneCode: "Z-PORT",
      ts,
      hoursAgo,
      queueCount: Math.round(portQ),
      avgWaitHrs: +(portW / Math.max(portQ, 0.01)).toFixed(2),
      index: +congestionIndex(portQ, portW / Math.max(portQ, 0.01)).toFixed(2),
      source: "DEMO_AIS",
    });
    await db.congestionReading.createMany({ data: rows as never });
  }
  console.log(`  congestion history: ${HISTORY_H}h × ${zones.length + 1} zones`);

  console.log("Seed complete. t0 =", t0.toISOString());
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
