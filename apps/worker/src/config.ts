import { hostname } from "node:os";
import { dirname, join } from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// Persistent Chrome profiles, one per bot email, created by `pnpm bot:login`.
const profilesDir = process.env.BOT_PROFILES_DIR ?? join(process.cwd(), ".bot-profiles");

const recording = process.env.RECORDING ?? "video";
if (!["video", "audio", "off"].includes(recording)) throw new Error("RECORDING must be video, audio or off");

export const config = {
  workerId: process.env.WORKER_ID ?? `${hostname()}-${process.pid}`,
  googleClientId: required("GOOGLE_CLIENT_ID"),
  googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
  assemblyAiApiKey: required("ASSEMBLYAI_API_KEY"),
  geminiApiKey: required("GEMINI_API_KEY"),
  liveNotesModel: process.env.LIVE_NOTES_MODEL ?? "gemini-2.5-flash",
  reportModel: process.env.REPORT_MODEL ?? "gemini-2.5-flash",

  profilesDir,
  botDisplayName: process.env.BOT_DISPLAY_NAME ?? "Notetaker",
  headless: process.env.BOT_HEADLESS !== "false",

  // video = the Meet tab as the bot sees it; audio = call audio only.
  // Either way the file is uploaded to the bot's Google Drive after the call.
  recording: recording as "video" | "audio" | "off",
  // Local staging for recordings until they reach Drive.
  recordingsDir: process.env.RECORDINGS_DIR ?? join(dirname(profilesDir), "recordings"),
  recordingUploadRetryMs: 10 * 60_000,

  maxConcurrentBots: Number(process.env.MAX_CONCURRENT_BOTS ?? 3),
  calendarSyncIntervalMs: 60_000,
  inboxCheckIntervalMs: 20_000,
  schedulerIntervalMs: 15_000,
  joinLeadMs: 60_000, // launch this long before the event starts
  admissionTimeoutMs: 10 * 60_000,
  aloneTimeoutMs: 3 * 60_000, // leave after being the only participant this long
  overrunGraceMs: 60 * 60_000, // hard cap: leave this long after scheduled end
  // Each tick is one Gemini call per live meeting; raise it to stay inside free-tier quotas.
  liveNotesIntervalMs: Number(process.env.LIVE_NOTES_INTERVAL_SECONDS ?? 45) * 1000,
};
