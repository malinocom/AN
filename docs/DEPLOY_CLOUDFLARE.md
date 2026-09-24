# Deploy روی Cloudflare

1. در ریشه پروژه `npm install` و سپس `npx wrangler login` را اجرا کنید.
2. D1 را با `npx wrangler d1 create amir-nazi-chat-db` بسازید و `database_id` را در `wrangler.jsonc` جایگزین کنید.
3. R2 را با `npx wrangler r2 bucket create amir-nazi-private-media` بسازید. Public Access را فعال نکنید.
4. `ALLOWED_ORIGIN` را روی Origin دقیق Vercel یا دامنهٔ UI قرار دهید.
5. با `npx wrangler secret put SESSION_SECRET` یک Secret تصادفی مستقل ثبت کنید.
6. با `npx wrangler secret put INTERNAL_API_SECRET` Secret ارتباط Vercel↔Worker را ثبت کنید.
7. `npm run db:migrate:remote` را اجرا کنید.
8. `npm run deploy:worker` را اجرا کنید.
9. `GET /health` را بررسی کنید. پاسخ باید `{"ok":true}` باشد.
10. آدرس Worker را در Vercel برای `CHAT_WORKER_URL` و نسخه WSS آن را برای `NEXT_PUBLIC_CHAT_WS_URL` ثبت کنید.

برای دامنه اختصاصی Worker از بخش Workers & Pages → Worker → Settings/Triggers/Custom Domains استفاده کنید. پس از تغییر دامنه، متغیرهای Vercel را به‌روزرسانی کنید.

## Bindingها

- `DB`: D1
- `MEDIA_BUCKET`: R2 خصوصی
- `CHAT_ROOM`: Durable Object
- `SESSION_SECRET`: Wrangler Secret
- `INTERNAL_API_SECRET`: Wrangler Secret
- `ALLOWED_ORIGIN`: Worker var

`wrangler.jsonc` شامل Cron cleanup و Migration کلاس Durable Object نیز هست.
