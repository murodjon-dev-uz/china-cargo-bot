# Real-Time Google Sheets Webhook Setup

Это настроит **real-time синхронизацию**: когда менеджер пишет статус в Google Sheets, БД обновляется **сразу же**.

## Что происходит:

```
1. Менеджер пишет в Google Sheets
   ↓
2. Apps Script срабатывает (onEdit trigger)
   ↓
3. Отправляет webhook на наш сервер
   ↓
4. Сервер БД обновляется СРАЗУ (не ждёт 02:30)
   ↓
5. Клиент видит обновление в "Мои заявки" (или в дайджесте 09:00)
```

---

## Шаг 1: Запустить бот (он слушает на localhost:3000)

```bash
cd "C:\Users\Murodjon Nuritdinov\Documents\china-cargo-bot"
node bot.js
```

Логи должны показать:
```
[INFO] Webhook server listening on port 3000
[INFO] China Cargo bot: launched (long polling)
```

---

## Шаг 2: Установить и запустить ngrok (туннель для локального сервера)

ngrok позволяет Google Sheets подключиться к вашему localhost.

### Установить ngrok:
1. Скачать: https://ngrok.com/download
2. Распаковать куда-нибудь
3. Запустить в PowerShell:

```powershell
cd "путь/к/ngrok"
.\ngrok.exe http 3000
```

Вы увидите:
```
ngrok by @inconshrevable
Forwarding    https://1234abcd-5678.ngrok.io -> http://localhost:3000
```

**Скопируйте** этот URL: `https://1234abcd-5678.ngrok.io`

---

## Шаг 3: Установить Apps Script в Google Sheets

1. Откройте вашу таблицу: https://docs.google.com/spreadsheets/d/1YIxV5P9_3ETtf4IDvl5KtMOGrmW4CQBGFav0k9Ba0QQ

2. Перейдите: **Extensions → Apps Script**

3. Удалите весь текст и вставьте код из `deploy/google-apps-script.gs`

4. В коде найдите строку:
   ```javascript
   const WEBHOOK_URL = 'http://localhost:3000/webhook/tracking-update';
   ```
   
   Замените на ваш ngrok URL:
   ```javascript
   const WEBHOOK_URL = 'https://1234abcd-5678.ngrok.io/webhook/tracking-update';
   ```

5. Нажмите **Ctrl+S** (Save)

6. В левом меню нажмите **Deployments** → **Deploy** → **New deployment**
   - Type: **Web app**
   - Execute as: **your@email.com**
   - Who has access: **Me**
   - Deploy

---

## Шаг 4: Включить автосинхронизацию в Google Sheets

1. Вернитесь на лист (вкладка с таблицей)
2. Нажмите меню **China Cargo** → **Enable auto-sync**
3. Разрешите доступ когда будет запрашиваться

✅ **Готово!** Теперь когда вы пишете в "Трекинг" лист, БД обновляется сразу.

---

## Тест

1. Откройте "Трекинг" лист
2. Добавьте новый статус для CL-001:
   - Cargo ID: `CL-001`
   - Status 1: `Груз на границе, ожидает таможни`
   - Date 1: `2026-08-25`

3. Проверьте логи в боте — должно быть:
   ```
   [INFO] webhook: status updated CL-001 AT_BORDER
   ```

4. Откройте бота в Telegram (как клиент) → нажмите "Мои заявки" → CL-001 должен показать новый статус

---

## Для production (Cloud Run)

Потом (когда ngrok надоест) развернём микросервис на **Google Cloud Run**:
- Будет работать 24/7 (не зависит от вашего ноутбука)
- URL будет постоянный (не меняется как в ngrok)
- Бесплатный (в пределах лимитов Google)

Напишите когда готовы к этому шагу.
