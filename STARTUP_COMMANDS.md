# Startup and recovery

Legacy Task Scheduler scripts are no longer used. Docker Compose owns the bot, database, tunnel and backups.

```powershell
docker compose up -d
docker compose ps
docker compose logs --tail 200 bot
```

Enable **Docker Desktop → Settings → General → Start Docker Desktop when you sign in**. Use a dedicated Windows account for this PC and test a complete Windows restart before production.

Install the Task Scheduler entry from an elevated PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\install-autostart.ps1
```

The task is named `China Cargo Docker Stack`. It starts at user logon, launches Docker Desktop when needed, waits for the Linux engine and runs `docker compose up -d`. Startup diagnostics are written to `logs/startup.log`.
