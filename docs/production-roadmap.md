# Production Roadmap

Honest assessment of what stands between the current build and a best-in-class
production launch. Updated as items land.

## ✅ Done

- Tax engine (PIT/CIT/VAT/WHT) + filing calendar, unit-tested
- Supabase schema + RLS (multi-tenant), storage buckets
- AI features: chat-log, OCR, categorize, tax-advisor
- Multi-provider LLM routing (Claude / Ollama / Typhoon) with text/reason/vision tiers
- Heuristic-first categorization, usage logging, monthly quota / freemium
- LINE (bot + Login + LIFF + rich menu), Next.js web, email ingestion, reminders
- **Hardening pass 1:**
  - AI output validated with Zod before DB insert (malformed → low-confidence draft)
  - LINE webhook idempotency (dedupe by webhookEventId) + fast-200 via `waitUntil`
  - line-auth uses the `line_identities` mapping (no paginated listUsers bug)
  - Email PDFs handled via Claude native document support (not broken image bytes)

- **Hardening pass 2** (2026-10-15):
  - DB integration suite `pnpm test:db` (33 tests, real `supabase/postgres` in Docker) + CI
  - 0010 fixed 5 holes the tests exposed — each reproduced against the old schema:
    workspace takeover via self-join-as-owner, owner self-upgrading `plan`,
    LINE `default_workspace` → cross-tenant writes, `ai_usage_month` leaking all
    workspaces, negative `ai_usage` cost cancelling the quota
  - tax-ID encryption (0011) and per-minute AI rate limit (0012) — see below

## 🔴 Blockers — can't open to real users without these

_All four mobile blockers are cleared — the core loop works end-to-end._

1. ~~**Onboarding flow**~~ ✅ `app/onboarding.tsx` + `create_workspace` RPC (atomic
   workspace+owner, avoids RLS chicken-egg); tabs layout redirects when no workspace;
   accountant invite via `invite_member_by_email` RPC.
2. ~~**Report export**~~ ✅ `generate-report` builds ภ.พ.30 .xlsx + accountant-pack .zip
   (all sheets + ภ.ง.ด.3/53 + receipts), uploads, returns signed URL; reports screen wired.
3. ~~**Entry review/edit screen**~~ ✅ `app/entry/[id].tsx` — edit, fix AI drafts, confirm,
   delete. Opened from the LINE flex button and the entries list.
4. ~~**Entry list/history + workspace switcher**~~ ✅ `app/entries.tsx` (filters) +
   `app/workspaces.tsx` (switch/create/invite); dashboard drafts badge + switcher button.

*Polish remaining:* report period picker (month/year defaults today), and **web parity**
— onboarding/entries/entry-edit currently exist only on mobile.

## 🟠 Security & correctness (before real money/data)

5. ~~**tax_id field encryption**~~ ✅ 0011 — implemented as planned below, with one
   change: the columns keep a mask (`*********1234`) instead of being dropped, so
   existing "has a TIN?" checks keep working. Entry edit screen + report export read the
   real value via `reveal_entry_tax_ids`. Search by full TIN no longer matches (last 4 only).
6. ~~**Integration + RLS tests**~~ ✅ `packages/db-tests` (DB layer). *Still missing:*
   edge-function happy/error-path tests (needs Deno + mocked LLM).
7. ~~**Rate limiting**~~ ✅ 0012 — 20/60/120 AI calls per minute per workspace
   (free/pro/unlimited), enforced in `enforceQuota`, returns 429.
8. **Auth hardening** — enable email confirmation, password reset, LINE email collisions.
9. **Error tracking** — Sentry (or similar) in app + edge functions; structured logs.

## 🟡 Domain accuracy (it's a tax app)

10. **CPA / professional review of all tax rules** — rates, caps, brackets in
    `tax-core/constants.ts` come from general knowledge; a Thai CPA must verify before
    launch. Add an in-app disclaimer that this isn't binding tax advice.
11. **Edge cases**: WHT individual vs juristic forms, VAT exempt vs zero-rated,
    non-calendar fiscal years, RD rounding rules.

### Deploy notes for 0010–0012

- Apply migrations **before** deploying the edge functions: `enforceQuota` now calls
  `consume_ai_rate_limit` and fails closed if it's missing.
- 0011 creates the Vault secret `pii_key` on first run. **Never delete or recreate it** —
  every stored TIN becomes unreadable. Supabase backups include the vault.
- 0010 revokes direct `insert` on `workspaces`; every client already uses
  `create_workspace`. Plan changes now need the service role (future billing webhook).

## ⚪ Ops & launch

12. CI/CD — ✅ CI (`.github/workflows/ci.yml`: typecheck, unit, DB tests). Still to do:
    CD (Supabase/Vercel/EAS deploys), staging environment, DB backups.
13. Monitoring/uptime/alerting.
14. PDPA: privacy policy, consent, data export + delete, unlink LINE.
15. App Store / Play Store assets + submission (icons, splash, privacy labels).

---

## Plan: tax_id encryption (item 5)

`workspaces.tax_id` and `entries.counterparty_tax_id` hold 13-digit TINs — PII under
PDPA. Today they're plaintext (RLS limits access, but at-rest encryption is expected).

**Recommended approach — pgcrypto symmetric (`pgp_sym_encrypt`)**

1. Store the key in Supabase Vault (or a DB setting `app.pii_key`), never in code.
2. Add encrypted columns and keep the API field name stable via a view/RPC:
   ```sql
   alter table entries add column counterparty_tax_id_enc bytea;
   -- write path: pgp_sym_encrypt($1, current_setting('app.pii_key'))
   -- read path : pgp_sym_decrypt(counterparty_tax_id_enc, current_setting('app.pii_key'))
   ```
3. Expose decryption only through a `security definer` function/view that re-checks
   workspace membership, so the key is never reachable from client SQL.
4. Backfill existing rows, then drop the plaintext column.

**Status:** shipped in 0011 (see item 5). Original note —
**Why not done in this pass:** it touches every read/write of the field across edge
functions and the app, and must be validated against a live database (the sandbox here
has no Postgres). It should be implemented as its own migration + code change with an
integration test asserting encrypt-on-write / decrypt-on-read and that the key never
leaks to a non-privileged role.

**Interim mitigation:** RLS already restricts the field to workspace members; the
private storage buckets and `entries_audit` trail are in place. Encryption raises the
bar for at-rest/backup exposure and should land before onboarding real customers.

---

## Suggested order

1. Onboarding + entry edit/review + workspace switcher (complete the core loop)
2. Report export ภ.พ.30 + accountant pack (unlock the headline value)
3. ~~tax_id encryption + integration/RLS tests~~ ✅ + Sentry (next)
4. CPA review + disclaimer + PDPA
5. CI/CD + staging → store submission
