import { and, db, eq, gt, inArray, lt, lte, meetings, transcriptSegments, type Meeting } from "@notetaker/db";
import { syncAllCalendars } from "./calendar";
import { checkAllInboxes } from "./gmail";
import { config } from "./config";
import { log } from "./log";
import { finalizeMeeting, requestShutdown, runMeeting } from "./session";

const active = new Map<string, Promise<void>>();
let stopping = false;

/** Meetings this worker was handling when it last died. */
async function recoverOrphans(): Promise<void> {
  const orphans = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.workerId, config.workerId),
        inArray(meetings.status, ["joining", "waiting_admission", "in_call", "processing"]),
      ),
    );
  for (const m of orphans) {
    const [seg] = await db
      .select({ id: transcriptSegments.id })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, m.id))
      .limit(1);
    if (seg) {
      log.info("finalizing orphaned meeting", { meeting: m.id });
      await finalizeMeeting(m);
    } else {
      await db
        .update(meetings)
        .set({ status: "failed", failureReason: "The bot worker restarted during this meeting.", updatedAt: new Date() })
        .where(eq(meetings.id, m.id));
    }
  }
}

async function schedule(): Promise<void> {
  const now = new Date();

  // Meetings that ended while no worker was running.
  await db
    .update(meetings)
    .set({ status: "failed", failureReason: "No bot worker was running at meeting time.", updatedAt: now })
    .where(and(eq(meetings.status, "scheduled"), lt(meetings.endsAt, now)));

  const slots = config.maxConcurrentBots - active.size;
  if (slots <= 0) return;

  const due = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.status, "scheduled"),
        lte(meetings.startsAt, new Date(now.getTime() + config.joinLeadMs)),
        gt(meetings.endsAt, now),
      ),
    )
    .orderBy(meetings.startsAt)
    .limit(slots);

  for (const candidate of due) {
    // Conditional update = claim. Only one worker wins each meeting.
    const [claimed] = await db
      .update(meetings)
      .set({ status: "joining", workerId: config.workerId, updatedAt: new Date() })
      .where(and(eq(meetings.id, candidate.id), eq(meetings.status, "scheduled")))
      .returning();
    if (!claimed) continue;
    launch(claimed);
  }
}

function launch(meeting: Meeting): void {
  log.info("launching bot", { meeting: meeting.id, title: meeting.title, url: meeting.meetUrl });
  const run = runMeeting(meeting)
    .catch((err) => log.error("session failed", { meeting: meeting.id, err: String(err) }))
    .finally(() => active.delete(meeting.id));
  active.set(meeting.id, run);
}

function every(ms: number, name: string, fn: () => Promise<void>): void {
  let busy = false;
  const tick = async () => {
    if (stopping || busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      log.error(`${name} failed`, { err: String(err) });
    } finally {
      busy = false;
    }
  };
  void tick();
  setInterval(tick, ms);
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info("shutting down; leaving active calls", { signal, active: active.size });
  requestShutdown();
  await Promise.allSettled(active.values());
  process.exit(0);
}

async function main(): Promise<void> {
  log.info("worker starting", { workerId: config.workerId, maxConcurrentBots: config.maxConcurrentBots });
  await recoverOrphans();
  every(config.calendarSyncIntervalMs, "calendar sync", syncAllCalendars);
  every(config.inboxCheckIntervalMs, "inbox check", checkAllInboxes);
  every(config.schedulerIntervalMs, "scheduler", schedule);
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("worker failed to start", { err: String(err) });
  process.exit(1);
});
