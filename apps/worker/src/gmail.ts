import { and, botAccounts, db, eq, inArray, meetings, type BotAccount } from "@notetaker/db";
import { accessToken } from "./calendar";
import { log } from "./log";

// Meet's "Add people" button emails the invitee from this address. Only these
// are trusted, so a random email containing a Meet link can't summon the bot.
const MEET_INVITE_SENDER = "meetings-noreply@google.com";
const MEET_RE = /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i;
const MAX_INVITE_AGE_MS = 30 * 60_000;
const ACTIVE = ["scheduled", "joining", "waiting_admission", "in_call"] as const;

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };
type Message = {
  id: string;
  internalDate: string;
  payload?: Part & { headers?: { name: string; value: string }[] };
};

function bodyText(part: Part | undefined): string {
  if (!part) return "";
  const own = part.body?.data ? Buffer.from(part.body.data, "base64url").toString("utf8") : "";
  return own + (part.parts ?? []).map(bodyText).join("\n");
}

async function gmail<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`gmail ${path.split("?")[0]} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function checkBot(bot: BotAccount): Promise<void> {
  const token = await accessToken(bot);
  const q = encodeURIComponent(`from:${MEET_INVITE_SENDER} newer_than:1d`);
  const { messages = [] } = await gmail<{ messages?: { id: string }[] }>(token, `messages?q=${q}&maxResults=20`);

  for (const { id } of messages) {
    const calendarEventId = `gmail-${id}`;
    const [seen] = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(and(eq(meetings.userId, bot.userId), eq(meetings.calendarEventId, calendarEventId)));
    if (seen) continue;

    const msg = await gmail<Message>(token, `messages/${id}?format=full`);
    const sentAt = Number(msg.internalDate);
    if (Date.now() - sentAt > MAX_INVITE_AGE_MS) continue; // stale invite; the call is probably over

    const meetUrl = bodyText(msg.payload).match(MEET_RE)?.[0].toLowerCase();
    if (!meetUrl) continue;

    // A calendar invite for the same call may already have queued the bot.
    const [already] = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(and(eq(meetings.userId, bot.userId), eq(meetings.meetUrl, meetUrl), inArray(meetings.status, [...ACTIVE])));
    if (already) continue;

    const subject = msg.payload?.headers?.find((h) => h.name.toLowerCase() === "subject")?.value;
    const now = new Date();
    await db
      .insert(meetings)
      .values({
        userId: bot.userId,
        calendarEventId,
        title: subject?.replace(/^invitation:\s*/i, "").trim() || `Meet ${meetUrl.split("/").pop()}`,
        meetUrl,
        startsAt: now,
        endsAt: new Date(now.getTime() + 2 * 60 * 60_000),
      })
      .onConflictDoNothing();
    log.info("meet invite email detected", { bot: bot.email, meetUrl });
  }
}

/** Picks up invites sent with Meet's "Add people" button (no calendar event involved). */
export async function checkAllInboxes(): Promise<void> {
  const bots = await db.select().from(botAccounts);
  for (const bot of bots) {
    try {
      await checkBot(bot);
    } catch (err) {
      log.warn("inbox check failed", { bot: bot.email, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
