import { and, botAccounts, db, eq, meetings, rawSql, type BotAccount } from "@notetaker/db";
import { decrypt } from "@notetaker/db/crypto";
import { config } from "./config";
import { log } from "./log";

type GoogleEvent = {
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

const MEET_RE = /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i;

export async function accessToken(bot: BotAccount): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: decrypt(bot.refreshTokenEnc),
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`token refresh failed: ${body.error ?? res.status}`);
  }
  return body.access_token;
}

function meetUrlOf(e: GoogleEvent): string | null {
  const candidates = [
    e.hangoutLink,
    ...(e.conferenceData?.entryPoints ?? [])
      .filter((p) => p.entryPointType === "video")
      .map((p) => p.uri),
    e.location,
    e.description,
  ];
  for (const c of candidates) {
    const m = c?.match(MEET_RE);
    if (m) return m[0].toLowerCase();
  }
  return null;
}

async function syncBot(bot: BotAccount): Promise<void> {
  const token = await accessToken(bot);
  const now = Date.now();
  const params = new URLSearchParams({
    timeMin: new Date(now - 60 * 60_000).toISOString(),
    timeMax: new Date(now + 7 * 24 * 60 * 60_000).toISOString(),
    singleEvents: "true",
    showDeleted: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`calendar list failed: ${res.status} ${await res.text()}`);
  const { items = [] } = (await res.json()) as { items?: GoogleEvent[] };

  let upserted = 0;
  for (const e of items) {
    const declined = e.attendees?.some((a) => a.self && a.responseStatus === "declined");
    if (e.status === "cancelled" || declined) {
      await db
        .update(meetings)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(meetings.userId, bot.userId),
            eq(meetings.calendarEventId, e.id),
            eq(meetings.status, "scheduled"),
          ),
        );
      continue;
    }

    const meetUrl = meetUrlOf(e);
    // All-day events and events without a Meet link are ignored.
    if (!meetUrl || !e.start?.dateTime || !e.end?.dateTime) continue;

    const values = {
      title: e.summary?.trim() || "Untitled meeting",
      meetUrl,
      startsAt: new Date(e.start.dateTime),
      endsAt: new Date(e.end.dateTime),
    };
    await db
      .insert(meetings)
      .values({ userId: bot.userId, calendarEventId: e.id, ...values })
      .onConflictDoUpdate({
        target: [meetings.userId, meetings.calendarEventId],
        set: { ...values, updatedAt: new Date() },
        // Never rewrite a meeting the bot has already started on.
        setWhere: rawSql`${meetings.status} = 'scheduled'`,
      });
    upserted++;
  }

  await db
    .update(botAccounts)
    .set({ lastSyncedAt: new Date(), lastSyncError: null })
    .where(eq(botAccounts.id, bot.id));
  log.debug("calendar synced", { bot: bot.email, events: items.length, upserted });
}

export async function syncAllCalendars(): Promise<void> {
  const bots = await db.select().from(botAccounts);
  for (const bot of bots) {
    try {
      await syncBot(bot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("calendar sync failed", { bot: bot.email, error: message });
      await db
        .update(botAccounts)
        .set({ lastSyncError: message })
        .where(eq(botAccounts.id, bot.id));
    }
  }
}
