import { and, botAccounts, db, desc, eq, gte, inArray, meetings, type Meeting } from "@notetaker/db";
import Link from "next/link";
import { auth } from "@/auth";
import { AutoRefresh } from "@/components/auto-refresh";
import { LocalTime } from "@/components/local-time";
import { StatusBadge } from "@/components/status-badge";
import { requireUserId } from "@/lib/user";
import { disconnectBot, restoreMeeting, sendBotNow, signOutAction, stopBot } from "../actions";

export const dynamic = "force-dynamic";

const LIVE = ["joining", "waiting_admission", "in_call", "processing"] as const;

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          done ? "bg-emerald-600 text-white" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {children && <div className="text-sm text-zinc-600 dark:text-zinc-400">{children}</div>}
      </div>
    </li>
  );
}

function MeetingRow({ m, action }: { m: Meeting; action?: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <Link href={`/meetings/${m.id}`} className="min-w-0 flex-1 hover:underline">
        <p className="truncate font-medium">{m.title}</p>
        <p className="text-sm text-zinc-500">
          <LocalTime iso={m.startsAt.toISOString()} />
        </p>
      </Link>
      <div className="flex shrink-0 items-center gap-3">
        <StatusBadge status={m.status} />
        {action}
      </div>
    </li>
  );
}

function List({ title, items, empty, action }: {
  title: string;
  items: Meeting[];
  empty: string;
  action?: (m: Meeting) => React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {items.map((m) => (
            <MeetingRow key={m.id} m={m} action={action?.(m)} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ bot_error?: string }> }) {
  const userId = await requireUserId();
  const session = await auth();
  const { bot_error } = await searchParams;

  const [bot] = await db.select().from(botAccounts).where(eq(botAccounts.userId, userId));
  const now = new Date();
  const [live, upcoming, past] = await Promise.all([
    db.select().from(meetings)
      .where(and(eq(meetings.userId, userId), inArray(meetings.status, [...LIVE])))
      .orderBy(meetings.startsAt),
    db.select().from(meetings)
      .where(and(eq(meetings.userId, userId), inArray(meetings.status, ["scheduled", "cancelled"]), gte(meetings.endsAt, now)))
      .orderBy(meetings.startsAt)
      .limit(20),
    db.select().from(meetings)
      .where(and(eq(meetings.userId, userId), inArray(meetings.status, ["completed", "failed"])))
      .orderBy(desc(meetings.startsAt))
      .limit(50),
  ]);

  const hasMeetings = live.length + upcoming.length + past.length > 0;

  return (
    <main className="mx-auto max-w-3xl space-y-10 px-6 py-10">
      <AutoRefresh everyMs={15_000} />
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Notetaker</h1>
        <form action={signOutAction} className="flex items-center gap-3 text-sm text-zinc-500">
          <span>{session?.user?.email}</span>
          <button className="hover:text-zinc-900 dark:hover:text-white">Sign out</button>
        </form>
      </header>

      <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Setup</h2>
        {bot_error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{bot_error}</p>
        )}
        <ol className="space-y-4">
          <Step n={1} done title="Sign in with Google" />
          <Step n={2} done={!!bot} title="Connect the bot's Google account">
            {bot ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  Connected as <span className="font-medium text-zinc-900 dark:text-zinc-100">{bot.email}</span>
                </span>
                <form action={disconnectBot}>
                  <button className="text-red-600 hover:underline">Disconnect</button>
                </form>
                {bot.lastSyncError ? (
                  <span className="w-full text-red-600">Calendar sync failing: {bot.lastSyncError}</span>
                ) : bot.lastSyncedAt ? (
                  <span className="w-full">
                    Calendar last checked <LocalTime iso={bot.lastSyncedAt.toISOString()} />
                  </span>
                ) : (
                  <span className="w-full">Waiting for the worker's first calendar check…</span>
                )}
              </div>
            ) : (
              <>
                <p>Use a separate Google account that exists only to attend meetings.</p>
                <a
                  href="/api/bot/connect"
                  className="mt-2 inline-block rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
                >
                  Connect bot account
                </a>
              </>
            )}
          </Step>
          <Step n={3} done={hasMeetings} title="Invite the bot to a Google Meet">
            {bot ? (
              <p>
                Add <span className="font-medium text-zinc-900 dark:text-zinc-100">{bot.email}</span> as a guest on any
                calendar event with a Meet link, or use <span className="font-medium text-zinc-900 dark:text-zinc-100">Add people</span> inside a running Meet. It joins on its own, and the meeting shows up below.
              </p>
            ) : (
              <p>Once the bot is connected, invite its email address to your meetings.</p>
            )}
          </Step>
        </ol>
      </section>

      {live.length > 0 && <List title="Happening now" items={live} empty="" />}

      <List
        title="Upcoming"
        items={upcoming}
        empty="No upcoming meetings with the bot invited."
        action={(m) =>
          m.status === "scheduled" ? (
            <form action={stopBot.bind(null, m.id)}>
              <button className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Skip</button>
            </form>
          ) : (
            <form action={restoreMeeting.bind(null, m.id)}>
              <button className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Undo</button>
            </form>
          )
        }
      />

      <List title="Past meetings" items={past} empty="Finished meetings and their notes will appear here." />

      {bot && (
        <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">Send the bot to any meeting <span className="text-sm font-normal text-zinc-500">(optional)</span></h2>
          <p className="text-sm text-zinc-500">Not needed for meetings the bot is invited to. Use this only for a meeting you didn't invite it to: paste the Meet link and it joins within about 15 seconds.</p>
          <form action={sendBotNow} className="flex flex-col gap-2 sm:flex-row">
            <input
              name="meetUrl"
              required
              placeholder="https://meet.google.com/abc-defg-hij"
              className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
            <input
              name="title"
              placeholder="Title (optional)"
              className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm sm:w-48 dark:border-zinc-700"
            />
            <button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900">
              Send bot
            </button>
          </form>
        </section>
      )}

    </main>
  );
}
