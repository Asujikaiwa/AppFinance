# File Map

Quick reference to what lives where.

## Root

| File | Purpose |
|---|---|
| `package.json` | pnpm workspace root + scripts |
| `pnpm-workspace.yaml` | declares `apps/*` and `packages/*` |
| `tsconfig.base.json` | strict TS config inherited by all packages |
| `.env.example` | template for local secrets |
| `.gitignore` | ignores node_modules, .expo, .env, supabase tmp |
| `README.md` | landing |

## docs/

| File | Purpose |
|---|---|
| `architecture.md` | system diagram, data flow, multi-tenant model |
| `data-model.md` | every table, column, why bigint satang |
| `tax-rules-th.md` | PIT/CIT/VAT/WHT rates, brackets, filing dates |
| `integrations.md` | LINE (bot/login/LIFF/rich menu), web, email, notifications |
| `ai-providers.md` | multi-provider routing, hybrid strategy, local Ollama + Typhoon setup, costs |
| `setup.md` | step-by-step run instructions |
| `file-map.md` | this file |

## packages/tax-core/ (pure TS)

| File | Purpose |
|---|---|
| `src/index.ts` | barrel export |
| `src/types.ts` | Satang/Baht brands, PITInput/Result, etc. |
| `src/constants.ts` | brackets, rates, allowance caps — single source of truth |
| `src/money.ts` | bahtToSatang, splitInclusive, formatTHB |
| `src/pit.ts` | `calculatePIT`, expense allowance, bracket application |
| `src/cit.ts` | `calculateCIT`, SME qualification |
| `src/vat.ts` | `calculateVAT` monthly aggregator |
| `src/wht.ts` | `calculateWHT`, form mapping |
| `src/validators.ts` | TaxID Mod 11, VAT filing due dates |
| `src/categories.ts` | DEFAULT_CATEGORIES + heuristic guess |
| `src/schemas.ts` | Zod schemas shared with edge fns |
| `src/__tests__/*.test.ts` | vitest specs (run `pnpm test`) |

## supabase/

| File | Purpose |
|---|---|
| `config.toml` | local dev settings (ports, auth, storage) |
| `migrations/0001_init.sql` | tables: workspaces, entries, categories, attachments, reports, audit |
| `migrations/0002_rls.sql` | Row Level Security policies for all tables |
| `migrations/0003_seed_categories.sql` | trigger that seeds default COA on workspace insert |
| `migrations/0004_storage_buckets.sql` | `receipts` and `reports` buckets + access policies |
| `functions/_shared/cors.ts` | CORS helpers + `json()` / `errorResponse()` |
| `functions/_shared/llm.ts` | multi-provider router: `complete()` over Anthropic + OpenAI-compatible (Ollama/Typhoon/etc), text/reason/vision tiers |
| `functions/_shared/claude.ts` | back-compat shim over llm.ts — auto-routes legacy `callClaude` calls to text/vision tiers |
| `functions/_shared/auth.ts` | user-scoped + admin Supabase clients |
| `functions/_shared/prompts.ts` | system prompts for OCR/chat/categorize/advisor |
| `functions/chat-log/index.ts` | parse free-text → insert entry |
| `functions/ocr-receipt/index.ts` | vision OCR → insert entry + link attachment |
| `functions/categorize/index.ts` | re-categorize an existing entry |
| `functions/tax-advisor/index.ts` | grounded Q&A using YTD totals |

## apps/mobile/ (Expo)

| File | Purpose |
|---|---|
| `app.json` | Expo config: bundle ID, plugins, permissions |
| `package.json` | RN deps, scripts |
| `tsconfig.json` | path alias to `@appfinance/tax-core` |
| `babel.config.js` | NativeWind + Reanimated |
| `metro.config.js` | monorepo node_modules paths |
| `tailwind.config.js` | brand colors, Thai font |
| `global.css` | tailwind directives |
| `lib/supabase.ts` | client w/ SecureStore-backed session |
| `lib/api.ts` | typed wrappers for the 4 edge functions |
| `stores/workspace.ts` | Zustand: active workspace + list |
| `app/_layout.tsx` | root: QueryClient, gesture, auth redirect |
| `app/(auth)/login.tsx` | sign-in / sign-up |
| `app/(tabs)/_layout.tsx` | tab bar + initial workspace fetch |
| `app/(tabs)/index.tsx` | dashboard KPI cards (YTD totals) |
| `app/(tabs)/log.tsx` | camera / library → upload → OCR |
| `app/(tabs)/chat.tsx` | log-by-chat **and** tax-advisor in one screen |
| `app/(tabs)/reports.tsx` | generate ภ.พ.30 / accountant pack → open signed URL |
| `app/onboarding.tsx` | create first workspace (create_workspace RPC) |
| `app/entries.tsx` | entry list with filters (all/draft/income/expense) |
| `app/entry/[id].tsx` | entry detail: edit, confirm draft, delete |
| `app/workspaces.tsx` | switch active workspace, create new, invite accountant |
| `migrations/0009_workspace_rpcs.sql` | create_workspace + invite_member_by_email RPCs |

## packages/tax-core/ — added for integrations

| File | Purpose |
|---|---|
| `src/calendar.ts` | filing due-date calculator (ภ.พ.30 / ภ.ง.ด. monthly + annual) |
| `src/__tests__/calendar.test.ts` | due-date specs |

## supabase/ — added for integrations

| File | Purpose |
|---|---|
| `migrations/0005_line_and_notifications.sql` | line_identities, reminders, notification_log, inbound_emails, workspace email_token |
| `migrations/0006_cron.sql` | pg_cron schedule for daily filing-reminders |
| `functions/_shared/line.ts` | LINE Messaging + Login client, signature verify, Flex builders |
| `functions/_shared/line-richmenu.ts` | rich menu (3x2 grid) definition |
| `functions/_shared/extract.ts` | extraction hub: quota → tier routing → usage logging → heuristic fill; used by all channels |
| `functions/_shared/heuristic.ts` | free keyword→category matcher (tried before AI); mirrors tax-core categories |
| `functions/_shared/calendar.ts` | Deno-native copy of filing calendar (edge can't bundle tax-core .js specifiers) |
| `functions/_shared/usage.ts` | cost estimation, `logUsage`, `monthlyCostSatang`, `enforceQuota`, PLAN_LIMITS |
| `functions/_shared/reports.ts` | pure builders: ภ.พ.30 summary, sales/purchase VAT reports, WHT report, full ledger (as sheet AoA) |
| `functions/_shared/validation.ts` | Zod validation of AI output → malformed becomes low-confidence draft |
| `functions/generate-report/index.ts` | builds ภ.พ.30 .xlsx / accountant-pack .zip (SheetJS + JSZip), uploads, returns signed URL |
| `migrations/0007_ai_usage.sql` | ai_usage table + RLS + workspaces.plan + ai_usage_month view |
| `functions/line-webhook/index.ts` | LINE bot: text/image → entry, postback, follow, account-link prompt |
| `functions/line-auth/index.ts` | LINE Login/LIFF token exchange → Supabase session |
| `functions/email-inbound/index.ts` | inbound email → OCR attachments / parse body → draft entries |
| `functions/filing-reminders/index.ts` | scheduled: generate reminders + push LINE alerts |

## scripts/

| File | Purpose |
|---|---|
| `setup-line-richmenu.ts` | one-off: create + upload + set default rich menu |

## apps/web/ (Next.js)

| File | Purpose |
|---|---|
| `next.config.mjs` | transpiles tax-core, externalDir for monorepo |
| `middleware.ts` | refreshes Supabase session, guards /dashboard |
| `lib/supabase/client.ts` / `server.ts` | SSR-aware Supabase clients |
| `lib/liff.ts` | LIFF init + sign-in via line-auth |
| `app/page.tsx` | marketing landing |
| `app/login/page.tsx` | email + LINE Login |
| `app/auth/line/callback/page.tsx` | LINE OAuth redirect handler |
| `app/dashboard/page.tsx` | server-rendered KPI + upcoming reminders |
| `app/liff/link/page.tsx` | LIFF account-linking + workspace picker |

## Security & tests — hardening pass 2

| File | Purpose |
|---|---|
| `supabase/migrations/0010_rls_hardening.sql` | closes workspace takeover, plan self-upgrade, LINE cross-tenant write, usage-view leak, negative-cost quota bypass |
| `supabase/migrations/0011_pii_encryption.sql` | tax IDs encrypted (pgcrypto, key in Vault); columns keep a mask; `reveal_entry_tax_ids` / `reveal_workspace_tax_id` RPCs |
| `supabase/migrations/0012_rate_limit.sql` | per-minute AI limit per workspace (`consume_ai_rate_limit`), called from `enforceQuota` |
| `packages/db-tests/` | `pnpm test:db` — vitest + pg against `supabase/postgres` in Docker; `src/db.ts` has `asUser`/`asService` helpers |
| `.github/workflows/ci.yml` | typecheck + unit tests + DB integration tests |

## What's NOT here (planned for v2)

- Web parity for onboarding / entries / entry-edit (mobile-only today)
- Report period picker (reports use month/year defaults)
- Accountant connectors (FlowAccount/PEAK/Express) — design in integrations.md, not built
- E2E tests (Detox or Maestro)
- App icons, splash, rich-menu image asset
