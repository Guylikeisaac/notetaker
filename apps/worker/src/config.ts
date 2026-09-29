import { hostname } from "node:os";
import { join } from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const config = {
  workerId: process.env.WORKER_ID ?? `${hostname()}-${process.pid}`,
  googleClientId: required("GOOGLE_CLIENT_ID"),
  googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
  assemblyAiApiKey: required("ASSEMBLYAI_API_KEY"),
  geminiApiKey: required("GEMINI_API_KEY"),
  liveNotesModel: process.env.LIVE_NOTES_MODEL ?? "gemini-2.5-flash",
  reportModel: process.env.REPORT_MODEL ?? "gemini-2.5-flash",

  // Persistent Chrome profiles, one per bot email, created by `pnpm bot:login`.
  profilesDir: process.env.BOT_PROFILES_DIR ?? join(process.cwd(), ".bot-profiles"),
  botDisplayName: process.env.BOT_DISPLAY_NAME ?? "Notetaker",
  headless: process.env.BOT_HEADLESS !== "false",

  maxConcurrentBots: Number(process.env.MAX_CONCURRENT_BOTS ?? 3),
  calendarSyncIntervalMs: 60_000,
  inboxCheckIntervalMs: 20_000,
  schedulerIntervalMs: 15_000,
  joinLeadMs: 60_000, // launch this long before the event starts
  admissionTimeoutMs: 10 * 60_000,
  aloneTimeoutMs: 3 * 60_000, // leave after being the only participant this long
  overrunGraceMs: 60 * 60_000, // hard cap: leave this long after scheduled end
  liveNotesIntervalMs: 45_000,
};
