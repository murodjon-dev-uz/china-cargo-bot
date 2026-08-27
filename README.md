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

## Shipment fields

`Заявки` carries the particulars clients ask about: `Откуда`, `Куда`, `Вес (кг)`, `Объём (м³)`, `Мест`, `Цена`, `Валюта`. Numbers are read as typed — `1 250,5`, `1,250.50` and `12 кг` all parse — and rendered back grouped, with trailing zeros dropped. `Route` stays as a legacy free-text field, shown only when `Откуда`/`Куда` are empty.

## Payments

`Оплаты` is a ledger: one row per payment, several rows per `Cargo ID` — columns `Cargo ID`, `Дата`, `Сумма`, `Валюта`, `Примечание`. Clients and managers see the running total against the order's price: paid, and what is left. Every order read carries its payment total, so the card, the client list and the overview totals can never disagree.

Overpayment on one order never cancels a debt on another: each order's remainder is floored at zero before the totals are added up.

Create the tab with **China Cargo → Setup "Оплаты" sheet**.

## Status dropdown

Every `Status N` column on `Трекинг` offers a dropdown backed by the hidden `Статусы` sheet, seeded with the twenty most common wordings. The list is a shortcut, never a restriction: anything typed by hand is accepted **and appended to the list**, so the next person finds it already there. Set it up with **China Cargo → Setup status dropdown**.

## Google Apps Script

Copy `deploy/google-apps-script.gs` into the spreadsheet's Apps Script project. In **Project Settings → Script properties**, set:

- `WEBHOOK_BASE_URL=https://<NGROK_DOMAIN>`
- `WEBHOOK_SECRET` to the same value as `.env`

Run `onOpen`, return to the sheet and choose **China Cargo → Enable auto-sync**.

## Access lists and login

The bot is closed. A phone number must already be listed on the **`Контакты`** tab (clients) or the **`Менеджеры`** tab (managers) before its owner can use the bot at all. There is no list of Telegram IDs anywhere: which tab a number sits on is the only thing that decides its role, and managers confirm their phone exactly like clients do.

| Column | Filled by |
| --- | --- |
| `Имя клиента` | manager, by hand |
| `Номер телефона` | manager, by hand |
| `Статус` | the sync layer (`Вошёл` once the client logs in) |
| `Дата входа` | the sync layer |

`/start` asks for the phone immediately — there is no name step, the name comes from the sheet. The client taps the button and Telegram sends the number of the account itself; a forwarded contact card is rejected, because only the sender's own contact carries a `user_id` equal to theirs.

If the number is on the list, the client is in. If it is not, the bot refuses and nothing else in the bot is reachable. Delete a row and access is revoked on that client's next message: authorization is a live JOIN against the mirrored list, not a flag stored at registration time.

Orders are linked to clients exclusively by the normalized value in the `Телефон` column of `Заявки`. Telegram usernames are neither stored nor used. One phone number can belong to only one Telegram account; conflicts are sent to the manager group for manual review.

The bot process itself never calls Google. The access list reaches it only through Postgres — filled by the Apps Script webhook on every edit, or by `npm run sync`.

Both tabs have the same four columns. To create them, use **China Cargo → Setup "Контакты" sheet** and **Setup "Менеджеры" sheet** in the spreadsheet menu.

Each tab reconciles only its own role, so syncing the client list can never revoke a manager.

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
