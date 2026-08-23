# 🚀 Команды для запуска системы

## 📋 Оглавление
1. [Автоматический запуск (рекомендуется)](#автоматический-запуск)
2. [Ручной запуск](#ручной-запуск)
3. [Проверка статуса](#проверка-статуса)
4. [Остановка](#остановка)

---

## 🔄 Автоматический запуск

### Windows PowerShell (рекомендуется)

Откройте **PowerShell как Администратор** и выполните:

```powershell
# Запустить OpenClaw Gateway
Start-ScheduledTask -TaskName "OpenClaw Gateway"

# Запустить China Cargo Bot
Start-Process -FilePath "node" -ArgumentList "bot.js" -WorkingDirectory "C:\Users\Murodjon Nuritdinov\Documents\china-cargo-bot" -WindowStyle Hidden

# Запустить ngrok туннель
Start-Process -FilePath "ngrok.exe" -ArgumentList "http", "3000" -WindowStyle Hidden

# Проверить что все работает
Start-Sleep -Seconds 3
Get-Process node
```

**Или все в одной команде:**

```powershell
Start-ScheduledTask -TaskName "OpenClaw Gateway"; `
Start-Process -FilePath "node" -ArgumentList "bot.js" -WorkingDirectory "C:\Users\Murodjon Nuritdinov\Documents\china-cargo-bot" -WindowStyle Hidden; `
Start-Process -FilePath "ngrok.exe" -ArgumentList "http", "3000" -WindowStyle Hidden; `
Start-Sleep -Seconds 3; `
Write-Host "✅ OpenClaw Gateway запущен"; `
Write-Host "✅ China Cargo Bot запущен"; `
Write-Host "✅ Ngrok туннель запущен"
```

---

## 🔧 Ручной запуск

### 1️⃣ OpenClaw Gateway

```powershell
Start-ScheduledTask -TaskName "OpenClaw Gateway"
```

Или через командную строку:

```cmd
schtasks /run /tn "OpenClaw Gateway"
```

### 2️⃣ China Cargo Bot

**Вариант A: В фоне (скрытое окно)**
```powershell
Start-Process -FilePath "node" `
  -ArgumentList "bot.js" `
  -WorkingDirectory "C:\Users\Murodjon Nuritdinov\Documents\china-cargo-bot" `
  -WindowStyle Hidden
```

**Вариант B: В терминале (с логами)**
```powershell
cd "C:\Users\Murodjon Nuritdinov\Documents\china-cargo-bot"
node bot.js
```

### 3️⃣ Ngrok туннель

**Вариант A: В фоне**
```powershell
Start-Process -FilePath "ngrok.exe" -ArgumentList "http", "3000" -WindowStyle Hidden
```

**Вариант B: В терминале (видны логи)**
```bash
ngrok http 3000
```

---

## 🔍 Проверка статуса

### Проверить процессы

```powershell
# Все процессы Node.js
Get-Process node | Select-Object ProcessName, Id, Handles

# OpenClaw Gateway статус
Get-ScheduledTask -TaskName "OpenClaw Gateway" | Select-Object TaskName, State, Author

# OpenClaw Gateway информация о последнем запуске
Get-ScheduledTaskInfo -TaskName "OpenClaw Gateway"
```

### Проверить порты

```powershell
# Все слушающие порты
netstat -ano | Select-String "LISTENING"

# Только наши порты
netstat -ano | Select-String "3000|4040|18789"
```

### Проверить здоровье сервисов

```powershell
# China Cargo Bot webhook
Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing

# Ngrok статус
Invoke-WebRequest -Uri "http://localhost:4040/api/tunnels" -UseBasicParsing | ConvertFrom-Json
```

---

## ⛔ Остановка

### Остановить все сервисы

```powershell
# Остановить OpenClaw Gateway
Stop-ScheduledTask -TaskName "OpenClaw Gateway"

# Остановить China Cargo Bot
Stop-Process -Name node -Force

# Остановить ngrok
Get-Process ngrok | Stop-Process -Force
```

### Остановить конкретный сервис

```powershell
# Только OpenClaw
Stop-ScheduledTask -TaskName "OpenClaw Gateway"

# Только China Cargo Bot (сохранит ngrok)
Get-Process node | Where-Object {$_.Id -eq 17748} | Stop-Process -Force

# Только ngrok
Get-Process ngrok | Stop-Process -Force
```

---

## 📊 Полный цикл жизни

### Запуск всей системы

```powershell
Write-Host "🚀 Запуск системы..."

# 1. OpenClaw
Start-ScheduledTask -TaskName "OpenClaw Gateway"
Write-Host "✅ OpenClaw Gateway запущен"

# 2. China Cargo Bot
Start-Process -FilePath "node" `
  -ArgumentList "bot.js" `
  -WorkingDirectory "C:\Users\Murodjon Nuritdinov\Documents\china-cargo-bot" `
  -WindowStyle Hidden
Write-Host "✅ China Cargo Bot запущен"

# 3. Ngrok
Start-Process -FilePath "ngrok.exe" -ArgumentList "http", "3000" -WindowStyle Hidden
Start-Sleep -Seconds 3
Write-Host "✅ Ngrok туннель запущен"

# 4. Проверка
Write-Host "`n🔍 Проверка статуса..."
Get-Process node | Select-Object ProcessName, Id

Write-Host "`n✨ Система полностью запущена!"
Write-Host "📱 Telegram Bot: готов к использованию"
Write-Host "🌐 Webhook: http://localhost:3000"
Write-Host "🪐 Ngrok: https://app.ngrok.com (проверьте URL в консоли ngrok)"
```

### Остановка и перезагрузка

```powershell
Write-Host "⛔ Остановка системы..."

Stop-ScheduledTask -TaskName "OpenClaw Gateway"
Write-Host "✅ OpenClaw Gateway остановлен"

Get-Process node | Stop-Process -Force
Write-Host "✅ China Cargo Bot остановлен"

Get-Process ngrok | Stop-Process -Force
Write-Host "✅ Ngrok остановлен"

Start-Sleep -Seconds 2

Write-Host "`n🔄 Перезагрузка..."
# Теперь можно запустить все заново с командами выше
```

---

## 🎯 Типичные сценарии

### Сценарий 1: Первый запуск дня

```powershell
# Просто перезагрузите компьютер или выполните:
Start-ScheduledTask -TaskName "OpenClaw Gateway"
Start-Process -FilePath "node" -ArgumentList "bot.js" -WorkingDirectory "C:\Users\Murodjon Nuritdinov\Documents\china-cargo-bot" -WindowStyle Hidden
Start-Process -FilePath "ngrok.exe" -ArgumentList "http", "3000" -WindowStyle Hidden
```

### Сценарий 2: Перезагрузить только China Cargo Bot

```powershell
# Если нужно перезагрузить бот (например, после обновления кода)
Get-Process node | Where-Object {(Get-Process -Id $_.Id).CommandLine -like "*bot.js*"} | Stop-Process -Force
Start-Sleep -Seconds 2
Start-Process -FilePath "node" -ArgumentList "bot.js" -WorkingDirectory "C:\Users\Murodjon Nuritdinov\Documents\china-cargo-bot" -WindowStyle Hidden
```

### Сценарий 3: Перезагрузить ngrok (новый URL)

```powershell
Get-Process ngrok | Stop-Process -Force
Start-Sleep -Seconds 2
Start-Process -FilePath "ngrok.exe" -ArgumentList "http", "3000" -WindowStyle Hidden
Start-Sleep -Seconds 3

# Получить новый URL
Invoke-WebRequest -Uri "http://localhost:4040/api/tunnels" -UseBasicParsing | ConvertFrom-Json | Select-Object -ExpandProperty tunnels | Select-Object public_url
```

---

## 🔗 Полезные ссылки

- **OpenClaw Gateway:** `schtasks /query /tn "OpenClaw Gateway"`
- **China Cargo Bot логи:** `C:\Users\Murodjon Nuritdinov\Documents\china-cargo-bot\logs\`
- **Google Sheets:** https://docs.google.com/spreadsheets/d/1YIxV5P9_3ETtf4IDvl5KtMOGrmW4CQBGFav0k9Ba0QQ
- **Ngrok Dashboard:** http://localhost:4040

---

## 💡 Советы

1. **Автозапуск при перезагрузке компьютера:**
   - OpenClaw Gateway уже настроен в Task Scheduler с LogonTrigger
   - China Cargo Bot можно добавить аналогично через `deploy/install-task.ps1`

2. **Логирование:**
   - Откройте PowerShell с логами вместо скрытого окна для отладки
   - Проверьте `logs/` директорию для исторических логов

3. **Ngrok URL меняется:**
   - Если перезагрузить ngrok, URL изменится
   - Обновите `WEBHOOK_URL` в Google Apps Script на новый URL
   - Или используйте платный план ngrok для постоянного URL

---

**Готово!** 🎉 Система полностью работает.
