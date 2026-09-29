// Connects the bot's Google account to an app user without going through the
// user's own browser (which may hop Chrome profiles for Workspace accounts).
// Runs the OAuth consent inside the bot's signed-in profile and captures the
// code at the registered redirect URI before it reaches the web app.
//
//   pnpm bot:connect <app-user-email> <bot-email>
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { botAccounts, db, eq, users } from "@notetaker/db";
import { encrypt } from "@notetaker/db/crypto";
import { chromium } from "playwright";

const [userEmail, botEmail] = process.argv.slice(2);
if (!userEmail || !botEmail) {
  console.error("usage: pnpm bot:connect <your-app-login-email> <bot-google-email>");
  process.exit(1);
}

const [user] = await db.select().from(users).where(eq(users.email, userEmail));
if (!user) {
  console.error(`${userEmail} has not signed in to the web app yet. Sign in at http://localhost:3000 first.`);
  process.exit(1);
}

const clientId = process.env.GOOGLE_CLIENT_ID!;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
const redirectUri = `${process.env.APP_URL ?? "http://localhost:3000"}/api/bot/callback`;
const state = randomBytes(16).toString("hex");

const profilesDir = process.env.BOT_PROFILES_DIR ?? join(process.cwd(), ".bot-profiles");
const profile = join(profilesDir, botEmail);
if (!existsSync(profile)) {
  console.error(`No signed-in profile for ${botEmail}. Run: pnpm bot:login ${botEmail}`);
  process.exit(1);
}

const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: false,
  args: ["--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
});
const page = context.pages()[0] ?? (await context.newPage());

const code = new Promise<string>((resolve, reject) => {
  // Intercept the redirect so the code never hits the web app's callback.
  void context.route(`${redirectUri}**`, async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      contentType: "text/html",
      body: "<h2 style='font-family:sans-serif'>Bot connected. You can close this window.</h2>",
    });
    if (url.searchParams.get("state") !== state) return reject(new Error("state mismatch"));
    const c = url.searchParams.get("code");
    c ? resolve(c) : reject(new Error(url.searchParams.get("error") ?? "no code returned"));
  });
  context.on("close", () => reject(new Error("window closed before finishing")));
});

const params = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: "openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly",
  access_type: "offline",
  prompt: "consent",
  login_hint: botEmail,
  state,
});
await page.goto(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
console.log(`In the window that opened: continue as ${botEmail}, click Continue on the warning, and allow calendar access.`);

try {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: await code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokens = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
  if (!tokens.refresh_token || !tokens.access_token) throw new Error(`token exchange failed: ${tokens.error ?? "no refresh token"}`);
  if (!tokens.scope?.includes("calendar.readonly")) throw new Error("calendar access was not granted; tick the calendar box");

  const info = (await (
    await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    })
  ).json()) as { email?: string };
  if (info.email?.toLowerCase() !== botEmail.toLowerCase()) {
    throw new Error(`signed in as ${info.email}, expected ${botEmail}`);
  }

  const refreshTokenEnc = encrypt(tokens.refresh_token);
  await db
    .insert(botAccounts)
    .values({ userId: user.id, email: info.email, refreshTokenEnc })
    .onConflictDoUpdate({
      target: botAccounts.userId,
      set: { email: info.email, refreshTokenEnc, connectedAt: new Date(), lastSyncError: null },
    });
  console.log(`Connected ${botEmail} as the bot for ${userEmail}.`);
} catch (err) {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  process.exit();
}
