import { asc, db, eq, transcriptSegments } from "@notetaker/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { requireUserId, ownedMeeting } from "@/lib/user";
import { LiveMeeting, type Segment } from "./live-meeting";

export const dynamic = "force-dynamic";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const meeting = await ownedMeeting(userId, id);
  if (!meeting) notFound();

  const rows = await db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, id))
    .orderBy(asc(transcriptSegments.id));
  const segments: Segment[] = rows.map(({ id, speaker, text, startMs }) => ({ id, speaker, text, startMs }));

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="space-y-1">
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{meeting.report?.title ?? meeting.title}</h1>
        <p className="text-sm text-zinc-500">
          <LocalTime iso={meeting.startsAt.toISOString()} /> ·{" "}
          <a href={meeting.meetUrl} target="_blank" rel="noreferrer" className="hover:underline">
            {meeting.meetUrl.replace("https://", "")}
          </a>
        </p>
      </div>

      <LiveMeeting
        meetingId={meeting.id}
        initialStatus={meeting.status}
        initialNotes={meeting.notes}
        report={meeting.report}
        failureReason={meeting.failureReason}
        initialSegments={segments}
      />
    </main>
  );
}
