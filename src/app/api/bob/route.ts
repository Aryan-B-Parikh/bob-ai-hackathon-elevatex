import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bobAnswer } from "@/lib/engine/bob";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/bob → chat history (last 50)
export async function GET() {
  try {
    const messages = await db.chatMessage.findMany({
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        meta: m.metaJson ? JSON.parse(m.metaJson) : null,
        createdAt: m.createdAt,
      })),
    });
  } catch (e) {
    console.error("[api/bob GET]", e);
    return NextResponse.json({ error: "Failed to load chat" }, { status: 500 });
  }
}

// POST /api/bob { message } → Bob answers with live engine data
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { message?: string };
    const message = (body.message ?? "").trim();
    if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

    await db.chatMessage.create({ data: { role: "user", content: message } });

    const history = await db.chatMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 7,
    });
    const hist = history
      .reverse()
      .slice(0, 6)
      .map((h) => ({ role: h.role, content: h.content }));

    const answer = await bobAnswer(message, hist);

    const saved = await db.chatMessage.create({
      data: {
        role: "assistant",
        content: answer.content,
        metaJson: JSON.stringify({ actions: answer.actions, mode: answer.mode }),
      },
    });

    return NextResponse.json({
      reply: {
        id: saved.id,
        role: "assistant",
        content: answer.content,
        meta: { actions: answer.actions, mode: answer.mode },
        createdAt: saved.createdAt,
      },
    });
  } catch (e) {
    console.error("[api/bob POST]", e);
    return NextResponse.json({ error: "Bob is unavailable" }, { status: 500 });
  }
}
