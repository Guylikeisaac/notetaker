// One-time setup: sign the bot's Google account into a persistent Chrome
// profile so it joins Meet as itself instead of as an anonymous guest.
//
//   pnpm bot:login bot@example.com
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

// Must match config.profilesDir; not imported so this runs without API keys.
const profilesDir = process.env.BOT_PROFILES_DIR ?? join(process.cwd(), ".bot-profiles");

const email = process.argv[2];
if (!email || !email.includes("@")) {
  console.error("usage: pnpm bot:login <bot-google-email>");
  process.exit(1);
}

const dir = join(profilesDir, email);
await mkdir(dir, { recursive: true });
const context = await chromium.launchPersistentContext(dir, {
  channel: "chromium", // same browser build as the worker, so the saved sign-in is readable
  headless: false,
  args: ["--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(`https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(email)}&continue=https://meet.google.com/`);

console.log(`Sign in as ${email} in the browser window, then close the window.`);
console.log(`Profile: ${dir}`);
// On macOS closing the last window doesn't quit the browser, so watch the page too.
// On a server (virtual screen, no window buttons) press Ctrl+C when signed in.
console.log("Close the window, or press Ctrl+C here, once you're signed in.");
await new Promise<void>((resolve) => {
  context.on("close", () => resolve());
  page.on("close", () => resolve());
  process.once("SIGINT", () => resolve());
  process.once("SIGTERM", () => resolve());
});
await context.close().catch(() => {});
console.log("Saved. The worker will now join meetings as this account.");
