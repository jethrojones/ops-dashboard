# Webhook Echo

Receives a webhook and logs the payload. Use it to verify webhook
plumbing works before pointing a real third-party service at the worker.

## How to test

1. Add a connection in **Settings → Connections** with the key
   `echo_webhook_secret`. Set the value to any random string (20+ chars).
2. Send a test webhook with curl:

```bash
SECRET="the-random-string-you-set"
curl -X POST https://<your-app-domain>/webhooks/echo/ping \\
  -H "X-Webhook-Secret: $SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"hello": "from curl", "n": 42}'
```

3. Refresh the dashboard. A new "Webhook Echo" run appears, status
   `success`, with the JSON body in the verbose log.

## How webhooks are routed

- The worker exposes `POST /webhooks/:service/:event`.
- Hono routes the request to the generic handler in `src/index.ts` (search
  for `app.post('/webhooks/:service/:event'`).
- The handler verifies the `X-Webhook-Secret` header against the value
  stored under the D1 secret key `<service>_webhook_secret`.
- If verified, it looks for any enabled script with a matching trigger:
  ```json
  { "type": "webhook", "service": "echo", "event": "ping", "enabled": true }
  ```
- Found? It enqueues a run. Not found? Returns 200 with
  `{ "ok": true, "message": "No matching enabled webhook script" }` so the
  upstream provider doesn't retry.

## Switching to HMAC verification

The generic handler uses a shared-secret header — fine for low-stakes use
but worse than HMAC. For HubSpot/Stripe/GitHub/etc., write a dedicated
handler above the generic one in `src/index.ts` that verifies the
provider's specific HMAC signature.

## Failure modes

- **401 Invalid webhook secret** — the secret isn't set, or doesn't match.
  Check Settings → Connections → `<service>_webhook_secret`.
- **200 No matching enabled webhook script** — the trigger in
  `metadata.json` doesn't match the URL. Confirm `service` and `event`
  values match the URL segments exactly.
