import {
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The company's shared bot Google account. Its calendar and inbox are polled
// for Meet invites, and its browser profile (see apps/worker login script)
// joins calls. There is normally exactly one row.
export const botAccounts = pgTable("bot_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Admin who connected it; informational only.
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  email: text("email").notNull().unique(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

export const meetingStatus = pgEnum("meeting_status", [
  "scheduled", // detected on the bot calendar, waiting for start time
  "joining", // worker launched a browser, navigating to Meet
  "waiting_admission", // clicked "Ask to join", waiting for a host
  "in_call", // admitted, capturing audio
  "processing", // call ended, generating final report
  "completed",
  "failed",
  "cancelled", // event cancelled or user skipped it
]);

export type MeetingStatus = (typeof meetingStatus.enumValues)[number];

export type LiveNotes = {
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: { owner: string | null; task: string }[];
  openQuestions: string[];
};

export type FinalReport = LiveNotes & {
  title: string;
  topics: { title: string; summary: string }[];
  nextSteps: string[];
};

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Who sent the bot via the dashboard; null for calendar/email invites.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // Google Calendar event id, `gmail-<messageId>` or `manual-<uuid>`.
    calendarEventId: text("calendar_event_id").notNull(),
    title: text("title").notNull(),
    meetUrl: text("meet_url").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: meetingStatus("status").notNull().default("scheduled"),
    failureReason: text("failure_reason"),
    workerId: text("worker_id"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    notes: jsonb("notes").$type<LiveNotes>(),
    report: jsonb("report").$type<FinalReport>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("meetings_event_idx").on(t.calendarEventId),
    index("meetings_status_starts_idx").on(t.status, t.startsAt),
  ],
);

// Who may see a meeting: whoever invited the bot, i.e. the calendar event's
// organizer, the person who used Meet's "Add people", or whoever sent the bot
// from the dashboard.
export const meetingAttendees = pgTable(
  "meeting_attendees",
  {
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.email] }), index("attendees_email_idx").on(t.email)],
);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    speaker: text("speaker").notNull(),
    text: text("text").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("segments_meeting_idx").on(t.meetingId, t.id)],
);

export type User = typeof users.$inferSelect;
export type BotAccount = typeof botAccounts.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type TranscriptSegment = typeof transcriptSegments.$inferSelect;
