# Integrations — LINE, Web, Email, Notifications

This extends [`architecture.md`](architecture.md) with the channels users actually
reach us through: **LINE**, a **Next.js web app**, **email ingestion**, and an
**outbound notification/reminder** engine.

## Big picture

```
            ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
   Channels │   LINE OA   │   │  Web (Next) │   │   Email     │
            │ bot+LIFF    │   │  + LIFF     │   │  inbound    │
            └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
                   │                 │                 │
                   ▼                 ▼                 ▼
            ┌────────────────────────────────────────────────┐
            │            Supabase Edge Functions              │
            │  line-webhook   email-inbound   (chat-log/ocr/  │
            │  line-auth                       tax-advisor)   │
            └────────────────────────┬───────────────────────┘
                                     ▼
            ┌────────────────────────────────────────────────┐
            │     Postgres (entries, line_identities,         │
            │     reminders, notification_log, inbound_emails)│
            └────────────────────────┬───────────────────────┘
                                     ▼
            ┌────────────────────────────────────────────────┐
            │   filing-reminders (scheduled, daily)           │
            │   → LINE push  → email                          │
            └────────────────────────────────────────────────┘
```

The existing `chat-log`, `ocr-receipt`, `categorize`, `tax-advisor` functions stay
the engine. The new channels are thin adapters that authenticate the user, then call
the same logic.

---

## 1. LINE

We use three LINE products together; they share one **LINE Login Channel** + one
**Messaging API Channel** under the same LINE Official Account.

### 1a. Messaging API (chatbot)

The killer feature for Thai users: **forward a receipt photo or type a one-liner into
LINE chat → it's logged.** No app to open.

```
User sends image/text to LINE OA
   │
   ▼  LINE platform → webhook
POST /functions/v1/line-webhook   (verify X-Line-Signature)
   │
   ├─ look up line_identities[lineUserId]
   │     ├─ not linked? → reply with LIFF link to connect account
   │     └─ linked → resolve workspace_id
   │
   ├─ message is image → download via LINE content API → reuse OCR logic
   ├─ message is text  → reuse chat-log parsing logic
   │
   ▼  insert entry → reply confirmation bubble (Flex Message)
```

Signature verification: HMAC-SHA256 of the raw body using the channel secret, compared
to the `X-Line-Signature` header. Reject if mismatch.

### 1b. LINE Login (authentication)

Lets a user sign in with LINE on web/app and links their LINE identity to a Supabase
user. Flow:

```
Web/LIFF → LINE authorize → callback with code
   │
   ▼  POST /functions/v1/line-auth { code, redirectUri }
   │     exchange code → LINE access token → /v2/profile (lineUserId)
   │     upsert line_identities
   │     create-or-link a Supabase auth user (admin API)
   │     mint a Supabase session
   ▼  return Supabase access+refresh tokens to the client
```

We store the link in `line_identities` so the bot knows which workspace a LINE user
belongs to.

### 1c. LIFF (LINE Front-end Framework)

A web view that runs **inside LINE** — used for screens too rich for chat: the
dashboard, confirming a draft entry, picking which workspace, and the function menu.
The LIFF app is just our Next.js web app served at a LIFF endpoint; `liff.init()` gives
us the LINE ID token which we exchange via `line-auth`.

### 1d. Rich Menu (the "function selector")

A persistent menu at the bottom of the LINE chat with tappable regions:

```
┌─────────────┬─────────────┬─────────────┐
│ 📷 ถ่ายใบเสร็จ │ 💬 บันทึกด่วน │ 📊 สรุปภาษี  │
├─────────────┼─────────────┼─────────────┤
│ 📁 รายงาน    │ ⏰ แจ้งเตือน  │ ⚙️ ตั้งค่า    │
└─────────────┴─────────────┴─────────────┘
```

Each region either opens a LIFF page or sends a postback the webhook handles. Defined
in `supabase/functions/_shared/line-richmenu.ts` and uploaded with a one-off script.

---

## 2. Web app (Next.js)

`apps/web/` — Next.js 14 App Router. Three jobs:

1. **Marketing / signup** (public) — landing + pricing
2. **Dashboard** (authed) — full-screen version of the mobile dashboard, better for
   accountants reviewing many entries
3. **LIFF host** — the same React components served inside LINE

Auth: Supabase SSR (`@supabase/ssr`) with cookie-based sessions, plus LINE Login.
Shares `@appfinance/tax-core` for all calculations so web/mobile/bot never diverge.

Why separate from Expo Web: accountant workflows (bulk edit, keyboard shortcuts,
multi-column tables, print views) deserve a real web UI, and we want SEO on the
marketing pages.

---

## 3. Email ingestion

Many vendors email invoices/receipts (e.g. AWS, Google, Facebook, SaaS tools). Users
get a dedicated forwarding address per workspace:

```
inbox+<workspace_token>@in.appfinance.app
```

An inbound-email provider (Postmark / SendGrid Inbound Parse / Cloudflare Email
Workers) POSTs the parsed email to:

```
POST /functions/v1/email-inbound
   │  validate provider signature
   │  resolve workspace from the +token address
   │  store raw in inbound_emails
   │  for each attachment (pdf/jpg/png) → OCR logic → draft entry
   │  if no attachment → parse the HTML body with Claude → draft entry
   ▼  notify the user (LINE/web) that N draft entries await review
```

All email-sourced entries are `status='draft'` and `source='import'` — never
auto-confirmed.

---

## 4. Notification / reminder engine

We keep our own copy of each workspace's filing obligations and proactively remind
users **before** deadlines — the feature the user explicitly asked for ("เก็บข้อมูล
ลูกค้าเองแล้วคอยแจ้งเตือน").

### Data

- `reminders` — one row per (workspace, obligation, period). Generated ahead of time.
- `notification_log` — every push/email we sent, for idempotency + audit.

### Filing calendar (in `tax-core`)

`packages/tax-core/src/calendar.ts` computes due dates from workspace profile:

| Obligation | Cadence | Due | Applies when |
|---|---|---|---|
| ภ.พ.30 (VAT) | monthly | 15th next month | `vat_registered` |
| ภ.ง.ด.1 (payroll WHT) | monthly | 7th / 15th e-file | has salary entries |
| ภ.ง.ด.3 / 53 (WHT) | monthly | 7th / 15th e-file | has WHT entries |
| ภ.ง.ด.50 (CIT annual) | yearly | 150 days post-FY | `kind='corporate'` |
| ภ.ง.ด.51 (CIT half) | yearly | 60 days post-half-FY | `kind='corporate'` |
| ภ.ง.ด.90/91 (PIT) | yearly | Mar 31 | `kind='personal'` |

### Scheduled job

`filing-reminders` runs **daily at 08:00 ICT**. For each pending reminder due in
{7, 3, 1} days (configurable), it sends a LINE push (and/or email), then logs it so it
won't double-send. Scheduling via Supabase `pg_cron` calling the function, or an
external cron hitting the endpoint.

```
pg_cron 'invoke filing-reminders'  (daily 01:00 UTC = 08:00 ICT)
   │
   ▼ select reminders where due_date - now in (7,3,1) days
   │   and not already sent for that offset (check notification_log)
   ▼ for each → LINE push "ใกล้ถึงกำหนดยื่น ภ.พ.30 เดือน X — เหลือ 3 วัน"
   ▼ insert notification_log
```

---

## Secrets added

```
LINE_CHANNEL_SECRET=…          # Messaging API — for signature verify
LINE_CHANNEL_ACCESS_TOKEN=…    # Messaging API — for reply/push
LINE_LOGIN_CHANNEL_ID=…        # LINE Login
LINE_LOGIN_CHANNEL_SECRET=…    # LINE Login token exchange
LIFF_ID=…                      # LIFF app id
EMAIL_INBOUND_SIGNING_SECRET=… # inbound email provider webhook auth
```

## Security notes

- **LINE webhook**: always verify `X-Line-Signature` before processing. Drop unsigned.
- **line-auth**: runs with service role to mint sessions — never expose its logic to client; the client only ever sends the short-lived LINE auth `code`.
- **Email**: verify provider signature; treat all content as untrusted; OCR/parse in a
  sandboxed prompt; entries always land as draft.
- **PDPA**: `line_identities` stores LINE userId + display name only. Document retention
  in privacy policy; allow users to unlink + delete.
