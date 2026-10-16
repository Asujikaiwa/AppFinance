# Data Model

All money columns are **`bigint` in satang** (1 baht = 100 satang) — never float.
All timestamps are `timestamptz` in UTC. Dates are `date` (no TZ).

## ER Diagram (logical)

```
auth.users (Supabase)
    │
    │  M:N via workspace_members
    ▼
workspaces ──── 1:N ──── entries ──── N:1 ──── categories
    │                       │
    │                       └── 1:N ──── attachments
    │
    └── 1:N ──── reports
```

## Tables

### `workspaces`
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text | "ส่วนตัว — สมชาย", "บริษัท ABC จำกัด" |
| kind | text | `personal` \| `corporate` |
| tax_id | text | 13-digit TIN, encrypted |
| vat_registered | boolean | |
| fiscal_year_start | smallint | month (1-12), default 1 |
| created_at | timestamptz | |

### `workspace_members`
| col | type | notes |
|---|---|---|
| workspace_id | uuid FK | |
| user_id | uuid FK auth.users | |
| role | text | `owner` \| `accountant` \| `viewer` |
| PK | (workspace_id, user_id) | |

### `categories`
Reusable per workspace; seeded with Thai-standard COA on workspace creation.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | |
| code | text | e.g. "5100-01" |
| name_th | text | "ค่าน้ำมันรถ" |
| name_en | text | "Fuel" |
| direction | text | `income` \| `expense` |
| deductible | boolean | for CIT/PIT |
| default_wht_rate | numeric(5,4) | nullable |
| vat_applicable | boolean | |

### `entries`
The transactional record.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | |
| direction | text | `income` \| `expense` |
| entry_date | date | doc date |
| doc_type | text | `tax_invoice_full` \| `tax_invoice_abbr` \| `receipt` \| `invoice` \| `other` |
| doc_number | text | |
| counterparty_name | text | |
| counterparty_tax_id | text | encrypted |
| description | text | |
| category_id | uuid FK | nullable until categorized |
| amount_excl_vat | bigint | satang |
| vat_amount | bigint | satang |
| amount_total | bigint | = excl + vat, GENERATED |
| wht_rate | numeric(5,4) | |
| wht_amount | bigint | satang |
| is_deductible | boolean | mirrors category at time of entry |
| source | text | `manual` \| `chat` \| `ocr` \| `import` |
| ai_confidence | numeric(3,2) | 0.00–1.00, null if manual |
| status | text | `draft` \| `confirmed` \| `locked` (after period close) |
| created_by | uuid FK auth.users | |
| created_at, updated_at | timestamptz | |

### `attachments`
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| entry_id | uuid FK | |
| storage_path | text | Supabase Storage object key |
| mime_type | text | |
| ocr_text | text | raw OCR output for audit |
| created_at | timestamptz | |

### `reports`
Generated artifact log.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | |
| kind | text | `pp30` \| `png3` \| `png53` \| `png90` \| `png91` \| `png50` \| `accountant_pack` |
| period_start | date | |
| period_end | date | |
| storage_path | text | generated file location |
| meta | jsonb | summary numbers |
| created_at | timestamptz | |

### `entries_audit`
Append-only audit trail. Insert via trigger on `entries`.

## Why `bigint` satang, not `numeric`

- Postgres `numeric` is exact but slow and serializes awkwardly to JS
- JS `number` is float — VAT × 7% on 1,234.56 produces sub-cent errors
- `bigint` satang gives exact math, fits in JS safe integer range up to ~90 trillion baht
- Display layer formats with `Intl.NumberFormat('th-TH', {style: 'currency', currency: 'THB'})`
