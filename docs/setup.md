# Setup Guide

Step-by-step to get AppFinance running locally.

## 0. Prereqs

| Tool | Version | Why |
|---|---|---|
| Node | ≥ 20.10 | runtime |
| pnpm | ≥ 9 | monorepo package manager |
| Supabase CLI | ≥ 1.190 | local Postgres + edge fns |
| Xcode (macOS) | 15+ | iOS simulator |
| Android Studio | latest | Android emulator |
| Anthropic API key | — | AI features |

```bash
# pnpm
npm install -g pnpm

# Supabase CLI
brew install supabase/tap/supabase     # macOS
# or: scoop install supabase            # Windows
# or: npm install -g supabase           # all platforms (slower)
```

## 1. Clone & install

```bash
git clone <repo-url> AppFinance
cd AppFinance
pnpm install
```

## 2. Environment

```bash
cp .env.example .env.local
```

Fill in:
```
EXPO_PUBLIC_SUPABASE_URL=…          # http://127.0.0.1:54321 for local
EXPO_PUBLIC_SUPABASE_ANON_KEY=…     # from `supabase start` output
SUPABASE_SERVICE_ROLE_KEY=…         # same source — keep private
ANTHROPIC_API_KEY=sk-ant-…
CLAUDE_MODEL=claude-sonnet-4-6
```

## 3. Start Supabase locally

```bash
supabase start                       # boots Postgres + Auth + Storage on Docker
supabase db reset                    # applies all migrations + seed
```

Take note of the printed URLs/keys → paste into `.env.local`.

Verify schema:
```bash
supabase db diff                     # should show no drift
```

## 4. Serve edge functions

```bash
pnpm fn:serve                        # supabase functions serve --env-file ./.env.local
```

Functions exposed locally:
- `http://127.0.0.1:54321/functions/v1/chat-log`
- `http://127.0.0.1:54321/functions/v1/ocr-receipt`
- `http://127.0.0.1:54321/functions/v1/categorize`
- `http://127.0.0.1:54321/functions/v1/tax-advisor`

## 5. Run the mobile app

```bash
pnpm dev                             # opens Expo dev tools
# then press:
#   i = iOS simulator
#   a = Android emulator
#   w = web (limited)
```

Or on a real device: install **Expo Go** and scan the QR code (must be on same Wi-Fi as your machine; you may need to switch `SUPABASE_URL` to your machine's LAN IP, e.g. `http://192.168.1.x:54321`).

## 6. Create your first workspace

After signing up in the app:
```sql
-- run in Supabase Studio (http://127.0.0.1:54323)
insert into workspaces (name, kind, vat_registered)
values ('ส่วนตัว — Test User', 'personal', false);

insert into workspace_members (workspace_id, user_id, role)
values (
  (select id from workspaces where name like 'ส่วนตัว%' limit 1),
  (select id from auth.users limit 1),
  'owner'
);
```
(In v1 this will be done by an onboarding screen — current scaffold doesn't include it yet.)

## 7. Verify

Run the unit tests in `tax-core`:
```bash
pnpm --filter @appfinance/tax-core test
```

Typecheck everything:
```bash
pnpm typecheck
```

Run the database integration suite (migrations, RLS isolation, tax-ID encryption,
rate limit) against a throwaway Supabase Postgres container — needs Docker running:
```bash
pnpm test:db        # starts appfinance_testdb on :54339, applies every migration, runs vitest
```
Set `DB_TEST_URL` to point it at an existing empty database instead (e.g. in CI).

## 8. Deploy to production

```bash
# Database
supabase link --project-ref <YOUR_PROJECT_REF>
supabase db push

# Edge functions
supabase functions deploy --no-verify-jwt=false

# Set secrets (Claude API key)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-…
supabase secrets set CLAUDE_MODEL=claude-sonnet-4-6

# Mobile build
cd apps/mobile
eas build --platform ios            # or android
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL missing` warning | `.env.local` not loaded — restart Metro |
| Edge function returns 401 | client not authenticated; check `supabase.auth.getSession()` |
| OCR returns "Cannot read receipt" | RLS denied — verify user is in `workspace_members` |
| `Claude API 401` | `ANTHROPIC_API_KEY` not set in function secrets |
| iOS build fails on workspace path | run `cd apps/mobile && pod install` |

## 9. LINE setup

1. Create a **LINE Official Account** + a **Messaging API channel** at
   [developers.line.biz](https://developers.line.biz).
2. Create a **LINE Login channel** (same provider) and a **LIFF app** pointing to
   `https://<your-web-domain>/liff` (endpoint URL).
3. Put the secrets in your function env:
   ```
   LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN,
   LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_CHANNEL_SECRET, LIFF_ID
   ```
4. Deploy the LINE functions **without JWT verification** (LINE/the browser call them
   pre-auth; we verify the LINE signature instead):
   ```bash
   supabase functions deploy line-webhook --no-verify-jwt
   supabase functions deploy line-auth   --no-verify-jwt
   ```
5. Set the Messaging API **webhook URL** to
   `https://<ref>.supabase.co/functions/v1/line-webhook` and enable "Use webhook".
6. Upload the rich menu (needs a 2500x1686 image):
   ```bash
   LINE_CHANNEL_ACCESS_TOKEN=… LIFF_ID=… \
     pnpm line:richmenu ./apps/web/public/richmenu.png
   ```

## 10. Web app

```bash
cp apps/web/.env.example apps/web/.env.local   # fill NEXT_PUBLIC_* values
pnpm web                                        # http://localhost:3000
```
Set the LINE Login callback URL to `http://localhost:3000/auth/line/callback` (dev) and
your production URL when deploying (Vercel recommended).

## 11. Email ingestion

1. Pick an inbound provider (Postmark / SendGrid Inbound Parse / Cloudflare Email
   Workers) and point its inbound webhook at
   `https://<ref>.supabase.co/functions/v1/email-inbound`.
2. Set `EMAIL_INBOUND_SIGNING_SECRET` in both the provider and function env.
3. Route `inbox+*@in.appfinance.app` to the provider. Each workspace's address is
   `inbox+<email_token>@in.appfinance.app` (the token is auto-generated per workspace).
   ```bash
   supabase functions deploy email-inbound --no-verify-jwt
   ```

## 12. Scheduled reminders

After `supabase db push` applies `0006_cron.sql`, set the DB settings once per env:
```sql
alter database postgres set app.functions_url   = 'https://<ref>.supabase.co/functions/v1';
alter database postgres set app.service_role_key = '<service-role-key>';
```
```bash
supabase functions deploy filing-reminders --no-verify-jwt
```
Test it manually (no messages sent):
```bash
curl -X POST https://<ref>.supabase.co/functions/v1/filing-reminders \
  -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" -d '{"dryRun": true}'
```

## Next milestones (v2 backlog)

- Onboarding screen → create workspace + invite accountant
- Excel export of ภ.พ.30 / ภ.ง.ด.3/53
- PDF generation for ภ.ง.ด.90/91 cover sheet
- Bank statement import (Krungsri / SCB / KBank CSV)
- e-Tax Invoice / e-Receipt push to RD
