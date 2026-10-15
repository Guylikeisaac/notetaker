import { hostname } from "node:os";
import { and, db, eq, gt, inArray, lt, lte, meetingAttendees, meetings, ne, transcriptSegments, users, workers, type Meeting } from "@notetaker/db";
import { syncAllCalendars } from "./calendar";
import { checkAllInboxes } from "./gmail";
import { config } from "./config";
import { retryPendingUploads } from "./drive";
import { log } from "./log";
import { finalizeMeeting, requestShutdown, runMeeting } from "./session";

const active = new Map<string, Promise<void>>();
let stopping = false;
const startedAt = new Date();

/** Tells the dashboard this worker is alive and how busy it is. */
async function heartbeat(): Promise<void> {
  const row = {
    host: process.env.WORKER_HOST ?? hostname(),
    activeMeetings: active.size,
    maxMeetings: config.maxConcurrentBots,
    startedAt,
    lastSeenAt: new Date(),
  };
  await db.insert(workers).values({ id: config.workerId, ...row }).onConflictDoUpdate({ target: workers.id, set: row });
}

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

  let slots = config.maxConcurrentBots - active.size;

  // Not limited to free slots: duplicates of a live call are cleared even while busy.
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
    .limit(20);

  for (const candidate of due) {
    if (await mergeIntoLiveCall(candidate)) continue;
    if (slots <= 0) continue;
    // Conditional update = claim. Only one worker wins each meeting.
    const [claimed] = await db
      .update(meetings)
      .set({ status: "joining", workerId: config.workerId, updatedAt: new Date() })
      .where(and(eq(meetings.id, candidate.id), eq(meetings.status, "scheduled")))
      .returning();
    if (!claimed) continue;
    slots--;
    launch(claimed);
  }
}

/**
 * The same Meet link can arrive twice (calendar invite and "Send bot"). If the
 * bot is already in that call, give the duplicate's viewers access to the live
 * meeting and skip the duplicate, instead of joining a second time.
 */
async function mergeIntoLiveCall(candidate: Meeting): Promise<boolean> {
  const [live] = await db
    .select({ id: meetings.id, title: meetings.title })
    .from(meetings)
    .where(
      and(
        eq(meetings.meetUrl, candidate.meetUrl),
        ne(meetings.id, candidate.id),
        inArray(meetings.status, ["joining", "waiting_admission", "in_call"]),
      ),
    )
    .limit(1);
  if (!live) return false;

  const viewers = await db
    .select({ email: meetingAttendees.email })
    .from(meetingAttendees)
    .where(eq(meetingAttendees.meetingId, candidate.id));
  if (candidate.userId) {
    const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, candidate.userId));
    if (owner) viewers.push({ email: owner.email.toLowerCase() });
  }
  if (viewers.length) {
    await db
      .insert(meetingAttendees)
      .values(viewers.map(({ email }) => ({ meetingId: live.id, email })))
      .onConflictDoNothing();
  }
  await db
    .update(meetings)
    .set({ status: "cancelled", failureReason: `The bot is already in this call ("${live.title}").`, updatedAt: new Date() })
    .where(and(eq(meetings.id, candidate.id), eq(meetings.status, "scheduled")));
  log.info("skipped duplicate of a live call", { meeting: candidate.id, live: live.id });
  return true;
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
  await db.delete(workers).where(eq(workers.id, config.workerId)).catch(() => {});
  process.exit(0);
}

// A dropped connection (sleep, Wi-Fi) must not kill the worker; the loops retry on their next tick.
process.on("unhandledRejection", (err) => log.error("unhandled rejection", { err: String(err) }));
process.on("uncaughtException", (err) => log.error("uncaught exception", { err: String(err) }));

async function main(): Promise<void> {
  log.info("worker starting", { workerId: config.workerId, maxConcurrentBots: config.maxConcurrentBots });
  await recoverOrphans();
  every(config.heartbeatIntervalMs, "heartbeat", heartbeat);
  every(config.calendarSyncIntervalMs, "calendar sync", syncAllCalendars);
  every(config.inboxCheckIntervalMs, "inbox check", checkAllInboxes);
  every(config.schedulerIntervalMs, "scheduler", schedule);
  if (config.recording !== "off") {
    every(config.recordingUploadRetryMs, "recording upload retry", () => retryPendingUploads([...active.keys()]));
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("worker failed to start", { err: String(err) });
  process.exit(1);
});
