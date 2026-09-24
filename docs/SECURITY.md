# امنیت

- هیچ Registration endpoint وجود ندارد و Constraint دیتابیس username را به دو نام مجاز محدود می‌کند.
- رمزها PBKDF2-SHA256 با Salt مستقل و 600,000 iteration هستند.
- Session Token تصادفی 256-bit است؛ فقط SHA-256 آن در D1 ذخیره می‌شود.
- Cookie اپ `HttpOnly + Secure + SameSite=Strict` است.
- BFF فقط با `INTERNAL_API_SECRET` می‌تواند Session Token را به Worker ارائه دهد.
- Login Rate Limit بر اساس Hash ترکیب IP و username اعمال می‌شود و IP خام در جدول Rate Limit ذخیره نمی‌شود.
- تمام ورودی SQL کاربر با Prepared Statement bind می‌شود. شناسه کاربر مورد استفاده در بخش projection از Session سروری و مجموعه ثابت دو User ID می‌آید.
- React متن پیام را به‌عنوان Text رندر می‌کند؛ HTML کاربر inject نمی‌شود. CSP و `nosniff` نیز فعال‌اند.
- درخواست‌های تغییردهنده Origin-check دارند؛ BFF نیز Same-Origin را بررسی می‌کند.
- WebSocket Origin-check، Ticket HMAC کوتاه‌عمر و Session revalidation دارد.
- R2 عمومی نیست. Upload و Download با Capability کوتاه‌عمر انجام می‌شود و Download Ticket به Session فعال متصل است.
- MIME صرفاً از Header مرورگر پذیرفته نمی‌شود؛ Magic Bytes برای JPEG/PNG/GIF/WebP/HEIC و MP4/QuickTime/WebM بررسی می‌شود. فایل اجرایی یا نوع ناشناخته Reject می‌شود.
- Media پاسخ `Cache-Control: private, no-store` دارد و Worker از Cache API عمومی استفاده نمی‌کند.
- کد Worker متن پیام، Password، Cookie، Session Token یا Body درخواست را Log نمی‌کند.
- پروژه E2EE نیست و چنین ادعایی ندارد.

## محدودیت‌های نسخه اول

- Video transcoding/codec conversion وجود ندارد؛ سازگاری Playback به codec مرورگر بستگی دارد.
- Thumbnail در Browser تولید می‌شود. اگر Browser نتواند Preview/Canvas بسازد، فایل اصلی همچنان می‌تواند Upload شود و Thumbnail نخواهد داشت.
- Rate Limit در D1 برای این پروژه دوکاربره مناسب است؛ برای ترافیک عمومی بزرگ بهتر است Cloudflare WAF/Rate Limiting نیز اضافه شود.
