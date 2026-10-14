# Hosting everything free

| Piece | Where | Cost |
|---|---|---|
| Website | **Vercel**, https://notetaker-nu-lac.vercel.app | free (Hobby) |
| Database | **Supabase** Postgres (500 MB, always on) | free |
| Meeting bot | **Oracle Cloud** Always Free VM (Ampere A1) | free |
| Recordings | the bot account's Google Drive | free (Drive storage) |
| Live notes + report | Gemini API free tier | free, within its daily quota |
| Speech-to-text | AssemblyAI streaming | free signup credit, then about $0.15 per meeting-hour |

All settings live in one file, `~/notetaker/.env` on your Mac. Copy it to the VM, and push the
website's subset to Vercel with `sh deploy/vercel-env.sh`.

Why Supabase and not Neon: the bot reads the database every 15–20 seconds. Neon's free
database would never get to sleep and would use up its monthly compute hours in about two weeks.
Supabase's free database is always on.

## 1. Database (Supabase)

1. [supabase.com](https://supabase.com) → New project → name `notetaker`, region **Mumbai** (ap-south-1). Keep the database password.
2. **Connect** (top bar) → **Session pooler** → copy the URI and put your password in it. It looks like:
   `postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
3. Paste it as `DATABASE_URL` in `.env`.
4. On your Mac, create the tables: `pnpm db:push`

The website automatically uses the same URI on port **6543** (transaction pooler, made for serverless).

Free projects pause after 7 days with no database activity. The running bot touches the database every few seconds, so this only happens if the bot is down for a week. Restore the project from the Supabase dashboard if it does.

## 2. Website (Vercel)

The Vercel project `notetaker` is linked to this repo with Root Directory `apps/web`.

```sh
sh deploy/vercel-env.sh    # copies DATABASE_URL, Google client, secrets, allowed emails
vercel deploy --prod
```

On the Google OAuth client, add both redirect URIs:
- `https://notetaker-nu-lac.vercel.app/api/auth/callback/google`
- `https://notetaker-nu-lac.vercel.app/api/bot/callback`

For auto-deploys on every push, connect the Git repo under Vercel → Project → Settings → Git (`ayushsyncup/notetaker`).

## 3. Bot VM (Oracle Cloud)

Oracle console → **Compute → Instances → Create instance**:

| Setting | Value |
|---|---|
| Name | `notetaker-bot` |
| Image | **Canonical Ubuntu 24.04** (aarch64) |
| Shape | **VM.Standard.A1.Flex**: **2 OCPU, 12 GB** (4–6 meetings at once with recording; the free allowance is 4 OCPU / 24 GB) |
| Networking | Public subnet, public IPv4 on. No inbound ports beyond SSH. |
| SSH keys | Upload your public key |
| Boot volume | **100 GB** (free up to 200 GB). Recordings wait here until they reach Drive. |

- **"Out of capacity"** for A1 is common. Let the Mac retry for you until it gets one:
  ```sh
  /usr/bin/python3 -m venv ~/.oci/venv && ~/.oci/venv/bin/pip install oci-cli   # Oracle's CLI
  # Console → profile → API keys → Add API key; save the config preview as ~/.oci/config
  caffeinate -i bash deploy/oracle/grab-vm.sh     # tries 2 OCPU/12 GB, then 1 OCPU/6 GB, every minute
  ```
  It creates the network if needed and prints `PUBLIC_IP=` when the VM is up.
- **Idle reclamation**: Oracle may reclaim Always Free VMs that stay nearly idle for 7 days.
- Both go away if you **upgrade to Pay As You Go** (needs a card; anything inside Always Free stays $0). Add a budget alert at the same time.

### Ship the bot from your Mac

One command copies the code and `.env` to the VM, installs Docker the first time, builds and
starts the bot. The server never needs access to GitHub.

```sh
cd ~/notetaker
sh deploy/oracle/deploy.sh ubuntu@<vm-ip>    # first ARM build takes ~10 minutes
```

It uses `~/.ssh/oracle_notetaker` if that key exists (or `SSH_KEY=/path/to/key`). Run the same
command again after every change: it replaces the code on the server, applies database changes
and restarts the bot. The signed-in Google profile and unsent recordings live in a Docker volume,
so they survive.

Within 30 seconds the dashboard's **Bot server** step turns green (`oracle-1`). From then on
your laptop can be off.

### Sign the bot into Google (one time)

On your Mac, open a tunnel and start the login browser:

```sh
ssh -L 5900:127.0.0.1:5900 ubuntu@<vm-ip>
cd ~/notetaker/deploy/oracle
docker compose --profile login run --rm --service-ports login
```

View it: Finder → **Go → Connect to Server** → `vnc://localhost:5900` (no password). Sign in as
the bot account. When the Meet home page appears, press **Ctrl+C**. You'll see `Saved.`

## 4. Connect the bot

Sign in at https://notetaker-nu-lac.vercel.app as an admin → **Connect bot account** → choose the
bot account → allow Calendar, Gmail and **Google Drive**. Then invite the bot's email to a Meet
starting in a couple of minutes.

**Only one worker per database.** If you also run `pnpm dev:worker` on your Mac, it competes
with the VM for meetings. That's safe, but confusing. Stop one of them.

## Everyday commands

Update the bot from the Mac: `sh deploy/oracle/deploy.sh ubuntu@<vm-ip>` (also applies database changes and a changed `.env`).

On the VM, in `~/notetaker/deploy/oracle`:

| Task | Command |
|---|---|
| Logs | `docker compose logs -f worker` |
| Restart | `docker compose restart worker` |
| Stop | `docker compose down` (sign-in and pending recordings are kept) |

Website: `vercel deploy --prod` (or push, once Git is connected). After changing website
settings in `.env`, run `sh deploy/vercel-env.sh` first.

## Recordings

- Saved as WebM in the bot's Drive, folder **Notetaker recordings**, and shared view-only
  (no email) with whoever invited the bot.
- Watch it on the meeting page: the website streams it from Drive with the bot's token, so it
  plays for anyone who can see the meeting, without Drive access. Past meetings with a
  recording show **▶ Recording** on the dashboard.
- `RECORDING=video` is about 300 MB per meeting-hour; `audio` about 30 MB; `off` disables it.
- Failed uploads stay on the VM and are retried every 10 minutes.

## Staying inside free quotas

- **Gemini**: live notes use `gemini-2.5-flash-lite` every 2 minutes (~30 calls per meeting-hour). If the worker logs show `429`, raise `LIVE_NOTES_INTERVAL_SECONDS`.
- **Supabase**: 500 MB holds years of transcripts. Recordings don't count; they're in Drive.
- **AssemblyAI** is the one metered piece. Watch the credit in its dashboard.

## Troubleshooting

- **`redirect_uri_mismatch`**: the two URIs in step 2 must be on the OAuth client exactly.
- **Website 500 errors**: `vercel logs notetaker-nu-lac.vercel.app`. Usually a missing env var; re-run `deploy/vercel-env.sh` and redeploy.
- **`calendar sync failed ... invalid_grant`**: reconnect the bot from the dashboard.
- **`recording upload failed ... insufficient`**: reconnect the bot and tick Google Drive.
- **Transcript stays empty**: `docker compose logs worker | grep -E "tab capture|unmuted|audio"`.
