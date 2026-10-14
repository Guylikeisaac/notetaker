# Deploying the bot (worker) on Oracle Cloud Always Free

Runs the **meeting bot** on a free Ampere (ARM) VM. The website can stay on
Vercel, or run on the same VM behind ngrok (see the end). About 30 minutes.

You need:
- The `.env` file. It is **not** in this repo, and must never be committed.
- The bot account's Google password (`notetaker@syncup.in`) for a one-time sign-in in step 5.

## 1. Create the VM

Oracle Cloud console → **Compute → Instances → Create instance**:

| Setting | Value |
|---|---|
| Name | `notetaker-bot` |
| Image | **Canonical Ubuntu 24.04** (pick the aarch64 build, the default for Ampere) |
| Shape | **VM.Standard.A1.Flex**: **2 OCPU, 12 GB RAM** (comfortably 4–6 meetings at once with recording). The free allowance is 4 OCPU / 24 GB in total. |
| Networking | Default VCN with a public subnet, **Assign a public IPv4 address** on |
| SSH keys | Upload your public key, or download the generated private key |
| Boot volume | **100 GB** (free up to 200 GB in total). Recordings are staged here until they reach Drive. |

No inbound ports are needed besides SSH (22), which the default security list already allows.

**"Out of capacity" for A1?** Common in busy regions. Retry later, try another
availability domain, or upgrade the account to *Pay As You Go*. PAYG stays free
inside the Always Free limits and gets A1 capacity much more easily.

**Idle reclamation.** Oracle may reclaim Always Free VMs that stay nearly idle
(under 20% CPU, network, and memory) for 7 days. A bot that only wakes for
meetings can look idle. Upgrading to PAYG stops reclamation and the VM still
costs nothing.

## 2. Install Docker

```sh
ssh -i your-key ubuntu@<public-ip>
curl -fsSL https://raw.githubusercontent.com/Guylikeisaac/notetaker/main/deploy/aws/setup.sh | sh
exit   # log out and back in so docker works without sudo
```

(The script is shared with the AWS guide and works on ARM too.)

## 3. Get the code and the secrets

```sh
ssh -i your-key ubuntu@<public-ip>
git clone https://github.com/Guylikeisaac/notetaker.git
```

From your own computer:

```sh
scp -i your-key .env ubuntu@<public-ip>:~/notetaker/.env
```

On the server: `chmod 600 ~/notetaker/.env`

## 4. Build

```sh
cd ~/notetaker/deploy/oracle
docker compose build
```

The first build on ARM takes 5–10 minutes.

## 5. Sign the bot into Google (one time)

**Terminal 1** (your computer). Open a tunnel and start the login browser:
```sh
ssh -i your-key -L 5900:127.0.0.1:5900 ubuntu@<public-ip>
cd ~/notetaker/deploy/oracle
docker compose --profile login run --rm --service-ports login
```

**View the screen:** macOS Finder → **Go → Connect to Server** → `vnc://localhost:5900`
(leave the password empty). On Windows or Linux, use any VNC viewer at `localhost:5900`.

Sign in as `notetaker@syncup.in` and approve any "Is it you?" check. When the
Google Meet home page shows, press **Ctrl+C** in Terminal 1. You'll see `Saved.`

## 6. Reconnect the bot for Google Drive (one time, after the recording update)

Recordings go to the bot account's Google Drive, which needs the `drive.file`
permission. An admin opens the website dashboard → **Disconnect** → **Connect bot
account**, and ticks the Google Drive box on the consent screen.

Until then, meetings still get transcripts and notes. Each recording waits on the
server and the page says *"Google Drive access is missing"*. After the reconnect,
the waiting recordings upload within 10 minutes.

## 7. Start the bot

```sh
cd ~/notetaker/deploy/oracle
docker compose up -d
docker compose logs -f worker     # Ctrl+C stops watching; the bot keeps running
```

Expect `"worker starting"`, and no `"calendar sync failed"` within a minute.

**Only one worker per database.** Stop any other worker (a laptop, the AWS box)
pointed at the same `DATABASE_URL` with a different `WORKER_ID`, or both will
compete for meetings. This is safe, but confusing.

## Recordings

- Saved as WebM in the bot's Drive, folder **Notetaker recordings**, and shared
  (view-only, no email) with whoever invited the bot. The meeting page links to it.
- `RECORDING=video` (default) records the Meet tab at 720p, ~300 MB per hour.
  `RECORDING=audio` records ~30 MB per hour. `RECORDING=off` disables recording.
- The bot account's Drive storage is the limit. A Workspace account gets the
  pooled storage; a free Gmail account gets 15 GB.
- Files that fail to upload stay in the `bot-data` volume and are retried every
  10 minutes.

## Everyday commands

| Task | Command (in `~/notetaker/deploy/oracle`) |
|---|---|
| Watch logs | `docker compose logs -f worker` |
| Update to the latest code | `git pull && docker compose up -d --build` |
| Restart | `docker compose restart worker` |
| Stop | `docker compose down` (sign-in and pending recordings are kept) |
| Disk usage | `df -h /` and `docker system df` |
| Re-do Google sign-in | repeat step 5 |

## Optional: website on the same VM

Add `NGROK_AUTHTOKEN` and `NGROK_DOMAIN` (a free static ngrok domain) to `.env`, and add
`https://<NGROK_DOMAIN>/api/auth/callback/google` and `https://<NGROK_DOMAIN>/api/bot/callback`
as redirect URIs on the Google OAuth client. Then:

```sh
docker compose --profile web up -d --build
```

## Troubleshooting

- **`calendar sync failed ... invalid_grant`**: the bot's Google connection expired. Reconnect it from the dashboard.
- **`recording upload failed ... insufficient`**: Drive permission missing. See step 6.
- **Transcript stays empty**: `docker compose logs worker | grep -E "tab capture|unmuted|audio"`.
