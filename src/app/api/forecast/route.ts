import { NextRequest, NextResponse } from "next/server";
import { getEngineContext } from "@/lib/engine/context";
import { runForecasts } from "@/lib/engine/pipeline";

export const dynamic = "force-dynamic";

// GET /api/forecast?zone=Z-PORT   (default: all zones summary + Z-PORT detail)
export async function GET(req: NextRequest) {
  try {
    const zone = req.nextUrl.searchParams.get("zone") ?? "Z-PORT";
    const ctx = await getEngineContext();
    const forecasts = await runForecasts(ctx);

    const fc = forecasts[zone] ?? forecasts["Z-PORT"];
    // last 96h of observed history for the past-vs-forecast chart
    const history = (ctx.history[zone] ?? []).slice(-96);

    return NextResponse.json({
      zones: Object.values(forecasts).map((f) => ({
        zoneCode: f.zoneCode,
        label: f.zoneName,
        currentIndex: f.current.index,
        peakIndex: f.peak.index,
        peakHour: f.peak.hour,
        avgIndex: f.avgIndex,
        queueNow: f.current.queue,
        waitNow: f.current.wait,
      })),
      selected: {
        ...fc,
        history,
        hotspotRank:
          Object.values(forecasts)
            .filter((f) => f.zoneCode !== "Z-PORT")
            .sort((a, b) => b.peak.index - a.peak.index)
            .findIndex((f) => f.zoneCode === fc.zoneCode) + 1,
      },
    });
  } catch (e) {
    console.error("[api/forecast]", e);
    return NextResponse.json({ error: "Forecast failed" }, { status: 500 });
  }
}
