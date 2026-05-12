# Getting API keys for popular services

Per-service walkthroughs for the most common integrations. Each section
covers: where to get the key, what scope/permissions to set, the exact
header format the API expects, and any quirks. The list is alphabetical.

Don't see your service? See [services-without-apis.md](services-without-apis.md)
for the unofficial-API patterns, and the "Generic pattern" at the bottom
of this file.

## Index

- [Airtable](#airtable)
- [Anthropic (Claude API)](#anthropic-claude-api)
- [Asana](#asana)
- [AWS S3](#aws-s3)
- [Brave Search](#brave-search)
- [ClickUp](#clickup)
- [DocuSeal](#docuseal)
- [GitHub (Personal Access Token)](#github-personal-access-token)
- [Google APIs (service account JSON)](#google-apis-service-account-json)
- [HubSpot](#hubspot)
- [Instantly](#instantly)
- [Kit (ConvertKit)](#kit-convertkit)
- [Linear](#linear)
- [Mailgun](#mailgun)
- [Notion](#notion)
- [OpenAI](#openai)
- [PostHog](#posthog)
- [Resend](#resend)
- [Sentry](#sentry)
- [Slack](#slack)
- [Stripe](#stripe)
- [Twilio](#twilio)
- [Zapier (webhooks)](#zapier-webhooks)

---

## Airtable

- **Where**: <https://airtable.com/create/tokens>
- **Token type**: Personal Access Token (PAT)
- **Scopes**: `data.records:read` and/or `data.records:write`. **Access**:
  pick specific bases — never give a PAT access to "all current and future bases."
- **Header**: `Authorization: Bearer <token>`
- **Base URL**: `https://api.airtable.com/v0/<baseId>/<tableName>`
- **Quirk**: rate-limited at 5 req/sec per base. Add a `delay(200)` between calls.

---

## Anthropic (Claude API)

- **Where**: <https://console.anthropic.com/settings/keys>
- **Header**: `x-api-key: <key>` and `anthropic-version: 2023-06-01`
- **Base URL**: `https://api.anthropic.com/v1/messages`
- **Quirk**: input/output token usage is on every response — watch your
  spend. Use prompt caching for repeated system prompts.

---

## Asana

- **Where**: <https://app.asana.com/0/my-apps>
- **Token type**: Personal Access Token (settings → Apps → Developer
  console).
- **Header**: `Authorization: Bearer <token>`
- **Base URL**: `https://app.asana.com/api/1.0`

---

## AWS S3

- **Where**: AWS IAM → Users → create an IAM user with programmatic
  access. Generate an access key + secret pair. Attach a policy that
  scopes to specific buckets (never use the root account credentials).
- **Auth**: AWS SigV4 — non-trivial to implement in a Worker without an
  SDK. For workers, prefer **Cloudflare R2** with the S3-compatible API:
  it accepts S3-format requests using a simpler R2 access key pair, and
  egress is free.
- **If you must talk to AWS S3**: use the AWS-provided SDK pinned to a
  version that runs in Workers (most don't — check the `aws4fetch`
  library instead).

---

## Brave Search

- **Where**: <https://api.search.brave.com/app/keys> (sign up at
  brave.com/search/api).
- **Header**: `X-Subscription-Token: <key>` and `Accept: application/json`
- **Base URL**: `https://api.search.brave.com/res/v1/web/search`
- **Free tier**: 1 query/sec, 2k queries/month. Plenty for occasional
  ops use.

---

## ClickUp

- **Where**: ClickUp → user avatar → Settings → Apps → Generate API token.
- **Header**: `Authorization: <token>` (no `Bearer` prefix)
- **Base URL**: `https://api.clickup.com/api/v2`

---

## DocuSeal

- **Where**: DocuSeal → Settings → API.
- **Header**: `X-Auth-Token: <token>`
- **Base URL**: `https://api.docuseal.com`
- **Webhooks**: configure in DocuSeal → Webhooks. Use a custom header
  named `X-Webhook-Secret` (the worker convention) with any random
  20+-character string. Save the same string in the Ops Dashboard under
  Settings → Connections → key `docuseal_webhook_secret`.

---

## GitHub (Personal Access Token)

- **Where**: <https://github.com/settings/tokens?type=beta>
- **Token type**: Fine-grained PAT (preferred over classic) — scoped to
  specific repos.
- **Permissions** (per the use case):
  - Reading code only: Contents: Read, Metadata: Read.
  - Paste-back deploys: Contents: Read and write, Pull requests: Read and
    write, Metadata: Read.
  - Triggering GitHub Actions: + Actions: Read and write.
- **Header**: `Authorization: Bearer <token>` and `User-Agent: <anything>`
  (GitHub rejects requests without a User-Agent).
- **Base URL**: `https://api.github.com`
- **Quirk**: rate-limited to 5,000 req/hour per token. Use conditional
  requests (`If-None-Match`) to avoid hitting it.

---

## Google APIs (service account JSON)

For Drive, Sheets, Calendar, BigQuery, Vertex AI — the auth pattern is
the same: a **service account** with a JSON key.

- **Where**:
  1. Cloud Console → IAM & Admin → Service Accounts → Create.
  2. Generate a JSON key. Download it. **You can't re-download it later.**
  3. Enable the APIs you need (e.g. "Google Drive API") in the Console.
  4. For Drive/Sheets/Calendar, **share** the specific Drive folders /
     Sheets / Calendars **with the service account email** (visible
     in the JSON as `client_email`).
- **Storage**: paste the entire JSON object into Settings → Connections
  → `drive` (or whatever key you choose).
- **At runtime**: parse the JSON, sign a JWT with the private key,
  exchange it for an access token via Google's OAuth token endpoint. This
  is more involved than other APIs — consider using the
  `google-auth-library` workarounds for Workers or building the signing
  inline with `crypto.subtle`.

---

## HubSpot

- **Where**: HubSpot → Settings → Integrations → Private Apps → Create
  a Private App.
- **Token type**: Private App access token (starts with `pat-na1-`).
- **Scopes**: minimum necessary. For most CRUD work:
  `crm.objects.contacts.read`, `crm.objects.contacts.write`,
  `crm.objects.deals.read`, `crm.objects.deals.write`,
  `crm.schemas.contacts.read`, `crm.schemas.deals.read`. Add
  `crm.objects.companies.*`, `automation`, `tickets`, `commerce`, etc.
  as you need them.
- **Header**: `Authorization: Bearer <token>`
- **Base URL**: `https://api.hubapi.com`
- **Webhooks**: use the v3 webhook (HMAC SHA-256 signature in
  `X-HubSpot-Signature-v3`). The default `/webhooks/:service/:event`
  endpoint uses shared-secret auth — write a dedicated HMAC handler
  for production.
- **Quirk**: free Marketing Hub has aggressive rate limits — 100
  req/10s per portal. Use the `/crm/v3/objects/<type>/batch/*`
  endpoints; a batch counts as 1 request.

---

## Instantly

- **Where**: Instantly → Settings → Integrations → API. Use a **V2** key.
- **Header**: `Authorization: Bearer <key>` (V2). V1 used `?api_key=...`
  query param.
- **Base URL**: `https://api.instantly.ai/api/v2`
- **Quirk**: V1 and V2 are both live — make sure you generate a V2 key
  or the platform's `checkInstantly` will fall back to V1 mode.

---

## Kit (ConvertKit)

- **Where**: Kit → Account Settings → Developer → API Keys.
- **Header**: `X-Kit-Api-Key: <key>` (V4) — **not** `Authorization: Bearer`.
- **Base URL**: `https://api.kit.com/v4`

---

## Linear

- **Where**: Linear → Settings → API → Personal API keys.
- **Header**: `Authorization: <key>` (no `Bearer` prefix)
- **Base URL**: `https://api.linear.app/graphql` (GraphQL only)

---

## Mailgun

- **Where**: Mailgun → API Security → API Keys.
- **Header**: `Authorization: Basic <base64('api:<api-key>')>`
- **Base URL**: `https://api.mailgun.net/v3/<domain>`

---

## Notion

- **Where**: <https://www.notion.so/profile/integrations> → New integration.
- **Type**: Internal integration. Copy the "Internal Integration Secret"
  (starts with `secret_` or `ntn_`).
- **Header**: `Authorization: Bearer <secret>` and
  `Notion-Version: 2022-06-28`
- **Base URL**: `https://api.notion.com/v1`
- **Quirk**: every page or database your integration needs to access must
  be **explicitly shared** with the integration (click "..." on the page
  → Connections → add the integration). Without sharing, you get 404s.

---

## OpenAI

- **Where**: <https://platform.openai.com/api-keys>.
- **Header**: `Authorization: Bearer <key>`
- **Base URL**: `https://api.openai.com/v1`
- **Quirk**: model names change. Pin a version in your script (e.g.
  `gpt-4o-2024-08-06`) — leaving it at `gpt-4o` means quiet model swaps.

---

## PostHog

- **Where**: PostHog → Project Settings → API Keys. Use a **Personal API
  key** (for reading data via `/api/projects/...`) or a project's
  **Public** key (for sending events via `/capture`).
- **Header (Personal API key)**: `Authorization: Bearer <key>`
- **Base URL**: `https://app.posthog.com` (US cloud) or your self-hosted
  URL.

---

## Resend

- **Where**: <https://resend.com/api-keys>.
- **Token type**: API Key. Choose **Sending access** restricted to a
  domain you've verified.
- **Header**: `Authorization: Bearer <key>` (starts with `re_`)
- **Base URL**: `https://api.resend.com`
- **Quirk**: you must verify the sending domain in Resend (DNS records).
  Otherwise sending emails returns 403.

---

## Sentry

- **Where**: Sentry → Settings → Account → API → Auth Tokens.
- **Header**: `Authorization: Bearer <token>`
- **Base URL**: `https://sentry.io/api/0` (SaaS) or your self-hosted URL.

---

## Slack

- **Where**: <https://api.slack.com/apps> → Create New App → From scratch.
- **Token type**: depends on use case.
  - **Bot Token (`xoxb-...`)**: for posting messages, reading channels.
    Add scopes under OAuth & Permissions (e.g. `chat:write`,
    `channels:read`, `users:read`).
  - **User Token (`xoxp-...`)**: rarely needed; runs as a specific user.
- **Install**: install the app to your workspace to mint the token.
- **Header**: `Authorization: Bearer <token>`
- **Base URL**: `https://slack.com/api`

---

## Stripe

- **Where**: Stripe Dashboard → Developers → API keys.
- **Token type**: Restricted API key (preferred) — pick the specific
  resources and read/write permissions your script needs. Avoid using
  the live secret key directly.
- **Header**: `Authorization: Bearer <key>` (starts with `rk_live_` for
  restricted live, `sk_test_` for test)
- **Base URL**: `https://api.stripe.com/v1`
- **Webhooks**: HMAC SHA-256 signed in `Stripe-Signature`. Write a
  dedicated `/webhooks/stripe/...` handler in `src/index.ts` rather
  than using the generic shared-secret one — Stripe's signature
  scheme is the right way to verify.

---

## Twilio

- **Where**: Twilio Console → Account → API keys.
- **Auth**: `Authorization: Basic <base64('<sid>:<auth-token>')>`
- **Base URL**: `https://api.twilio.com/2010-04-01/Accounts/<sid>`

---

## Zapier (webhooks)

Zapier doesn't expose an API for the average user to write to. **Use a
webhook trigger** instead:

1. In Zapier, create a Zap with a "Webhook by Zapier" → "Catch Hook"
   trigger.
2. Copy the unique URL Zapier gives you.
3. In your ops script, `await fetch(zapUrl, { method: 'POST', body: ... })`.
4. Set the URL as a value in Settings → Connections (key e.g.
   `zapier_inbound_url`) so you can rotate it without redeploying.

---

## Generic pattern for "an API I haven't documented here"

99% of REST APIs follow this shape:

1. **Get a token.** Look for "API keys", "Personal access tokens",
   "Developer settings", or "Integrations" in the service's settings.
2. **Read the auth header format.** Almost always one of:
   - `Authorization: Bearer <token>`
   - `Authorization: Basic <base64(user:pass)>`
   - A custom header (e.g. `X-API-Key`, `X-Kit-Api-Key`)
3. **Add the service to Settings → Connections.** Edit
   `src/frontend/settings.ts` → `SERVICE_INFO` and `DISPLAY_ORDER`.
4. **Add a live-connection check** (optional but nice): a small function
   in `src/api/secrets.ts` → `testServiceCredential()` that hits the
   simplest endpoint (e.g. `GET /me`) and returns `{ ok, message }`.
5. **List the service** in your script's `required_secrets` and access
   via `ctx.secrets.<key>`.

---

## Storing the key

**Always** in Settings → Connections, never:

- In `wrangler.toml` (it's committed; never put secrets there).
- In a `.env` file (Workers don't use `.env`).
- As a `[vars]` env variable (those are unencrypted in the dashboard).
- Pasted into chat with an LLM.

The Settings UI encrypts the key with AES-GCM using `OPS_SECRETS_MASTER_KEY`
before storing in D1. The plaintext only exists in memory inside the
queue consumer while a script runs.
