# AppFinance

AI-powered Thai tax bookkeeping. Snap a receipt or type a one-liner — the app categorizes it, computes VAT/WHT, and produces filing-ready reports (ภ.พ.30, ภ.ง.ด.1/3/53, ภ.ง.ด.50/90/91).

## Stack

- **Mobile**: Expo + React Native + TypeScript + Expo Router + NativeWind
- **Web**: Next.js 14 (App Router) — marketing, accountant dashboard, LIFF host
- **LINE**: Messaging API chatbot + LINE Login + LIFF + Rich Menu
- **Backend**: Supabase (Postgres + Auth + Storage + Edge Functions)
- **AI**: Claude API (OCR, chat logging, categorization, tax advice)
- **Notifications**: scheduled filing-deadline reminders pushed via LINE
- **Email**: per-workspace inbound address ingests emailed invoices
- **Shared**: `packages/tax-core` — pure TS tax engine + filing calendar

See [`docs/architecture.md`](docs/architecture.md) and
[`docs/integrations.md`](docs/integrations.md) for the full design.

## Channels

Users reach AppFinance three ways, all backed by the same engine:

1. **LINE** — forward a receipt photo or type "จ่ายค่าน้ำมัน 1,200" to the OA → logged
2. **Mobile app** — full Expo app with camera capture
3. **Web** — Next.js dashboard for accountants reviewing many entries

## Project layout

```
AppFinance/
├── apps/mobile/          # Expo app (iOS + Android)
├── apps/web/             # Next.js (marketing + dashboard + LIFF)
├── packages/tax-core/    # Pure tax calc engine + filing calendar
├── supabase/             # Migrations + edge functions (incl. LINE, email, reminders)
├── scripts/              # One-off ops (LINE rich menu upload)
└── docs/                 # Architecture, integrations, data model, tax reference
```

## Quickstart

```bash
# 1. Install
pnpm install

# 2. Copy env
cp .env.example .env.local
#  fill in Supabase + Anthropic keys

# 3. Init Supabase (one-time)
supabase init
supabase start              # local dev
supabase db push            # apply migrations
supabase functions serve    # run edge functions locally

# 4. Run the app
pnpm dev                    # then press i (iOS) or a (Android)
```

## Tests

```bash
pnpm -r test                # tax-core unit tests
pnpm typecheck              # whole monorepo
```

## Status

Work in progress — v1 scaffold. See `docs/architecture.md` § "Out of Scope" for non-goals.
