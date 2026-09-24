# گزارش تست

تاریخ آماده‌سازی: 2026-09-24

## واقعاً اجرا و بررسی شده

- Syntax/Type structural check کد Worker با TypeScript 5.8.3 و stubهای سازگار با APIهای Cloudflare: بدون خطا.
- Syntax/Type structural check کد Next/React با TypeScript 5.8.3 و stubهای ماژول‌های خارجی: بدون خطا.
- اجرای هر دو Migration روی SQLite in-memory: موفق.
- اجرای مجدد Migrationها روی همان DB: موفق؛ تعداد کاربران ۲ و تعداد پیام‌های Seed برابر ۰ باقی ماند.
- بررسی اینکه Migration هیچ پیام/رسانهٔ آزمایشی ایجاد نمی‌کند: موفق.
- بررسی Hashهای Seed با PBKDF2-SHA256/600,000 و Salt مستقل برای هر حساب در محیط تست: موفق.
- بررسی وجود Unique index برای `(sender_id, client_message_id)`، Cursor index برای `(room_id, created_at DESC, id DESC)` و FTS5 trigram برای جست‌وجوی متن: انجام شد.
- اجرای Triggerهای FTS5 برای Insert/Edit/Soft-delete روی SQLite تست شد: موفق.
- الگوی Cursor Pagination با ۲۵۰ پیام موقت در DB in-memory تست شد: صفحه اول ۱۰۰، صفحه دوم ۱۰۰ و تشخیص `hasMore` صحیح بود.
- بررسی استاتیک عدم وجود LocalStorage برای Message history: تاریخچه از API/D1 می‌آید؛ LocalStorage فقط Theme و Draft را نگه می‌دارد.
- بررسی استاتیک عدم Log کردن Body/Password/Message/Cookie/Token در Worker: انجام شد.

## در این محیط قابل اجرای کامل نبود

`npm install` در محیط ساخت به دلیل محدودیت/Timeout شبکه کامل نشد؛ بنابراین Build واقعی Next.js با پکیج‌های npm و `wrangler dev` واقعی در این محیط اجرا نشده است. همچنین Credential حساب Cloudflare/Vercel در اختیار محیط نبود، بنابراین موارد زیر نیازمند Smoke Test بعد از Deploy هستند:

- Deploy واقعی Vercel و Worker
- D1 remote migration
- WebSocket Hibernation روی Durable Object واقعی
- آپلود/Range واقعی R2
- CORS/Origin روی دامنه نهایی
- رفتار Mobile keyboard روی دستگاه واقعی iOS/Android
- Camera/Gallery picker روی دستگاه واقعی
- Playback codecهای ویدیو روی مرورگرهای هدف

این موارد به‌عنوان «تست‌شده» گزارش نشده‌اند.
