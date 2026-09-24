# Amir & Nazi — چت خصوصی دونفره

یک وب‌اپلیکیشن فارسی، RTL و واکنش‌گرا با Next.js/TypeScript روی Vercel و Cloudflare Worker + D1 + R2 + Durable Objects. پروژه هیچ پیام، عکس، ویدیو، حساب آزمایشی یا اتاق اضافی ندارد. فقط دو حساب از پیش تعریف‌شده وجود دارند و رمز اولیه فقط به‌صورت PBKDF2-SHA256 با salt مستقل در Migration ذخیره شده است؛ مقدار متن سادهٔ رمز در سورس و ZIP وجود ندارد.

> نکته امنیتی: رمز اولیه طبق درخواست پروژه کوتاه است. بلافاصله بعد از اولین ورود، هر دو حساب باید از بخش «تنظیمات» رمز خود را تغییر دهند.

## معماری عملیاتی

Browser → Next.js روی Vercel → Route Handler/BFF → Cloudflare Worker → D1/R2. نشست اصلی در Cookie امن، HttpOnly، Secure و SameSite=Strict روی دامنهٔ اپ نگهداری می‌شود. Vercel توکن نشست را فقط در Route Handler سمت سرور به Worker می‌فرستد و `CHAT_WORKER_INTERNAL_SECRET` هرگز به مرورگر نمی‌رود.

WebSocket مستقیماً از مرورگر به Worker وصل می‌شود، اما به‌جای ارسال Cookie یا Session Token، Next.js/Worker یک Ticket کوتاه‌عمر و امضاشده صادر می‌کند. Ticket در WebSocket subprotocol ارسال می‌شود و در URL قرار نمی‌گیرد. Worker قبل از Upgrade اعتبار نشست D1 را دوباره بررسی می‌کند و اتصال را به Durable Object `CHAT_ROOM` می‌دهد. Durable Object از WebSocket Hibernation استفاده می‌کند.

رسانه‌ها خصوصی‌اند. مرورگر ابتدا از مسیر احرازشده مجوز کوتاه‌مدت می‌گیرد و سپس فایل را مستقیماً به Worker/R2 می‌فرستد. Worker Magic Bytes فایل را بررسی می‌کند. دریافت رسانه با URL امضاشدهٔ کوتاه‌عمر انجام می‌شود که همچنان به یک Session فعال در D1 وابسته است. ویدیو از HTTP Range پشتیبانی می‌کند.

## ساختار

- `apps/web` — Next.js App Router + TypeScript + UI فارسی
- `workers/chat-api` — Worker، Auth، Message API، Media API و Durable Object
- `workers/chat-api/migrations` — Migrationهای D1
- `wrangler.jsonc` — Bindingهای D1/R2/DO و Cron cleanup
- `env.example` — نمونه متغیرها، بدون Secret
- `docs/ARCHITECTURE.md` — معماری و Flowها
- `docs/DEPLOY_CLOUDFLARE.md` — راه‌اندازی Cloudflare
- `docs/DEPLOY_VERCEL.md` — راه‌اندازی Vercel
- `docs/SECURITY.md` — کنترل‌های امنیتی
- `docs/TEST_REPORT.md` — گزارش دقیق تست‌های انجام‌شده

## پیش‌نیاز

Node.js 22 یا جدیدتر، حساب Cloudflare با D1/R2/Workers، و حساب Vercel لازم است.

## نصب محلی

```bash
npm install
```

فایل `env.example` را فقط به‌عنوان راهنما استفاده کنید. Secret واقعی را Commit نکنید.

### ساخت منابع Cloudflare

```bash
npx wrangler login
npx wrangler d1 create amir-nazi-chat-db
npx wrangler r2 bucket create amir-nazi-private-media
```

`database_id` خروجی D1 را در `wrangler.jsonc` جایگزین کنید. Bucket باید خصوصی بماند و Public Development URL/Custom Public Bucket فعال نشود.

### Secretهای Worker

دو مقدار تصادفی و طولانی بسازید. `SESSION_SECRET` فقط Cloudflare است. `INTERNAL_API_SECRET` باید همان مقداری باشد که در Vercel با نام `CHAT_WORKER_INTERNAL_SECRET` ثبت می‌کنید.

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put INTERNAL_API_SECRET
```

`ALLOWED_ORIGIN` در `wrangler.jsonc` باید دقیقاً Origin اپ Vercel/دامنهٔ اصلی باشد، بدون slash انتهایی.

### Migration

```bash
npm run db:migrate:remote
```

Migration فقط دو کاربر واقعی را با Hash+Salt ایجاد می‌کند. هیچ پیام یا رسانه‌ای Seed نمی‌شود. `INSERT OR IGNORE` باعث می‌شود اجرای مجدد Seed رمزهای تغییرکرده را overwrite نکند و هیچ پیام موجودی حذف نشود.

### Deploy Worker

```bash
npm run deploy:worker
```

بعد از Deploy، آدرس HTTPS/WSS Worker را یادداشت کنید.

### تنظیم Vercel

پروژه Vercel را روی Root Directory برابر `apps/web` قرار دهید و این متغیرها را تعریف کنید:

```text
NEXT_PUBLIC_CHAT_API_URL=/api
NEXT_PUBLIC_CHAT_WS_URL=wss://YOUR_WORKER_DOMAIN/ws/chat
NEXT_PUBLIC_APP_NAME=Amir & Nazi
CHAT_WORKER_URL=https://YOUR_WORKER_DOMAIN
CHAT_WORKER_INTERNAL_SECRET=<same as Worker INTERNAL_API_SECRET>
SESSION_COOKIE_NAME=an_session
```

`CHAT_WORKER_INTERNAL_SECRET` و `CHAT_WORKER_URL` Server-only هستند. هیچ Secret را با `NEXT_PUBLIC_` تعریف نکنید.

## دامنهٔ اختصاصی

پیشنهاد Production: یک دامنه برای UI مثل `chat.example.com` روی Vercel و یک زیردامنه مثل `chat-api.example.com` روی Worker. سپس `ALLOWED_ORIGIN` را روی Origin رابط کاربری و `NEXT_PUBLIC_CHAT_WS_URL`/`CHAT_WORKER_URL` را روی دامنهٔ Worker تنظیم کنید. بعد از هر تغییر Origin، Worker را دوباره Deploy کنید.

## API Worker

مسیرهای اصلی:

```text
POST   /auth/login
POST   /auth/logout
POST   /auth/change-password
GET    /auth/session
POST   /auth/ws-ticket
GET    /messages?limit=100&before=<cursor>
GET    /messages?limit=100&after=<cursor>
GET    /messages/search?q=<query>
GET    /messages/:id
POST   /messages
PATCH  /messages/:id
DELETE /messages/:id
POST   /messages/:id/read
POST   /messages/:id/reaction
POST   /media/upload-url
PUT    /media/upload/:short-lived-ticket
POST   /media/:id/access
GET    /media/:id
WS     /ws/chat
```

## صفحه‌بندی و Sync

ورود اولیه حداکثر ۱۰۰ پیام آخر را می‌گیرد. پیام‌های قدیمی با Cursor و هر بار حداکثر ۱۰۰ رکورد دریافت می‌شوند. برای Sync پس از بازگشت، `after` نیز در batchهای ۱۰۰تایی استفاده می‌شود؛ بنابراین بیش از ۱۰۰ پیام جدید مرحله‌ای همگام می‌شوند. UI هنگام prepend ارتفاع Scroll را جبران می‌کند. اگر کاربر پایین گفتگو نباشد، پیام جدید Scroll را جابه‌جا نمی‌کند و دکمهٔ تعداد پیام‌های جدید ظاهر می‌شود.

## داده‌های مرورگر

پیام‌ها منبع LocalStorage ندارند. فقط Theme و Draft به‌صورت محدود در LocalStorage ذخیره می‌شوند. Session Token در JavaScript قابل دسترسی نیست و داخل HttpOnly Cookie قرار دارد.

## نکات Production

- بعد از اولین ورود رمز هر دو حساب را تغییر دهید.
- R2 را Public نکنید.
- Secretها را فقط در Cloudflare/Vercel Secret/Environment UI نگه دارید.
- Origin دقیق Production را در Worker قرار دهید.
- لاگ‌ها را برای Body/Cookie/Header حساس فعال نکنید؛ کد پروژه عمداً متن پیام، رمز، Cookie و Token را Log نمی‌کند.
- این پروژه End-to-End Encryption را ادعا یا پیاده‌سازی نمی‌کند. HTTPS/WSS و کنترل دسترسی Server-side وجود دارد، اما سرور قادر به پردازش متن پیام است.

جزئیات Deploy و امنیت در پوشه `docs` آمده است.
