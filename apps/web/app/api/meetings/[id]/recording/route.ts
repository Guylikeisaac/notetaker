import type { NextRequest } from "next/server";
import { driveMedia } from "@/lib/drive";
import { getUser, visibleMeeting } from "@/lib/user";

export const dynamic = "force-dynamic";

// Vercel caps a function's response at 4.5 MB, so every request gets at most
// one chunk. The <video> element asks for the next range on its own.
const MAX_CHUNK = 4 * 1024 * 1024;

/** Parses "bytes=start-[end]"; anything else (or no header) means from the start. */
function clampRange(header: string | null): string {
  const m = header?.match(/^bytes=(\d+)-(\d*)$/);
  const start = m ? Number(m[1]) : 0;
  const askedEnd = m?.[2] ? Number(m[2]) : Infinity;
  const end = Math.min(askedEnd, start + MAX_CHUNK - 1);
  return `bytes=${start}-${end}`;
}

// Streams the meeting's recording from the bot's Google Drive to whoever can
// see the meeting, one Range chunk at a time.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const meeting = await visibleMeeting(user, id);
  if (!meeting?.recordingFileId) return new Response("Not found", { status: 404 });

  let upstream: Response;
  try {
    upstream = await driveMedia(meeting.recordingFileId, clampRange(req.headers.get("range")));
  } catch (err) {
    console.error("recording fetch failed", err);
    return new Response("The recording could not be loaded from Google Drive.", { status: 502 });
  }
  if (upstream.status === 416) {
    return new Response(null, { status: 416, headers: { "content-range": upstream.headers.get("content-range") ?? "" } });
  }
  if (!upstream.ok) {
    console.error("recording fetch failed", upstream.status, await upstream.text());
    return new Response("The recording could not be loaded from Google Drive.", { status: 502 });
  }

  const headers = new Headers({
    "accept-ranges": "bytes",
    "content-type": upstream.headers.get("content-type") ?? "video/webm",
    "cache-control": "private, max-age=3600",
  });
  for (const h of ["content-length", "content-range"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
