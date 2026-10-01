# Deploying the bot (worker) on AWS EC2

The website already runs on Vercel and the database on Neon. This guide puts the
**meeting bot** on one always-on EC2 server. About 20 minutes.

You need:
- The `.env` file. Kushagra sends it to you privately; it is **not** in this repo, and must never be committed.
- The bot account's Google password (`notetaker@syncup.in`) for a one-time sign-in in step 5.

## 1. Launch the server

AWS Console → EC2 → **Launch instance**:

| Setting | Value |
|---|---|
| Name | `notetaker-bot` |
| AMI | **Ubuntu Server 24.04 LTS** (x86_64) |
| Instance type | **t3.medium** (2–3 meetings at once). Use t3.large for more. |
| Key pair | Create or choose one; you'll SSH with it |
| Network | Default VPC is fine. Security group: allow **inbound SSH (22) from your IP only**. No other inbound ports. |
| Storage | **30 GB** gp3 |
| Region | **ap-south-1 (Mumbai)** |

## 2. Install Docker

```sh
ssh -i your-key.pem ubuntu@<server-public-ip>
curl -fsSL https://raw.githubusercontent.com/Guylikeisaac/notetaker/main/deploy/aws/setup.sh | sh
exit   # log out and back in so docker works without sudo
```

## 3. Get the code and the secrets

```sh
ssh -i your-key.pem ubuntu@<server-public-ip>
git clone https://github.com/Guylikeisaac/notetaker.git
cd notetaker
```

Copy the `.env` file into `~/notetaker/.env`. From your own computer:

```sh
scp -i your-key.pem .env ubuntu@<server-public-ip>:~/notetaker/.env
```

On the server: `chmod 600 ~/notetaker/.env`

## 4. Build

```sh
cd ~/notetaker/deploy/aws
docker compose build
```

## 5. Sign the bot into Google (one time)

Google needs a real sign-in once. The bot's browser runs on a virtual screen that you view through an SSH tunnel.

**Terminal 1** (your computer). Open the tunnel and keep it open:
```sh
ssh -i your-key.pem -L 5900:127.0.0.1:5900 ubuntu@<server-public-ip>
cd ~/notetaker/deploy/aws
docker compose --profile login run --rm --service-ports login
```

**Then view the screen:**
- macOS: Finder → **Go → Connect to Server** → `vnc://localhost:5900`. If it asks for a password, leave it empty or use any value.
- Windows/Linux: any VNC viewer (RealVNC, TigerVNC) → `localhost:5900`.

Sign in as `notetaker@syncup.in`. Approve any "Is it you?" check. Once you see the Google Meet home page, go back to **Terminal 1** and press **Ctrl+C**. You'll see `Saved.` The sign-in is stored in the `bot-data` Docker volume.

## 6. Start the bot

```sh
cd ~/notetaker/deploy/aws
docker compose up -d
docker compose logs -f worker     # Ctrl+C to stop watching; the bot keeps running
```

You should see `"worker starting"`, and within a minute no `"calendar sync failed"` errors.
It restarts by itself after crashes and server reboots.

**Tell Kushagra to stop the worker on his Mac** once this is running.

## Everyday commands

| Task | Command (in `~/notetaker/deploy/aws`) |
|---|---|
| Watch logs | `docker compose logs -f worker` |
| Update to the latest code | `git pull && docker compose up -d --build` |
| Restart | `docker compose restart worker` |
| Stop | `docker compose down` (the sign-in is kept) |
| Re-do Google sign-in | repeat step 5 |

## Troubleshooting

- **`calendar sync failed ... invalid_grant`**: the bot's Google connection expired. An admin re-connects it from the website dashboard (Disconnect → Connect bot account).
- **The bot joins but the transcript stays empty**: run `docker compose logs worker | grep -E "tab capture|unmuted|audio"` and send the output to Kushagra.
- **Google blocks the sign-in**: in the Google Workspace admin console, check that `notetaker@syncup.in` isn't restricted, then retry step 5.
