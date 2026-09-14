import { NextResponse } from "next/server";
import { buildOverview } from "@/lib/engine/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { overview } = await buildOverview();
    return NextResponse.json(overview);
  } catch (e) {
    console.error("[api/overview]", e);
    return NextResponse.json({ error: "Failed to build overview" }, { status: 500 });
  }
}
