# Deploy روی Vercel

1. Repository را Import کنید.
2. Root Directory را `apps/web` قرار دهید.
3. Framework Preset باید Next.js باشد.
4. Environment Variables را برای Production/Preview متناسب با Origin هر محیط تعریف کنید.

متغیرهای Production:

```text
NEXT_PUBLIC_CHAT_API_URL=/api
NEXT_PUBLIC_CHAT_WS_URL=wss://YOUR_WORKER_DOMAIN/ws/chat
NEXT_PUBLIC_APP_NAME=Amir & Nazi
CHAT_WORKER_URL=https://YOUR_WORKER_DOMAIN
CHAT_WORKER_INTERNAL_SECRET=<same as Cloudflare INTERNAL_API_SECRET>
SESSION_COOKIE_NAME=an_session
```

`CHAT_WORKER_INTERNAL_SECRET` حساس است و نباید `NEXT_PUBLIC_` داشته باشد.

بعد از اولین Deploy، URL نهایی Vercel را به‌عنوان `ALLOWED_ORIGIN` در `wrangler.jsonc` ثبت و Worker را دوباره Deploy کنید. اگر Custom Domain دارید، Origin نهایی Custom Domain را استفاده کنید.

BFF باعث می‌شود Cookie نشست روی دامنهٔ Vercel/اپ First-party باشد و وابسته به Third-party Cookie بین `vercel.app` و `workers.dev` نباشد.
