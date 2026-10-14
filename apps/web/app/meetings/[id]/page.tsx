import { asc, db, eq, transcriptSegments, type RecordingStatus } from "@notetaker/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { requireUser, visibleMeeting } from "@/lib/user";
import { LiveMeeting, type Segment } from "./live-meeting";

export const dynamic = "force-dynamic";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const meeting = await visibleMeeting(user, id);
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
        <Recording
          meetingId={meeting.id}
          status={meeting.recordingStatus}
          url={meeting.recordingUrl}
          error={meeting.recordingError}
        />
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

const RECORDING_COPY: Partial<Record<RecordingStatus, string>> = {
  recording: "Recording in progress",
  uploading: "Saving the recording to Google Drive…",
};

function Recording(props: { meetingId: string; status: RecordingStatus | null; url: string | null; error: string | null }) {
  if (!props.status) return null;
  if (props.status === "uploaded") {
    return (
      <div id="recording" className="space-y-2 pt-3">
        <video
          controls
          preload="metadata"
          src={`/api/meetings/${props.meetingId}/recording`}
          className="aspect-video w-full max-w-3xl rounded-xl border border-zinc-200 bg-black dark:border-zinc-800"
        />
        {props.url && (
          <a href={props.url} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            Open in Google Drive
          </a>
        )}
      </div>
    );
  }
  const copy = RECORDING_COPY[props.status] ?? props.error ?? "The recording is unavailable.";
  return <p className="text-sm text-zinc-500">{copy}</p>;
}
