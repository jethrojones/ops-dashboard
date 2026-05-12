# Talking to services that don't have an API

Not every service you'll want to automate exposes an official API. This
doc covers four patterns, in order of preference (least fragile first).

> **Before you build any of this:** check the service's Terms of Service.
> "Use an unofficial API endpoint without permission" is a TOS violation
> in many products and can get your account banned. If you're automating
> *your own* account on a service that doesn't sell API access, you're
> usually fine. If you're automating someone else's account, ask first.

---

## Pattern 1: hidden internal APIs (the easiest)

Most web apps are SPAs that talk to their own backend over JSON. Those
internal endpoints aren't documented, but they exist and they work.

### How to find them

1. Open the service in Chrome. Sign in.
2. Open DevTools → Network tab. Filter to "Fetch/XHR".
3. Do the action you want to automate (click "Export CSV", "Add user",
   whatever).
4. Watch the requests. The one with the right shape is your endpoint.
5. Right-click → Copy → Copy as cURL.
6. Save the cURL, replace the cookie/auth headers with the smallest set
   that still works.

### Auth options

Internal APIs usually authenticate with either:

- **Session cookies.** Set `Cookie: <name>=<value>; ...` from a fresh
  manual login. Cookies expire — your script will break on a known
  schedule (a day, a week, a month). Add a `dry_run` check at the top
  that confirms the cookie still works, and email you when it doesn't.
- **CSRF tokens.** Some apps require `X-CSRF-Token` on writes. The
  token is usually in a meta tag on the HTML, or in the cookie.
- **Bearer tokens** stored in localStorage. Open DevTools → Application
  → Local Storage → look for `token`, `accessToken`, `auth`. Some are
  short-lived (1-24h) — you may need a `/login` step every run.

### Storing the cookie

Treat the cookie like any other secret: paste into Settings → Connections.
Don't put it in `wrangler.toml` or commit it.

### Refresh strategy

If the cookie expires regularly, you have three options:

1. **Manual rotation.** When it expires, sign in fresh, copy the new
   cookie, paste in Settings → Connections. Add a circuit-breaker
   email so you know when it's expired.
2. **Programmatic login.** Some apps let you `POST /login` with email +
   password and return a session cookie. Store the password
   (encrypted) in Settings → Connections; have the script log in at the
   top of every run. (Two requests of subrequest budget; one a few
   seconds slower.)
3. **Headless browser** (see Pattern 3).

---

## Pattern 2: RSS / public endpoints

If you just need to *read* data, check whether the service has:

- An RSS or Atom feed. Many SaaS apps quietly expose feeds for
  "Recently created [thing]". `View source` on the user-facing list
  page; you're looking for `<link rel="alternate" type="application/rss+xml">`.
- A public sitemap.xml.
- A `/oembed` or `/api/public/...` endpoint that doesn't need auth.

These are stable and unlikely to break. Useful when the service is
hostile to scraping but ships a polite alternative.

---

## Pattern 3: headless browser (Browser Rendering API)

When there's no API and no internal JSON endpoints, render the page
yourself.

Cloudflare Workers can call the **Browser Rendering API** — a hosted
headless Chrome. Free plan: 10 minutes/day. Paid plan ($5/mo): 10
hours/month bundled.

```typescript
// In your script. Requires binding the BROWSER namespace in wrangler.toml:
//   [browser]
//   binding = "BROWSER"
// And the script runtime ctx.env.BROWSER is then available.

import puppeteer from '@cloudflare/puppeteer';

const browser = await puppeteer.launch(ctx.env.BROWSER);
const page = await browser.newPage();
await page.goto('https://app.example.com/login');
await page.type('input[name=email]', 'you@example.com');
await page.type('input[name=password]', ctx.secrets.example_password);
await page.click('button[type=submit]');
await page.waitForNavigation();
const html = await page.content();
await browser.close();
```

Each `await browser.newPage()` uses a few subrequests-equivalent of your
Browser Rendering budget — different from the 50-subrequest limit. Read
the [Cloudflare docs](https://developers.cloudflare.com/browser-rendering/)
before adopting.

**Headless browsers are the most fragile option.** Sites change layouts,
add bot detection, change auth flows. Plan for breakage. Add good logs
so you can debug from the run detail page.

---

## Pattern 4: Zapier / Make / n8n as a bridge

If a service has a Zapier integration but no API:

- **Outbound (your worker → the service)**: create a Zap with a
  "Webhook by Zapier → Catch Hook" trigger. Zapier gives you a URL. Your
  script POSTs to it. Zapier does the action.
- **Inbound (the service → your worker)**: create a Zap with the
  service's trigger ("New record in X") → action "Webhooks by Zapier →
  POST to URL". Point it at `/webhooks/zapier/<event>` on your worker.

This is the lowest-friction path. You're paying Zapier ~$20/month, but
you skip the auth/CSRF/headless mess entirely. If the workflow has only
1–2 steps, Zapier's free tier (100 tasks/month) is plenty.

n8n / Make are functionally equivalent, with different pricing curves.

---

## When you've reverse-engineered a private API

Document what you learned in `scripts/<id>/SKILL.md`:

- Which endpoints you're calling and what their shapes are.
- How auth works (cookie? token? CSRF?).
- How auth expires and how to rotate.
- Any rate limits you've discovered the hard way.
- The exact UI action that produces each request.

Future-you (and future LLM helpers) will thank you when the script
breaks 6 months from now and the service has changed its endpoints
since you wrote it.
