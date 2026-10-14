import { botAccounts, db } from "@notetaker/db";
import { decrypt } from "@notetaker/db/crypto";

// Recordings live in the bot's Google Drive. The website reads them with the
// bot's own token, so viewers don't need Drive access or a Google login there.

let cached: { token: string; expiresAt: number } | null = null;

async function botAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const [bot] = await db.select().from(botAccounts).limit(1);
  if (!bot) throw new Error("No bot account is connected.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: decrypt(bot.refreshTokenEnc),
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`token refresh failed: ${body.error ?? res.status}`);
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** Fetches a byte range of a Drive file. `range` is an HTTP Range header value. */
export async function driveMedia(fileId: string, range: string): Promise<Response> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const get = async () =>
    fetch(url, { headers: { authorization: `Bearer ${await botAccessToken()}`, range }, cache: "no-store" });
  let res = await get();
  if (res.status === 401) {
    // Token revoked or rotated early; refresh once.
    cached = null;
    res = await get();
  }
  return res;
}
