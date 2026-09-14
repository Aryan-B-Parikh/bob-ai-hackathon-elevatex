import { NextResponse } from "next/server";
import { getEngineContext } from "@/lib/engine/context";

export const dynamic = "force-dynamic";

// GET /api/terminals → real Port of Long Beach terminal capacity table
export async function GET() {
  try {
    const ctx = await getEngineContext();
    return NextResponse.json({
      source:
        "Port of Long Beach terminal fact sheets (BNSF/POLB) — real published figures; see docs/setup-guide.md",
      terminals: ctx.terminals.map((t) => ({
        ...t,
        berths: ctx.berths.filter((b) => b.zoneCode === t.zoneCode),
      })),
      portWide: {
        polb: { berths: 80, piers: 10, postPanamaxCranes: 71 },
        pola: { berths: 270, containerCranes: 85, containerTerminals: 7 },
      },
    });
  } catch (e) {
    console.error("[api/terminals]", e);
    return NextResponse.json({ error: "Failed to load terminals" }, { status: 500 });
  }
}
