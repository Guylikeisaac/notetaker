import { and, asc, db, eq, gt, meetings, transcriptSegments } from "@notetaker/db";
import type { NextRequest } from "next/server";
import { getUser, visibleMeeting } from "@/lib/user";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_MS = 1500;
// Close a little before maxDuration; EventSource reconnects on its own and
// resumes from Last-Event-ID.
const STREAM_LIFETIME_MS = 280_000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

// Steps 9-10: pushes new transcript segments and meeting status/notes changes
// to the live meeting page. The worker writes to Postgres; this polls it.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!(await visibleMeeting(user, id))) return new Response("Not found", { status: 404 });

  let lastId = Number(req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("after") ?? 0) || 0;
  let lastUpdatedAt = "";
  const startedAt = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown, eventId?: number) => {
        let msg = `event: ${event}\n`;
        if (eventId !== undefined) msg += `id: ${eventId}\n`;
        msg += `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(msg));
      };

      try {
        while (!req.signal.aborted && Date.now() - startedAt < STREAM_LIFETIME_MS) {
          const segments = await db
            .select()
            .from(transcriptSegments)
            .where(and(eq(transcriptSegments.meetingId, id), gt(transcriptSegments.id, lastId)))
            .orderBy(asc(transcriptSegments.id))
            .limit(500);
          if (segments.length > 0) {
            lastId = segments[segments.length - 1].id;
            send("segments", segments, lastId);
          }

          const [m] = await db
            .select({
              status: meetings.status,
              notes: meetings.notes,
              failureReason: meetings.failureReason,
              updatedAt: meetings.updatedAt,
            })
            .from(meetings)
            .where(eq(meetings.id, id));
          if (!m) break;
          const stamp = m.updatedAt.toISOString();
          if (stamp !== lastUpdatedAt) {
            lastUpdatedAt = stamp;
            send("meeting", { status: m.status, notes: m.notes, failureReason: m.failureReason });
          }
          if (TERMINAL.has(m.status) && segments.length === 0) {
            send("done", {});
            break;
          }

          controller.enqueue(encoder.encode(": ping\n\n"));
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
      } catch (err) {
        if (!req.signal.aborted) console.error("meeting stream failed", err);
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
