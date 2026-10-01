import { eq, or, sql, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { meetingAttendees, meetings } from "./schema";

/** A user sees a meeting only if they invited the bot to it. */
export function canSeeMeeting(userId: string, email: string): SQL {
  return or(
    eq(meetings.userId, userId),
    sql`exists (select 1 from ${meetingAttendees} where ${meetingAttendees.meetingId} = ${meetings.id} and ${meetingAttendees.email} = ${email.toLowerCase()})`,
  )!;
}

/** Replaces a meeting's guest list. Emails are stored lowercased. */
export async function setAttendees(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PgDatabase<PgQueryResultHKT, any>,
  meetingId: string,
  emails: (string | null | undefined)[],
): Promise<void> {
  const unique = [...new Set(emails.filter((e): e is string => !!e).map((e) => e.trim().toLowerCase()))];
  await db.delete(meetingAttendees).where(eq(meetingAttendees.meetingId, meetingId));
  if (unique.length > 0) {
    await db.insert(meetingAttendees).values(unique.map((email) => ({ meetingId, email }))).onConflictDoNothing();
  }
}
