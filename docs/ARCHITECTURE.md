# معماری

## مرزهای اعتماد

1. Browser فقط UI، Draft، Theme و WebSocket client را نگه می‌دارد.
2. Next.js BFF روی Vercel مالک Cookie HttpOnly اپ است و REST را با Secret داخلی به Worker می‌فرستد.
3. Worker تنها Gateway داده است و هویت را از Session معتبر D1 می‌گیرد؛ `sender_id` و `room_id` از Body مرورگر پذیرفته نمی‌شوند.
4. D1 منبع حقیقت پیام‌ها، نشست‌ها، Read Receiptها، Reactionها و Metadata رسانه است.
5. R2 فقط Objectهای خصوصی را نگه می‌دارد.
6. Durable Object فقط State زندهٔ Presence/Typing/WebSocket را هماهنگ می‌کند؛ تاریخچه در DO نگهداری نمی‌شود.

## Session Flow

Login از Browser به `/api/auth/login` در Next می‌رود. BFF با `X-Internal-Secret` به Worker درخواست می‌دهد. Worker Password Hash را با PBKDF2-SHA256 و Salt اختصاصی بررسی، Session تصادفی ایجاد و فقط برای BFF توکن opaque را برمی‌گرداند. Next آن را در Cookie `HttpOnly + Secure + SameSite=Strict` قرار می‌دهد.

## WebSocket Flow

Browser از BFF مسیر `/api/auth/ws-ticket` را می‌خواند. Worker Ticket HMAC کوتاه‌عمر می‌سازد. Browser آن را در `Sec-WebSocket-Protocol` می‌فرستد، نه URL. Worker امضا، انقضا، Room و Session D1 را بررسی می‌کند و اتصال را به DO ثابت اتاق خصوصی می‌دهد. DO از `acceptWebSocket()` و attachment برای Hibernation استفاده می‌کند.

## Message Flow

ارسال پیام با REST انجام می‌شود تا Persistence قبل از Broadcast قطعی باشد. `client_message_id` به همراه `sender_id` Unique است و Retry همان درخواست، پیام دوم تولید نمی‌کند. بعد از Commit، Worker فقط Event تغییر را به DO Broadcast می‌کند؛ Client نسخهٔ شخصی‌سازی‌شده پیام را از REST می‌گیرد یا با Cursor Sync می‌کند.

## Media Flow

Browser Metadata فایل را می‌فرستد. Worker محدودیت حجم را اعمال و یک Media row pending می‌سازد. URL آپلود کوتاه‌عمر صادر می‌شود. PUT مستقیم به Worker با Stream انجام می‌شود؛ Worker Magic Bytes را می‌خواند و فقط Image/Video مجاز را به R2 Stream می‌کند. Thumbnail سبک در Browser ساخته و جداگانه Upload می‌شود. Media فقط بعد از `original_uploaded=1` قابل اتصال به Message است.

GET رسانه با Ticket کوتاه‌عمر انجام می‌شود. Ticket به Session ID متصل است و Worker در هر دریافت اعتبار Session را در D1 بررسی می‌کند. `Range` به R2 پاس داده می‌شود و پاسخ 206 برای Video ارائه می‌شود.

## Cleanup

Cron روزانه Pending/Orphanهای قدیمی را حداکثر ۱۰۰ مورد در هر اجرا حذف می‌کند و Sessionهای منقضی را پاک می‌کند. حذف Message دارای Media نیز Object اصلی و Thumbnail را از R2 پاک می‌کند.
