import { cp, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { config } from "../config";
import { log } from "../log";
import { AUDIO_CAPTURE_SCRIPT } from "./audio-capture";

// Everything that depends on Meet's UI copy lives here. Meet changes its
// markup often; when joining breaks, this block is the first place to look.
const UI = {
  joinNow: /^(join now|join)$/i,
  askToJoin: /^ask to join$/i,
  continueWithoutDevices: /continue without (microphone and camera|mic and camera)/i,
  dismiss: /^(got it|dismiss|close)$/i,
  nameInput: 'input[aria-label="Your name"], input[placeholder="Your name"]',
  micOn: /^turn off microphone/i,
  camOn: /^turn off camera/i,
  leaveButton: 'button[aria-label*="Leave call" i]',
  denied:
    /(someone in the call denied your request|you can't join this (video )?call|no one responded to your request|your request to join was denied)/i,
  invalid: /(check your meeting code|meeting code isn't valid|this meeting has ended|you can't create a meeting yourself)/i,
  removed: /(you've been removed from the meeting|the call has ended|you left the meeting|return to home screen)/i,
  alone: /(you're the only one here|no one else is here)/i,
};

export class JoinError extends Error {}

export type EndReason = "host_ended" | "alone" | "overran" | "stopped" | "page_closed";

const inUseProfiles = new Set<string>();

export class MeetBot {
  private context!: BrowserContext;
  private page!: Page;
  private tempDir: string | null = null;
  private profileKey: string | null = null;

  constructor(
    private readonly meetUrl: string,
    private readonly botEmail: string,
    private readonly onAudio: (pcm: Buffer, peak: number) => void,
  ) {}

  /** Launches Chrome with the bot's signed-in profile if one exists, else as a guest. */
  async launch(): Promise<{ signedIn: boolean }> {
    const profile = join(config.profilesDir, this.botEmail);
    let userDataDir: string;
    let signedIn = existsSync(profile);

    if (signedIn && !inUseProfiles.has(profile)) {
      userDataDir = profile;
      inUseProfiles.add(profile);
      // Not in use by this process, so any Chrome lock left behind is from a crash.
      for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
        await rm(join(profile, f), { force: true });
      }
      this.profileKey = profile;
    } else {
      // Chrome locks a profile to one process; a second concurrent meeting for
      // the same bot gets a throwaway copy of the signed-in profile.
      this.tempDir = await mkdtemp(join(tmpdir(), "notetaker-"));
      userDataDir = this.tempDir;
      if (signedIn) {
        await cp(profile, userDataDir, {
          recursive: true,
          filter: (src) => !/Singleton(Lock|Socket|Cookie)$/.test(src),
        });
      }
    }

    this.context = await chromium.launchPersistentContext(userDataDir, {
      // Full Chromium, not the default headless shell: the shell can't read
      // cookies saved by the headed login browser, so the bot would be signed out.
      channel: "chromium",
      headless: config.headless,
      viewport: { width: 1280, height: 800 },
      args: [
        // Never use the host's real mic/camera: refuse the permission prompt, so Meet
        // offers "Continue without microphone and camera" (clicked in join()).
        "--deny-permission-prompts",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-blink-features=AutomationControlled",
        "--auto-accept-this-tab-capture",
        // Fallback if the picker still appears: pick the tab whose title contains "Meet".
        "--auto-select-tab-capture-source-by-title=Meet",
        "--auto-select-desktop-capture-source=Meet",
      ],
      ignoreDefaultArgs: ["--mute-audio", "--enable-automation"],
    });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());

    if (config.headless) {
      // Meet rejects the "HeadlessChrome" user agent.
      const ua = (await this.page.evaluate("navigator.userAgent")) as string;
      const cdp = await this.context.newCDPSession(this.page);
      await cdp.send("Emulation.setUserAgentOverride", {
        userAgent: ua.replace("HeadlessChrome", "Chrome"),
      });
    }

    this.page.on("console", (m) => {
      if (m.text().startsWith("[notetaker]")) log.info("page", { text: m.text() });
    });
    await this.page.exposeFunction("__notetakerAudio", (b64: string, peak: number) => {
      this.onAudio(Buffer.from(b64, "base64"), peak);
    });
    await this.page.addInitScript({ content: AUDIO_CAPTURE_SCRIPT });
    return { signedIn };
  }

  /**
   * Walks the normal Meet pre-join screen. Calls `onWaiting` once the bot has
   * asked to be admitted, and resolves once it is actually in the call.
   */
  async join(onWaiting: () => Promise<void>): Promise<void> {
    const page = this.page;
    await page.goto(this.meetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    const joinButton = page
      .getByRole("button", { name: UI.joinNow })
      .or(page.getByRole("button", { name: UI.askToJoin }));

    const deadline = Date.now() + 60_000;
    while (!(await joinButton.first().isVisible().catch(() => false))) {
      await this.clickIfVisible(UI.continueWithoutDevices);
      await this.clickIfVisible(UI.dismiss);
      const text = await this.bodyText();
      if (UI.invalid.test(text)) throw new JoinError("Meet link is invalid or the meeting has ended");
      if (UI.denied.test(text)) throw new JoinError("Meet refused the bot before the lobby");
      if (Date.now() > deadline) throw new JoinError("Meet pre-join screen never loaded");
      await page.waitForTimeout(1000);
    }

    const nameInput = page.locator(UI.nameInput);
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill(config.botDisplayName);
    }

    await this.clickIfVisible(UI.micOn);
    await this.clickIfVisible(UI.camOn);

    const askToJoin = page.getByRole("button", { name: UI.askToJoin });
    const needsAdmission = await askToJoin.isVisible().catch(() => false);
    await joinButton.first().click();
    if (needsAdmission) await onWaiting();

    const admitDeadline = Date.now() + config.admissionTimeoutMs;
    const leave = page.locator(UI.leaveButton);
    while (!(await leave.first().isVisible().catch(() => false))) {
      const text = await this.bodyText();
      if (UI.denied.test(text)) throw new JoinError("Host denied the bot's request to join");
      if (UI.invalid.test(text)) throw new JoinError("Meeting ended before the bot was admitted");
      if (Date.now() > admitDeadline) throw new JoinError("Nobody admitted the bot in time");
      await page.waitForTimeout(2000);
    }
    await this.clickIfVisible(UI.dismiss);
    // Belt and braces: if Meet still got a mic or camera, switch them off.
    await this.clickIfVisible(UI.micOn);
    await this.clickIfVisible(UI.camOn);
    await this.startTabCapture();
    await this.minimizeWindow();
  }

  /** Keeps the bot's (headed) browser out of the way on a desktop. Audio capture keeps running. */
  private async minimizeWindow(): Promise<void> {
    if (config.headless) return;
    try {
      const cdp = await this.context.newCDPSession(this.page);
      const { windowId } = (await cdp.send("Browser.getWindowForTarget")) as { windowId: number };
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
    } catch (err) {
      log.warn("could not minimize bot window", { error: String(err) });
    }
  }

  /** Starts recording the tab's audio output. getDisplayMedia needs a user gesture, so evaluate over CDP with one. */
  private async startTabCapture(): Promise<void> {
    const cdp = await this.context.newCDPSession(this.page);
    type EvalResult = { exceptionDetails?: { exception?: { description?: string }; text?: string } };
    const res = await Promise.race<EvalResult>([
      cdp.send("Runtime.evaluate", {
        expression: "window.__notetakerStartTabCapture()",
        userGesture: true,
        awaitPromise: true,
      }) as Promise<EvalResult>,
      new Promise<EvalResult>((resolve) =>
        setTimeout(() => resolve({ exceptionDetails: { text: "timed out waiting for the share picker" } }), 15_000),
      ),
    ]);
    await this.page.keyboard.press("Escape").catch(() => {}); // dismiss a leftover picker, if any
    if (res.exceptionDetails) {
      const msg = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text;
      log.warn("tab capture failed; falling back to WebRTC tracks", { error: msg });
      await this.page.evaluate("window.__notetakerUseTrackFallback && window.__notetakerUseTrackFallback()").catch(() => {});
    }
  }

  /** Resolves when the call is over for the bot, for whatever reason. */
  async waitForEnd(opts: { endsAt: Date; shouldStop: () => Promise<boolean> }): Promise<EndReason> {
    const leave = this.page.locator(UI.leaveButton);
    let aloneSince: number | null = null;
    let missingLeave = 0;
    let lastStopCheck = 0;

    for (;;) {
      if (this.page.isClosed()) return "page_closed";
      await this.page.waitForTimeout(5000).catch(() => {});
      if (this.page.isClosed()) return "page_closed";

      const text = await this.bodyText();
      if (UI.removed.test(text)) return "host_ended";

      const inCall = await leave.first().isVisible().catch(() => false);
      missingLeave = inCall ? 0 : missingLeave + 1;
      if (missingLeave >= 3) return "host_ended";

      if (UI.alone.test(text)) {
        aloneSince ??= Date.now();
        if (Date.now() - aloneSince > config.aloneTimeoutMs) return "alone";
      } else {
        aloneSince = null;
      }

      if (Date.now() > opts.endsAt.getTime() + config.overrunGraceMs) return "overran";

      if (Date.now() - lastStopCheck > 15_000) {
        lastStopCheck = Date.now();
        if (await opts.shouldStop()) return "stopped";
      }
    }
  }

  async leave(): Promise<void> {
    if (this.page.isClosed()) return;
    await this.page
      .locator(UI.leaveButton)
      .first()
      .click({ timeout: 5000 })
      .catch(() => {});
  }

  async close(): Promise<void> {
    await this.context?.close().catch((err) => log.warn("browser close failed", { err: String(err) }));
    if (this.profileKey) inUseProfiles.delete(this.profileKey);
    if (this.tempDir) await rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
  }

  private async bodyText(): Promise<string> {
    return ((await this.page.evaluate("document.body ? document.body.innerText : ''").catch(() => "")) ??
      "") as string;
  }

  private async clickIfVisible(name: RegExp): Promise<void> {
    const btn = this.page.getByRole("button", { name }).first();
    if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
  }
}
