# Hosting everything free on Oracle Cloud

One Oracle **Always Free** VM runs the whole product:

| Piece | Runs as | Cost |
|---|---|---|
| Website (Next.js) | `web` container behind **Caddy** with a free Let's Encrypt certificate | free |
| Database | `db` container (Postgres 17) + `backup` (daily dump, 14 kept) | free |
| Meeting bot | `worker` container (Chrome on a virtual screen) | free |
| Recordings | the bot account's Google Drive | free (Drive storage) |
| Live notes + report | Gemini API free tier | free, within its daily quota |
| Speech-to-text | AssemblyAI streaming | free signup credit (hundreds of meeting hours), then about $0.15 per hour |
| Google sign-in | OAuth consent screen set to **Internal** | free, no Google review |

About 45 minutes the first time.

## 1. Google Cloud (OAuth client)

In [console.cloud.google.com](https://console.cloud.google.com), signed in with a **syncup.in** account:

1. Create a project, e.g. `notetaker`.
2. **APIs & Services → Library**: enable **Google Calendar API**, **Gmail API** and **Google Drive API**.
3. **OAuth consent screen**: User type **Internal**. Internal apps only accept syncup.in accounts and need no Google verification, even for the Gmail scope.
4. **Credentials → Create credentials → OAuth client ID → Web application.** Add the redirect URIs later, in step 5, once you know the domain. Keep the client ID and secret.

API keys:
- **Gemini**: [aistudio.google.com](https://aistudio.google.com) → Get API key (free tier).
- **AssemblyAI**: [assemblyai.com](https://www.assemblyai.com) → sign up → API key.

## 2. Create the VM

Oracle Cloud console → **Compute → Instances → Create instance**:

| Setting | Value |
|---|---|
| Name | `notetaker` |
| Image | **Canonical Ubuntu 24.04** (aarch64) |
| Shape | **VM.Standard.A1.Flex**: **4 OCPU, 24 GB** (the entire free allowance; handles 4–6 meetings at once with recording) |
| Networking | Public subnet, **Assign a public IPv4 address** on |
| SSH keys | Upload your public key |
| Boot volume | **100 GB** (free up to 200 GB in total) |

Then open the web ports in Oracle's firewall: open the instance's **subnet → Security list → Add ingress rules**. Source `0.0.0.0/0`, TCP, destination ports **80** and **443**.

Two things to know:
- **"Out of capacity"** for A1 is common. Retry later, try another availability domain, or upgrade to Pay As You Go (below).
- **Idle reclamation**: Oracle can reclaim Always Free VMs that stay almost idle for 7 days. A bot between meetings can look idle.

**Recommended: upgrade the account to Pay As You Go** (Billing → Upgrade). It needs a card, but anything inside the Always Free limits stays at $0. It removes idle reclamation and makes A1 capacity much easier to get. Add a budget alert (Billing → Budgets, e.g. ₹100) to catch surprises.

## 3. A domain for the website

Either:
- **Your own subdomain (recommended)**: add a DNS **A record** such as `notes.syncup.in` pointing to the VM's public IP, or
- **No DNS access**: use `<ip-with-dashes>.sslip.io`, e.g. `140-238-1-2.sslip.io`. It resolves to your IP automatically. `init-env.sh` suggests it.

## 4. Server setup

The repo is private, so give the server a read-only **deploy key**:

```sh
ssh ubuntu@<public-ip>
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
```

Add the printed key at GitHub → `ayushsyncup/notetaker` → **Settings → Deploy keys** (read-only). Then:

```sh
git clone git@github.com:ayushsyncup/notetaker.git
sh ~/notetaker/deploy/oracle/setup.sh   # Docker + opens 80/443 in the VM firewall
exit                                    # log out and back in so docker works without sudo
```

## 5. Settings

```sh
ssh ubuntu@<public-ip>
cd ~/notetaker/deploy/oracle
./init-env.sh
```

It asks for the domain, admin emails, bot account, Google client, and API keys. It generates every password and secret itself and writes `~/notetaker/.env` (readable only by you).

It prints two redirect URIs at the end. Add both to the OAuth client from step 1 (**Credentials → your client → Authorized redirect URIs**).

## 6. Start

```sh
docker compose up -d --build     # first ARM build takes ~10 minutes
docker compose ps                # everything "running"; migrate "exited (0)"
docker compose logs -f worker    # Ctrl+C stops watching
```

Open `https://<your domain>`. Caddy gets the HTTPS certificate on the first visit, which takes a few seconds.

## 7. Sign the bot into Google (one time)

**On your computer**, open a tunnel and start the login browser:
```sh
ssh -L 5900:127.0.0.1:5900 ubuntu@<public-ip>
cd ~/notetaker/deploy/oracle
docker compose --profile login run --rm --service-ports login
```

View it: macOS Finder → **Go → Connect to Server** → `vnc://localhost:5900` (no password).
Sign in as the bot account. When the Meet home page appears, press **Ctrl+C**. You'll see `Saved.`

## 8. Connect the bot

Sign in to the website as an admin → **Connect bot account** → choose the bot
account → allow Calendar, Gmail and **Google Drive**.

To test it, invite the bot's email to a Meet event starting in a couple of minutes.

## Everyday commands

Run these in `~/notetaker/deploy/oracle`:

| Task | Command |
|---|---|
| Logs | `docker compose logs -f worker` (or `web`, `caddy`, `db`) |
| Update to the latest code | `git pull && docker compose up -d --build` |
| Restart the bot | `docker compose restart worker` |
| Stop everything | `docker compose down` (data is kept in volumes) |
| Copy backups to the VM | `docker compose cp backup:/backups ./backups` |
| Restore a backup | `gunzip -c backups/<file>.sql.gz \| docker compose exec -T db psql -U notetaker notetaker` |
| Disk | `df -h /` and `docker system df` |

Copy backups off the VM now and then (`scp -r ubuntu@<ip>:notetaker/deploy/oracle/backups .`). They live on the same disk as the database.

## Recordings

- Saved as WebM in the bot's Drive, folder **Notetaker recordings**, and shared
  view-only (no email) with whoever invited the bot. The meeting page links to it.
- `RECORDING=video` is about 300 MB per meeting-hour; `audio` about 30 MB; `off` disables it.
- A Workspace bot account uses the pooled storage; a Gmail bot account gets 15 GB.
- Failed uploads stay in the `bot-data` volume and are retried every 10 minutes.

## Staying inside free quotas

- **Gemini**: `init-env.sh` sets live notes to `gemini-2.5-flash-lite` every 2 minutes
  (~30 calls per meeting-hour). Final reports use `gemini-2.5-flash`. If you see
  `429` in the worker logs, raise `LIVE_NOTES_INTERVAL_SECONDS` in `.env`, then run `docker compose up -d`.
- **AssemblyAI** is the one metered piece. Watch the credit in its dashboard.

## Troubleshooting

- **Site doesn't load / no certificate**: check that ports 80 and 443 are open in the Oracle security list (step 2) and the DNS record points at the VM. Then check `docker compose logs caddy`.
- **`redirect_uri_mismatch`** on sign-in: the URIs on the OAuth client must exactly match the ones `init-env.sh` printed.
- **`calendar sync failed ... invalid_grant`**: reconnect the bot from the dashboard.
- **`recording upload failed ... insufficient`**: the bot was connected without Drive access. Reconnect it and tick Drive.
- **Transcript stays empty**: `docker compose logs worker | grep -E "tab capture|unmuted|audio"`.
