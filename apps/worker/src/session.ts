import {
  asc,
  botAccounts,
  db,
  eq,
  meetings,
  transcriptSegments,
  type LiveNotes,
  type Meeting,
  type MeetingStatus,
} from "@notetaker/db";
import { generateFinalReport, generateLiveNotes } from "./ai";
import { JoinError, MeetBot } from "./bot/meet";
import { config } from "./config";
import { log } from "./log";
import { LiveTranscriber } from "./transcribe";

let shuttingDown = false;
export function requestShutdown() {
  shuttingDown = true;
}

function setStatus(id: string, status: MeetingStatus, extra: Partial<Meeting> = {}) {
  return db
    .update(meetings)
    .set({ ...extra, status, updatedAt: new Date() })
    .where(eq(meetings.id, id));
}

function segmentsOf(meetingId: string) {
  return db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, meetingId))
    .orderBy(asc(transcriptSegments.id));
}

/** Steps 11-13: turn the stored transcript into the final report. */
export async function finalizeMeeting(meeting: Meeting): Promise<void> {
  await setStatus(meeting.id, "processing", { endedAt: meeting.endedAt ?? new Date() });
  const segments = await segmentsOf(meeting.id);
  if (segments.length === 0) {
    await setStatus(meeting.id, "completed", { failureReason: "No speech was captured in this meeting." });
    return;
  }
  try {
    const report = await generateFinalReport(meeting.title, segments);
    await setStatus(meeting.id, "completed", { report });
    log.info("report generated", { meeting: meeting.id, segments: segments.length });
  } catch (err) {
    log.error("report generation failed", { meeting: meeting.id, err: String(err) });
    await setStatus(meeting.id, "failed", {
      failureReason: "The transcript was saved, but generating the final report failed.",
    });
  }
}

/** Steps 6-12 for one meeting. Caller has already moved it to "joining". */
export async function runMeeting(meeting: Meeting): Promise<void> {
  const ctx = { meeting: meeting.id, title: meeting.title };
  // One company-wide bot account.
  const [bot] = await db.select().from(botAccounts).limit(1);
  if (!bot) {
    log.warn("no bot account connected", ctx);
    await setStatus(meeting.id, "failed", { failureReason: "No bot account is connected." });
    return;
  }

  let transcriber: LiveTranscriber | null = null;
  let writes = Promise.resolve();
  let segmentCount = 0;
  let notedCount = 0;
  let notes: LiveNotes | null = null;
  let notesBusy = false;
  let notesTimer: NodeJS.Timeout | undefined;

  const audio = { chunks: 0, peak: 0 };
  const meetBot = new MeetBot(meeting.meetUrl, bot.email, (pcm, peak) => {
    audio.chunks++;
    audio.peak = Math.max(audio.peak, peak);
    transcriber?.send(pcm);
  });
  const audioStats = setInterval(() => {
    log.info("audio", { ...ctx, chunks: audio.chunks, peak: Number(audio.peak.toFixed(3)), segments: segmentCount });
    audio.peak = 0;
  }, 15_000);

  try {
    const { signedIn } = await meetBot.launch();
    log.info("bot launched", { ...ctx, signedIn });

    await meetBot.join(async () => {
      log.info("waiting for admission", ctx);
      await setStatus(meeting.id, "waiting_admission");
    });
    const [current] = await db.select({ status: meetings.status }).from(meetings).where(eq(meetings.id, meeting.id));
    if (current?.status === "cancelled") {
      log.info("skipped while joining", ctx);
      await meetBot.leave();
      await meetBot.close();
      return;
    }
    await setStatus(meeting.id, "in_call", { joinedAt: new Date() });
    log.info("in call", ctx);

    transcriber = new LiveTranscriber((u) => {
      segmentCount++;
      writes = writes
        .then(async () => {
          await db.insert(transcriptSegments).values({ meetingId: meeting.id, ...u });
          await db.update(meetings).set({ updatedAt: new Date() }).where(eq(meetings.id, meeting.id));
        })
        .catch((err) => log.error("segment write failed", { ...ctx, err: String(err) }));
    });
    await transcriber.ready();

    notesTimer = setInterval(async () => {
      if (notesBusy || segmentCount === notedCount) return;
      notesBusy = true;
      const target = segmentCount;
      try {
        await writes;
        notes = await generateLiveNotes(meeting.title, await segmentsOf(meeting.id), notes);
        await db.update(meetings).set({ notes, updatedAt: new Date() }).where(eq(meetings.id, meeting.id));
        notedCount = target;
      } catch (err) {
        log.warn("live notes failed", { ...ctx, err: String(err) });
      } finally {
        notesBusy = false;
      }
    }, config.liveNotesIntervalMs);

    const reason = await meetBot.waitForEnd({
      endsAt: meeting.endsAt,
      shouldStop: async () => {
        if (shuttingDown) return true;
        const [row] = await db.select({ status: meetings.status }).from(meetings).where(eq(meetings.id, meeting.id));
        return row?.status === "cancelled";
      },
    });
    log.info("call ended", { ...ctx, reason });
  } catch (err) {
    if (err instanceof JoinError) {
      log.warn("join failed", { ...ctx, reason: err.message });
      await setStatus(meeting.id, "failed", { failureReason: err.message });
    } else {
      log.error("bot crashed", { ...ctx, err: String(err) });
    }
    if (!transcriber) {
      if (!(err instanceof JoinError)) {
        await setStatus(meeting.id, "failed", { failureReason: "The bot hit an unexpected error while joining." });
      }
      await meetBot.close();
      return;
    }
  } finally {
    clearInterval(notesTimer);
    clearInterval(audioStats);
  }

  await meetBot.leave();
  await meetBot.close();
  await transcriber?.close();
  await writes;
  await finalizeMeeting({ ...meeting, endedAt: new Date() });
}
