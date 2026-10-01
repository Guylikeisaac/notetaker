# Notetaker

A Google Meet bot that joins your calls, transcribes them live, and writes the notes.

```
apps/web      Next.js app: Google sign-in, bot connection, dashboard, live meeting view   (deploy to Vercel)
apps/worker   Long-running Node process: calendar polling, scheduler, Playwright Meet bot,
              AssemblyAI streaming STT, Gemini notes/report                                 (deploy to a VM/container)
packages/db   Drizzle schema + Postgres client + token encryption, shared by both
```

## How the flow maps to code

| # | Step | Where |
|---|------|-------|
| 1 | User signs in with Google | `apps/web/auth.ts` (Auth.js, JWT sessions, upserts `users`) |
| 2 | User connects the bot's Google account | `apps/web/app/api/bot/{connect,callback}` — offline OAuth for `calendar.readonly`, refresh token encrypted in `bot_accounts` |
| 3 | Bot is invited to a Meet | User adds the bot's email as a guest on a calendar event |
| 4 | Calendar event detected | `apps/worker/src/calendar.ts` — polls the bot's calendar every 60s, keeps events with a Meet link |
| 5 | Meeting scheduled | Upserted into `meetings` with status `scheduled`; cancellations and declines become `cancelled` |
| 6 | Bot worker launches | `apps/worker/src/index.ts` — every 15s it claims meetings starting within 1 min (atomic conditional update, so several workers are safe) |
| 7 | Normal Meet admission | `apps/worker/src/bot/meet.ts` — opens the Meet link, joins with **Join now** or **Ask to join** → `waiting_admission` → `in_call`. Handles denial and a 10 min admission timeout |
| 8 | Audio processed | `bot/audio-capture.ts` taps remote WebRTC audio tracks in the page → 16 kHz PCM → `transcribe.ts` (AssemblyAI Universal-Streaming) |
| 9 | Live transcript | Final utterances go to `transcript_segments`; `/api/meetings/[id]/stream` pushes them to the browser over SSE |
| 10 | AI notes update live | `session.ts` calls Gemini every ~45s when there's new speech and stores `meetings.notes` |
| 11 | Meeting ends | Leave button disappears, host ends it, the bot is alone for 3 min, the user clicks **Make bot leave**, or 1h past the scheduled end |
| 12 | Final report | `ai.ts` `generateFinalReport` (summary, topics, decisions, action items, next steps) → `meetings.report` |
| 13 | Saved in dashboard | `/dashboard` lists it under Past meetings; `/meetings/[id]` shows report + transcript |

## Company use

- **One shared bot.** An admin (`ADMIN_EMAILS`) connects the bot's Google account once, from the dashboard or with `pnpm bot:connect <admin-email> <bot-email>`.
- **Sign-in** is limited to `ALLOWED_EMAIL_DOMAINS` (e.g. `syncup.in`) plus any `ALLOWED_EMAILS`.
- **Who sees what.** Only the person who invited the bot sees a meeting's notes: the calendar event's organizer, the person who used Meet's *Add people*, or whoever sent the bot from the dashboard.
- **Invites.** Everyone just invites the bot's email, from a calendar event or with *Add people* in a running Meet.

## Setup

1. **Postgres**: any Postgres works. On Vercel, add Neon from the Marketplace.
2. **Google Cloud**: create an OAuth client (Web application), enable the **Google Calendar API**, and add both redirect URIs listed in `.env.example`. While the consent screen is in *Testing*, add your account and the bot account as test users. `calendar.readonly` is a sensitive scope, so production use requires Google verification.
3. **Keys**: AssemblyAI API key (free hours on signup) and a Gemini API key (free at aistudio.google.com).
4. Configure and install:
   ```sh
   cp .env.example .env        # fill it in
   pnpm install
   pnpm db:push                # creates the tables
   ```
5. **Bot account**: create a dedicated Google account for the bot. Then sign its browser profile in once, so it joins as itself instead of as an anonymous guest:
   ```sh
   pnpm bot:login bot@yourdomain.com
   ```
   Without a profile the bot still works. It joins as a guest named `BOT_DISPLAY_NAME` and always has to be admitted from the lobby.
6. Run:
   ```sh
   pnpm dev:web      # http://localhost:3000
   pnpm dev:worker
   ```
   Sign in, connect the bot account, and invite the bot's email to a Meet event. Set `BOT_HEADLESS=false` to watch the browser.

## Deploying

**AWS EC2 step-by-step guide for the worker: [`deploy/aws/README.md`](deploy/aws/README.md).**

- **Web → Vercel.** Set the project root to `apps/web` and add `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, and `AUTH_SECRET`.
- **Worker → any long-running container host** (Fly.io, Railway, ECS, a VM). Calls can last hours, and each bot holds a real Chrome process, so the worker can't run as a serverless function.
  ```sh
  docker build -f apps/worker/Dockerfile -t notetaker-worker .
  docker run --env-file .env -e WORKER_ID=worker-1 -v notetaker-data:/data notetaker-worker
  ```
  The image runs Chrome under Xvfb, which Meet accepts more readily than headless mode. Mount `/data` so signed-in bot profiles persist. To create a profile on the server, run `pnpm bot:login` locally and copy `.bot-profiles/<email>` into the volume.
  Budget about 1 vCPU and 1–1.5 GB of RAM per concurrent bot (`MAX_CONCURRENT_BOTS`).

## Known limitations

- **Meet UI selectors.** Meet changes its markup without notice. All UI text and selectors live in the `UI` block at the top of `apps/worker/src/bot/meet.ts`. If joining or end-detection breaks, update them there.
- **Speaker names.** Speakers are labeled by diarization (`Speaker 1`, `Speaker 2`, …), not by Meet display names. Gemini uses real names only when the conversation makes them clear.
- **Consent.** The bot is visible in the participant list. Make sure attendees know the meeting is being transcribed, as your jurisdiction may require.
- **Google automation checks.** Google may challenge or block automated sign-ins. A dedicated Workspace account for the bot is far more reliable than a consumer account.
