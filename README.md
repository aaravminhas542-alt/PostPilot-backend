# PostPilot AI Backend

A starter Node.js/Express API for the PostPilot AI Netlify frontend. It includes OpenAI-powered seven-post generation, Stripe subscription Checkout, a verified Stripe webhook endpoint, CORS, basic security headers, and rate limiting.

**This is a backend starter, not a finished production subscription system.** It does not yet include user accounts, a database, subscription entitlement checks, usage tracking, customer billing portal, or durable webhook event processing. The current frontend must also be updated to call these API routes.

## API routes

- `GET /api/health` — health check.
- `POST /api/generate` — expects JSON with `business` and optional `platform`, `tone`, `goal`, `audience`, `offer`, and `notes`; returns `{ "posts": [...] }`.
- `POST /api/checkout` — expects `{ "plan": "pro" }` or `{ "plan": "studio" }`; returns a Stripe Checkout URL.
- `POST /api/stripe/webhook` — verifies Stripe's signature and acknowledges supported billing events. Database updates are intentionally not implemented yet.

Example generation request:

```bash
curl -X POST https://YOUR-RENDER-SERVICE.onrender.com/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"business":"Example Coffee Shop","platform":"Instagram","tone":"warm and playful","goal":"increase local visits"}'
```

Example checkout request:

```bash
curl -X POST https://YOUR-RENDER-SERVICE.onrender.com/api/checkout \
  -H 'Content-Type: application/json' \
  -d '{"plan":"pro"}'
```

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Fill in your own OpenAI API key and Stripe **test-mode** secret key. Keep `.env` private.
4. Run:

   ```bash
   npm install
   npm start
   ```

5. Visit `http://localhost:3000/api/health`.

Do not commit `.env`. Only commit `.env.example` with placeholder values.

## Put this on GitHub

1. Create a new, private or public GitHub repository (for example, `postpilot-ai-backend`).
2. Extract this ZIP.
3. Upload the files and folders inside `postpilot-backend` to the repository root. Ensure `package.json`, `server.js`, and `README.md` are at the root, not buried in an extra nested folder.
4. Confirm no real keys or `.env` file were uploaded.

## Deploy on Render

1. Sign in to Render and create a **Web Service** from the GitHub repository.
2. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
3. Add these environment variables in Render's dashboard (use your actual secret values):
   - `NODE_ENV` = `production`
   - `FRONTEND_URL` = `https://exquisite-douhua-17aaf8.netlify.app`
   - `OPENAI_API_KEY` = your OpenAI API key
   - `OPENAI_MODEL` = `gpt-4.1-mini` (or another model available to your account)
   - `STRIPE_SECRET_KEY` = your Stripe **test-mode** secret key, beginning with `sk_test_`
   - `STRIPE_PRO_PRICE_ID` = `price_1UUJYPE7qnCDs3dIGEDKhYDn`
   - `STRIPE_STUDIO_PRICE_ID` = `price_1UUJZxE7qnCDs3dIZXEjTzLK`
   - `STRIPE_WEBHOOK_SECRET` = set after creating the webhook endpoint below
4. Deploy and verify `https://YOUR-RENDER-SERVICE.onrender.com/api/health` returns a JSON status of `ok`.

Never paste secret keys into source files, GitHub, frontend JavaScript, or public chats.

## Configure Stripe webhooks (test mode)

In the Stripe Dashboard, switch to test mode and create a webhook endpoint pointing to:

`https://YOUR-RENDER-SERVICE.onrender.com/api/stripe/webhook`

Select these events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Copy the endpoint's signing secret (`whsec_...`) into Render's `STRIPE_WEBHOOK_SECRET` environment variable, then redeploy. Do not use the Stripe secret API key as the webhook signing secret.

## Connect the Netlify frontend

The existing site at `https://exquisite-douhua-17aaf8.netlify.app/` will **not automatically use this backend**. Its JavaScript needs to be updated to call the Render API URL:

- Generate button: `POST https://YOUR-RENDER-SERVICE.onrender.com/api/generate`
- Subscription buttons: `POST https://YOUR-RENDER-SERVICE.onrender.com/api/checkout` and redirect the browser to the returned `url`.

The exact frontend integration depends on the site's current source files. Do not claim the integration is complete until it is implemented and tested.

## Before accepting real payments

- Keep Stripe in test mode while testing.
- Add authentication and a database-backed user/subscription model.
- Verify active subscriptions on the server before granting paid features.
- Handle webhook events idempotently and persist their results.
- Add usage limits, logging/monitoring, and a customer billing portal/cancellation flow.
- Add tests and review security, privacy, and applicable legal requirements.

A success redirect alone is not proof of payment or an active subscription.
