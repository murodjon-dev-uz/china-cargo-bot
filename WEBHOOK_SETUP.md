# Real-time Google Sheets webhook

The public webhook is provided by the `tunnel` container and protected by `WEBHOOK_SECRET`.

1. Reserve a static domain in ngrok.
2. Set `NGROK_AUTHTOKEN` and `NGROK_DOMAIN` in `.env`.
3. Start the stack with `docker compose up -d --build`.
4. Copy `deploy/google-apps-script.gs` to the spreadsheet's Apps Script project.
5. In Apps Script **Project Settings → Script properties**, create:
   - `WEBHOOK_BASE_URL=https://<your reserved domain>`
   - `WEBHOOK_SECRET=<the exact value from .env>`
6. Run `onOpen`, reload the spreadsheet and select **China Cargo → Enable auto-sync**.

Verify:

```powershell
Invoke-RestMethod "https://$env:NGROK_DOMAIN/health"
docker compose logs --tail 100 bot tunnel
```

Do not paste secrets directly into source code and do not use a changing free tunnel URL in production.
