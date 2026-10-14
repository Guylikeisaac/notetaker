import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { and, botAccounts, db, eq, inArray, meetingAttendees, meetings, notInArray, type RecordingStatus } from "@notetaker/db";
import { accessToken } from "./calendar";
import { config } from "./config";
import { log } from "./log";

const DRIVE = "https://www.googleapis.com/drive/v3";
const FOLDER_NAME = "Notetaker recordings";
const FOLDER_MIME = "application/vnd.google-apps.folder";
// Resumable-upload chunks must be multiples of 256 KiB.
const CHUNK_BYTES = 32 * 1024 * 1024;

const uploading = new Set<string>();

export function recordingPath(meetingId: string): string {
  return join(config.recordingsDir, `${meetingId}.webm`);
}

export function setRecordingStatus(meetingId: string, status: RecordingStatus, error: string | null = null) {
  return db
    .update(meetings)
    .set({ recordingStatus: status, recordingError: error, updatedAt: new Date() })
    .where(eq(meetings.id, meetingId));
}

async function drive<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url.startsWith("http") ? url : `${DRIVE}${url}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(`drive ${init.method ?? "GET"} ${url.split("?")[0]} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/**
 * The bot's recordings folder. With the drive.file scope the bot only sees
 * files it created itself, so searching by name finds our own folder.
 */
async function folderId(token: string): Promise<string> {
  const q = encodeURIComponent(`name = '${FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`);
  const { files } = await drive<{ files: { id: string }[] }>(token, `/files?q=${q}&fields=files(id)&pageSize=1`);
  if (files[0]) return files[0].id;
  const created = await drive<{ id: string }>(token, "/files?fields=id", {
    method: "POST",
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  return created.id;
}

/**
 * MediaRecorder output has no duration or seek index. A copy-remux through
 * ffmpeg adds both, so the file scrubs properly in Drive's player. Skipped
 * when ffmpeg isn't installed.
 */
async function remux(path: string): Promise<void> {
  const out = `${path}.remux.webm`;
  const ok = await new Promise<boolean>((resolve) => {
    const p = spawn("ffmpeg", ["-y", "-loglevel", "error", "-i", path, "-c", "copy", out], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
  if (ok) await rename(out, path);
  else await rm(out, { force: true });
}

function fileName(title: string, startsAt: Date, video: boolean): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = startsAt;
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  const safe = title.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 120);
  return `${safe} (${when})${video ? "" : " audio"}.webm`;
}

/** Sends the file to Drive with a resumable upload, one chunk at a time. */
async function upload(token: string, path: string, name: string, parent: string, mime: string) {
  const { size } = await stat(path);
  const init = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": mime,
        "x-upload-content-length": String(size),
      },
      body: JSON.stringify({ name, parents: [parent], mimeType: mime }),
    },
  );
  const session = init.headers.get("location");
  if (!init.ok || !session) throw new Error(`drive upload init failed: ${init.status} ${await init.text()}`);

  const fh = await open(path, "r");
  try {
    for (let start = 0; ; ) {
      const len = Math.min(CHUNK_BYTES, size - start);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      const res = await fetch(session, {
        method: "PUT",
        headers: { "content-range": size === 0 ? "bytes */0" : `bytes ${start}-${start + len - 1}/${size}` },
        body: buf,
      });
      if (res.status === 308) {
        // Drive reports how much it has; resume from there.
        const range = res.headers.get("range");
        start = range ? Number(range.split("-")[1]) + 1 : 0;
        continue;
      }
      if (!res.ok) throw new Error(`drive upload failed: ${res.status} ${await res.text()}`);
      return (await res.json()) as { id: string; webViewLink: string };
    }
  } finally {
    await fh.close();
  }
}

/**
 * Uploads a finished recording to the bot's Drive and shares it with whoever
 * can see the meeting in the app. The local file is deleted once it's in Drive
 * and kept for a retry if anything fails.
 */
export async function uploadRecording(meetingId: string): Promise<void> {
  if (uploading.has(meetingId)) return;
  uploading.add(meetingId);
  const ctx = { meeting: meetingId };
  try {
    const path = recordingPath(meetingId);
    if (!existsSync(path) || (await stat(path)).size === 0) {
      await setRecordingStatus(meetingId, "failed", "The recording file was empty or missing on the worker.");
      await rm(path, { force: true });
      return;
    }
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    const [bot] = await db.select().from(botAccounts).limit(1);
    if (!meeting) return;
    if (!bot) throw new Error("No bot account is connected.");

    await setRecordingStatus(meetingId, "uploading");
    await remux(path);
    const video = await hasVideo(path);
    const token = await accessToken(bot);
    const file = await upload(
      token,
      path,
      fileName(meeting.report?.title ?? meeting.title, meeting.startsAt, video),
      await folderId(token),
      video ? "video/webm" : "audio/webm",
    );

    const attendees = await db
      .select({ email: meetingAttendees.email })
      .from(meetingAttendees)
      .where(eq(meetingAttendees.meetingId, meetingId));
    for (const { email } of attendees) {
      if (email.toLowerCase() === bot.email.toLowerCase()) continue;
      await drive(token, `/files/${file.id}/permissions?sendNotificationEmail=false`, {
        method: "POST",
        body: JSON.stringify({ role: "reader", type: "user", emailAddress: email }),
      }).catch((err) => log.warn("could not share recording", { ...ctx, email, err: String(err) }));
    }

    await db
      .update(meetings)
      .set({
        recordingStatus: "uploaded",
        recordingFileId: file.id,
        recordingUrl: file.webViewLink,
        recordingError: null,
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meetingId));
    await rm(path, { force: true });
    log.info("recording uploaded", { ...ctx, file: file.id, shared: attendees.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("recording upload failed", { ...ctx, err: msg });
    const hint = /insufficient|scope|403/i.test(msg)
      ? "Google Drive access is missing. An admin needs to reconnect the bot account."
      : "Uploading the recording to Google Drive failed. It will be retried.";
    await setRecordingStatus(meetingId, "upload_failed", hint).catch(() => {});
  } finally {
    uploading.delete(meetingId);
  }
}

/** WebM files written by MediaRecorder declare their tracks up front; look for a video codec id. */
async function hasVideo(path: string): Promise<boolean> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes("V_VP");
  } finally {
    await fh.close();
  }
}

/**
 * Retries uploads that failed, and picks up recordings left behind when the
 * worker died mid-call. Only this worker's files: they live on its disk.
 */
export async function retryPendingUploads(activeMeetingIds: string[]): Promise<void> {
  const pending = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.workerId, config.workerId),
        inArray(meetings.recordingStatus, ["recording", "uploading", "upload_failed"]),
        activeMeetingIds.length ? notInArray(meetings.id, activeMeetingIds) : undefined,
      ),
    );
  for (const { id } of pending) await uploadRecording(id);
}
