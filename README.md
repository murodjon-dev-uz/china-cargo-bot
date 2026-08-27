# China Cargo Bot

Production-oriented Telegram tracking service for an office PC running Windows, WSL2 and Docker Desktop.

## Stack

- Node.js 24, Telegraf and Express
- PostgreSQL 17
- Docker Compose
- ngrok with a reserved domain
- Google Sheets + Apps Script webhook
- Daily PostgreSQL backups

## Prerequisites

1. Docker Desktop is running with WSL2.
2. Put `service-account.json` in the repository root (never commit it).
3. Copy `.env.example` to `.env` and fill every secret.
4. Reserve an ngrok domain and set `NGROK_DOMAIN` and `NGROK_AUTHTOKEN`.

## Start

```powershell
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs -f bot
```

## Google Apps Script

Copy `deploy/google-apps-script.gs` into the spreadsheet's Apps Script project. In **Project Settings → Script properties**, set:

- `WEBHOOK_BASE_URL=https://<NGROK_DOMAIN>`
- `WEBHOOK_SECRET` to the same value as `.env`

Run `onOpen`, return to the sheet and choose **China Cargo → Enable auto-sync**.

## Client registration

Clients register with `/start`, enter their name and share their own Telegram Contact. The bot verifies that the contact belongs to the sender and links orders exclusively by the normalized value in the `Телефон` column. Telegram usernames are neither stored nor used. One phone number can belong to only one Telegram account; conflicts are sent to the manager group for manual review.

## Operations

```powershell
docker compose ps
docker compose logs --tail 200 bot
docker compose restart bot
docker compose pull
docker compose up -d --build
```

Containers use `restart: unless-stopped`. Docker Desktop must start when the Windows service account signs in.

## Backups

The `backup` service creates a PostgreSQL custom-format dump every 24 hours in `./backups` and removes local copies older than `BACKUP_RETENTION_DAYS`. Copy backups to storage outside this PC and test restoration regularly.

## Security

- Never commit `.env`, `service-account.json`, database dumps or logs.
- PostgreSQL stays on the private Compose network and exposes no host port.
- Rotate Telegram, Google, webhook and ngrok credentials after suspected exposure.
- Only `/health` is unauthenticated; webhook routes require the shared secret and are rate-limited.

## Verification before production

1. Restart Windows.
2. Confirm Docker and all four containers return automatically.
3. Test local and public `/health`.
4. Edit a test row in Google Sheets.
5. Verify the Telegram status and morning digest.
6. Stop the bot container and confirm it restarts.
7. Restore a backup into a temporary database.
