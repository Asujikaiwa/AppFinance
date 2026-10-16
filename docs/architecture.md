# AppFinance — Architecture

> AI-powered Thai tax bookkeeping app for freelancers, SMEs, and accounting firms.

## Goals

1. **บันทึกง่าย** — พิมพ์ chat / ถ่ายรูปใบเสร็จ → AI แปลงเป็น record อัตโนมัติ
2. **คำนวณถูก** — Pure tax engine ที่ทดสอบได้ ตรงตามประมวลรัษฎากร
3. **ส่งต่อบัญชีได้ทันที** — Export ภ.พ.30, ภ.ง.ด.1/3/53, ภ.ง.ด.50/90/91 + Excel raw
4. **Multi-tenant** — 1 user ดูแลได้หลาย workspace (ส่วนตัว + บริษัท)

## Tech Stack

```
┌──────────────────────────────────────────────────────────┐
│  Mobile (Expo / React Native + TypeScript)              │
│  ├─ Expo Router (file-based)                            │
│  ├─ NativeWind (Tailwind)                               │
│  ├─ Zustand (UI state) + TanStack Query (server)        │
│  └─ Supabase JS client                                  │
└────────────────────┬─────────────────────────────────────┘
                     │ HTTPS / Realtime
┌────────────────────▼─────────────────────────────────────┐
│  Supabase                                                │
│  ├─ Postgres 15 + Row Level Security (multi-tenant)     │
│  ├─ Auth (email, OAuth)                                 │
│  ├─ Storage (receipt images, signed URLs)               │
│  └─ Edge Functions (Deno) → Claude API                  │
│        ├─ ocr-receipt                                   │
│        ├─ chat-log                                      │
│        ├─ categorize                                    │
│        └─ tax-advisor                                   │
└────────────────────┬─────────────────────────────────────┘
                     │
              ┌──────▼──────┐
              │  Claude API │  (Sonnet 4.6)
              └─────────────┘
```

## Folder Layout

```
AppFinance/
├── apps/mobile/              # Expo app
├── packages/tax-core/        # Pure TS tax engine (shared)
├── supabase/                 # Migrations + edge functions
│   ├── migrations/
│   └── functions/
├── docs/                     # This folder
└── package.json              # pnpm workspace root
```

## Multi-tenant Model

- **`auth.users`** (Supabase built-in) — 1 person, 1 row
- **`workspaces`** — a tax-paying entity (personal or company)
- **`workspace_members`** — N:N link with `role` (owner / accountant / viewer)
- **All business tables** (`entries`, `categories`, `reports`) carry `workspace_id`
- **RLS** policies require `workspace_id` ∈ `(SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())`

Switching workspace in the app = setting an active `workspace_id` in Zustand store; all queries scope to it.

## Core Data Flow

### Logging an expense by chat
```
User types "จ่ายค่าน้ำมัน 1,200 ที่ ปตท. ใบเสร็จ A-123"
   │
   ▼
Mobile → POST /functions/v1/chat-log {message, workspace_id}
   │
   ▼
Edge function → Claude API (structured JSON output)
   │
   ▼  { date, vendor, taxId?, items[], vatAmount, total, suggestedCategory }
   │
Edge function inserts `entries` row, returns saved entry
   │
   ▼
Mobile shows confirmation card; entry appears in dashboard
```

### Logging by photo (OCR)
```
User snaps receipt → upload to Supabase Storage
   │
   ▼
Mobile → POST /functions/v1/ocr-receipt {storage_path, workspace_id}
   │
   ▼
Edge function → Claude API (vision, structured JSON)
   │
   ▼  Same shape as chat-log
   │
Insert + return → review screen for user to confirm
```

### Auto-categorize
Runs on every new entry that has no category yet — assigns COA bucket + flags deductibility.

### Tax planning advisor
On-demand chat with full year-to-date context (income totals, expenses by category, planned deductions) — outputs scenarios.

## Security & Compliance

- **Auth**: Supabase Auth, JWT, refresh tokens stored in `expo-secure-store`
- **RLS**: every table enforces workspace membership
- **PII**: Tax IDs encrypted at rest (pgcrypto), receipts in private bucket with short-lived signed URLs
- **Audit log**: `entries_audit` table tracks all create/update/delete with `user_id` + `actor_role`
- **No client-side API keys** — Claude API key lives only in edge functions

## Tax Engine (`packages/tax-core`)

Pure functions, no I/O. All Thai tax rules live here so they're unit-testable.

```ts
calculatePIT(input: PITInput): PITResult
calculateCIT(input: CITInput): CITResult
calculateVAT(period: VATPeriod): VATResult
calculateWHT(payment: PaymentInput): WHTResult
validateTaxId(id: string): boolean
categorize(description: string): CategoryGuess  // heuristic, AI does the smart version
```

All amounts are stored as **integer satang** (1 baht = 100 satang) to avoid float errors.

## Reports

| Report | Source | Output |
|---|---|---|
| ภ.พ.30 (VAT monthly) | `entries` where doc_type='tax_invoice' | Excel + summary |
| ภ.ง.ด.3 / 53 (WHT) | `entries` with `wht_amount > 0` | Excel grouped by vendor |
| ภ.ง.ด.90/91 (PIT) | `entries` for personal workspace, by year | PDF cover + Excel detail |
| ภ.ง.ด.50/51 (CIT) | `entries` for corporate workspace, by FY | Excel P&L + adj schedule |
| Accountant package | All above zipped | ZIP with PDFs + Excel + receipt images |

## Out of Scope (v1)

- e-Tax Invoice / e-Receipt submission to RD
- Payroll calculation
- Inventory / cost of goods sold tracking
- Real bank-feed integration (manual import only)
