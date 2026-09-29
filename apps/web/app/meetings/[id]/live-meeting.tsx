"use client";

import type { FinalReport, LiveNotes, MeetingStatus } from "@notetaker/db/schema";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { NotesView } from "@/components/notes";
import { StatusBadge } from "@/components/status-badge";
import { formatOffset } from "@/lib/format";
import { stopBot } from "../../actions";

export type Segment = { id: number; speaker: string; text: string; startMs: number };

const ACTIVE: MeetingStatus[] = ["scheduled", "joining", "waiting_admission", "in_call", "processing"];
const STOPPABLE: MeetingStatus[] = ["scheduled", "joining", "waiting_admission", "in_call"];

const WAITING_COPY: Partial<Record<MeetingStatus, string>> = {
  scheduled: "The bot will join about a minute before the meeting starts.",
  joining: "The bot is opening the meeting…",
  waiting_admission: "The bot asked to join. Admit “Notetaker” from the Meet lobby.",
  in_call: "Listening. The transcript appears here as people speak.",
  processing: "The meeting ended. Writing the final report…",
};

export function LiveMeeting(props: {
  meetingId: string;
  initialStatus: MeetingStatus;
  initialNotes: LiveNotes | null;
  report: FinalReport | null;
  failureReason: string | null;
  initialSegments: Segment[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState(props.initialStatus);
  const [notes, setNotes] = useState(props.initialNotes);
  const [failureReason, setFailureReason] = useState(props.failureReason);
  const [segments, setSegments] = useState(props.initialSegments);
  const [stopping, startStop] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const live = ACTIVE.includes(status);

  useEffect(() => {
    if (!ACTIVE.includes(props.initialStatus)) return;
    const after = props.initialSegments.at(-1)?.id ?? 0;
    const es = new EventSource(`/api/meetings/${props.meetingId}/stream?after=${after}`);
    es.addEventListener("segments", (e) => {
      const incoming = JSON.parse((e as MessageEvent).data) as Segment[];
      setSegments((prev) => {
        const last = prev.at(-1)?.id ?? 0;
        return [...prev, ...incoming.filter((s) => s.id > last)];
      });
    });
    es.addEventListener("meeting", (e) => {
      const m = JSON.parse((e as MessageEvent).data) as {
        status: MeetingStatus;
        notes: LiveNotes | null;
        failureReason: string | null;
      };
      setStatus(m.status);
      setNotes(m.notes);
      setFailureReason(m.failureReason);
    });
    es.addEventListener("done", () => {
      es.close();
      router.refresh(); // pick up the final report from the server
    });
    return () => es.close();
  }, [props.meetingId, props.initialStatus, props.initialSegments, router]);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [segments]);

  const shownNotes = props.report ?? notes;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={status} />
        {live && WAITING_COPY[status] && <span className="text-sm text-zinc-500">{WAITING_COPY[status]}</span>}
        {STOPPABLE.includes(status) && (
          <button
            disabled={stopping}
            onClick={() => startStop(() => stopBot(props.meetingId))}
            className="ml-auto rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {status === "scheduled" ? "Skip this meeting" : "Make bot leave"}
          </button>
        )}
      </div>

      {failureReason && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {failureReason}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section className="flex min-h-0 flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Transcript</h2>
          <div
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="max-h-[70vh] min-h-64 space-y-3 overflow-y-auto p-4"
          >
            {segments.length === 0 ? (
              <p className="text-sm text-zinc-500">{live ? "Nothing said yet." : "No transcript for this meeting."}</p>
            ) : (
              segments.map((s) => (
                <div key={s.id} className="text-sm leading-relaxed">
                  <span className="mr-2 font-mono text-xs text-zinc-400">{formatOffset(s.startMs)}</span>
                  <span className="font-medium">{s.speaker}</span>
                  <p className="text-zinc-700 dark:text-zinc-300">{s.text}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">
            {props.report ? "Meeting report" : "Live notes"}
            {!props.report && status === "in_call" && (
              <span className="text-xs font-normal text-zinc-500">updates every minute or so</span>
            )}
          </h2>
          <div className="p-4">
            {shownNotes ? (
              <NotesView notes={shownNotes} />
            ) : (
              <p className="text-sm text-zinc-500">
                {live ? "Notes will appear once there's enough conversation." : "No notes for this meeting."}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
