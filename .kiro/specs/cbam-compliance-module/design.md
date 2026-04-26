# Design Document: CBAM Compliance Module

## Overview

The CBAM Compliance Module extends the Tefnut platform to satisfy EU Carbon Border Adjustment Mechanism obligations (Regulation 2023/956). It transforms Tefnut from a monitoring tool into a legal bridge to the European market by:

1. Computing Specific Embedded Emissions (SEE) per Article 7 with explicit Direct/Indirect separation per Article 19
2. Applying a Carbon Price Paid credit per Article 46 with automated ECB currency conversion
3. Mapping cement products to CN Code 2523 sub-headings
4. Generating a SHA-256-verified CBAM Declaration export per Article 47
5. Automatically syncing the weekly EU ETS auction price per Article 23
6. Displaying a Net Financial Impact card on the dashboard

The module is built as a new Python module (`cbam_engine.py`) that wraps the existing `carbon_engine.py`, a background cron service (`weekly_price_sync.py`), a currency conversion layer, two new API routes, and two new React components. It reuses the existing SHA-256 audit infrastructure, RDS PostgreSQL with RLS, S3 with SSE-KMS, and the TanStack Start frontend.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Frontend (TanStack Start / React + TypeScript)                  │
│  • CBAMDeclarationButton.tsx — triggers POST /api/cbam/declaration│
│  • NetFinancialImpactCard.tsx — real-time financial summary       │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTP
┌────────────────────────────▼─────────────────────────────────────┐
│  API Routes (TanStack Start server functions)                    │
│  • POST /api/cbam/calculate   → calls cbam_engine.calculate()    │
│  • POST /api/cbam/declaration → calls cbam_engine.generate_declaration()│
│    stores GeneratedReport, uploads to S3                         │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│  CBAM Engine (cbam_engine.py)                                    │
│  • CBAMInput (extends PlantInput)                                │
│  • CBAMResult (Pydantic V2)                                      │
│  • Pipeline: validate → fetch ETS price → convert currency       │
│              → calculate SEE → calculate certificate obligation  │
│              → assemble declaration → hash                       │
└──────┬─────────────────────┬────────────────────────────────────┘
       │                     │
┌──────▼──────┐   ┌──────────▼──────────────────────────────────┐
│ Carbon      │   │  Data Layer (Amazon RDS PostgreSQL + RLS)    │
│ Engine      │   │  • cbam_ets_price_history                    │
│ (existing)  │   │  • cbam_fx_rates                             │
└─────────────┘   │  • generated_reports (existing, reused)      │
                  └──────────────────────────────────────────────┘
                             │
                  ┌──────────▼──────────────────────────────────┐
                  │  Background Services                         │
                  │  • Weekly_Price_Sync (cron, Monday 06:00 UTC)│
                  │  • Currency_Conversion_Layer (ECB API)       │
                  └─────────────────────────────────────────────┘
                             │
                  ┌──────────▼──────────────────────────────────┐
                  │  Amazon S3 (SSE-KMS)                         │
                  │  cbam/{facility_id}/{year}/{sha256}.json     │
                  └─────────────────────────────────────────────┘
```

### Key Design Decisions

1. **CBAM Engine wraps Carbon Engine** — `CBAMEngine` calls `CarbonEngine.calculate()` internally and maps `scope1`/`scope2` outputs to CBAM Direct/Indirect emission fields. This avoids duplicating calculation logic.

2. **No manual ETS price field** — `CBAMInput` deliberately omits a certificate price field. The engine always reads from `cbam_ets_price_history`, enforcing Article 23 compliance.

3. **Idempotent declaration hash** — the SHA-256 is computed over `json.dumps(declaration, sort_keys=True, ensure_ascii=False)`, guaranteeing reproducibility regardless of key insertion order.

4. **Currency conversion caches in DB** — ECB rates are stored in `cbam_fx_rates` with a `rate_date` key, enabling fallback to the last known rate without repeated external calls.

5. **GeneratedReport reuse** — CBAM declarations are stored as `report_type="cbam_annual"` in the existing `generated_reports` table, inheriting all existing RLS policies and audit infrastructure.

---

## Components and Interfaces

### `cbam_engine.py` — Pydantic V2 Input Models

```python
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, model_validator
from carbon_engine.carbon_engine import PlantInput

class KilnProcessType(str, Enum):
    DRY_KILN = "dry_kiln"
    WET_KILN = "wet_kiln"
    SEMI_DRY_KILN = "semi_dry_kiln"
    DRY_KILN_PH_PC = "dry_kiln_ph_pc"   # Primary benchmark — PH/PC

class ProductionProcess(BaseModel):
    process_type: KilnProcessType
    kiln_capacity_t_clinker_per_day: float = Field(..., gt=0)
    annual_operating_hours: float = Field(..., ge=1, le=8760)
    clinker_to_cement_ratio: float = Field(..., ge=0.0, le=1.0)

class CarbonPricePaid(BaseModel):
    amount: float = Field(..., ge=0.0)
    currency_code: str = Field(..., min_length=3, max_length=3)  # ISO 4217

class CBAMInput(PlantInput):
    """Extends PlantInput with CBAM-specific fields. No manual certificate price."""
    product_type: str
    imported_quantity_t: float = Field(..., gt=0)
    carbon_price_paid: CarbonPricePaid
    transaction_date: Optional[str] = None   # ISO-8601 date; None → use latest ECB rate
    installation_latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    installation_longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)
    production_process: ProductionProcess
    declarant_eori: str
    reporting_year: int = Field(..., ge=2026)   # CBAM obligation starts 2026
```

### `cbam_engine.py` — Pydantic V2 Output Models

```python
class SEEBreakdown(BaseModel):
    direct_emissions_t: float
    indirect_emissions_t: float
    total_embedded_co2e_t: float
    specific_embedded_emissions_t_per_t: float   # rounded to 6 d.p.

class DirectEmissions(BaseModel):
    calcination_co2_t: float
    fuel_combustion_co2_t: float
    total_direct_co2_t: float
    regulatory_classification: str = "Article 19 - Direct"

class IndirectEmissions(BaseModel):
    electricity_co2_t: float
    total_indirect_co2_t: float
    regulatory_classification: str = "Article 19 - Indirect"

class CarbonPriceCredit(BaseModel):
    original_amount: float
    original_currency: str
    exchange_rate_eur: float
    rate_date: str
    carbon_price_paid_eur_per_t_co2e: float
    imported_quantity_t: float
    credit_amount_eur: float
    net_cbam_obligation_certificates: float   # floored at 0.0

class ETSPriceReference(BaseModel):
    price_eur_per_t_co2e: float
    week_start_date: str
    source_url: str
    is_stale: bool   # True if > 14 days old

class CNClassification(BaseModel):
    cn_code: str
    product_type: str
    cn_description: str
    cbam_in_scope: bool

class InstallationMetadata(BaseModel):
    installation_name: str
    latitude: float
    longitude: float
    country: str
    production_process: ProductionProcess
    reporting_period: str

class CBAMResult(BaseModel):
    see_breakdown: SEEBreakdown
    direct_emissions: DirectEmissions
    indirect_emissions: IndirectEmissions
    carbon_price_credit: CarbonPriceCredit
    ets_price_reference: ETSPriceReference
    cn_classification: CNClassification
    installation_metadata: InstallationMetadata
    declaration_sha256: str
    compliance_warnings: list[str] = Field(default_factory=list)
    validation_warnings: list[dict] = Field(default_factory=list)
```

### `CBAMEngine` Class

```python
class CBAMEngine:
    def __init__(self, cbam_input: CBAMInput, db: TenantDb) -> None:
        self.cbam_input = cbam_input
        self.db = db

    def calculate(self) -> CBAMResult: ...
    def generate_declaration(self) -> tuple[dict, CBAMResult]: ...
```

The `db` parameter is the tenant-scoped `TenantDb` from `pg-client.ts` (passed via the API route handler). The engine uses it to read from `cbam_ets_price_history` and `cbam_fx_rates`.

### CN Code Mapping (static dict in `cbam_engine.py`)

```python
CN_CODE_MAP: dict[str, tuple[str, str]] = {
    "cement_clinker":       ("2523 10", "Cement clinker"),
    "white_cement":         ("2523 21", "White Portland cement"),
    "other_portland_cement":("2523 29", "Other Portland cement"),
    "aluminous_cement":     ("2523 30", "Aluminous cement"),
    "other_hydraulic_cement":("2523 90", "Other hydraulic cements"),
}
```

### `weekly_price_sync.py` — Background Cron Service

```python
class WeeklyPriceSync:
    """
    Runs every Monday at 06:00 UTC.
    Fetches EU ETS weekly average auction price and upserts into cbam_ets_price_history.
    Idempotent: upsert on week_start_date.
    """
    ETS_API_URL = "https://www.eex.com/en/market-data/environmental-markets/..."  # EU ETS registry

    def run(self, db: TenantDb) -> None: ...
    def _fetch_price(self) -> tuple[float, str]: ...   # (price, source_url)
    def _upsert_price(self, db, week_start_date, price, source_url): ...
```

### `currency_conversion.py` — ECB Exchange Rate Layer

```python
ECB_API_URL = "https://data-api.ecb.europa.eu/service/data/EXR/D.{currency}.EUR.SP00.A"

class CurrencyConversionLayer:
    def get_rate_to_eur(
        self,
        currency_code: str,
        rate_date: Optional[str],
        db: TenantDb,
    ) -> tuple[float, str]:
        """
        Returns (rate_to_eur, actual_rate_date).
        1. Try cbam_fx_rates cache for the requested date.
        2. If miss, fetch from ECB API and cache.
        3. If ECB unavailable, fall back to most recent cached rate + warning.
        """
        ...
```

### API Routes

```typescript
// POST /api/cbam/calculate
// Body: CBAMInput JSON
// Returns: CBAMResult JSON
export const POST = createServerFn({ method: "POST" })
  .handler(async ({ request }) => {
    const { orgId } = resolveTenantContext(request);
    const body = await request.json();
    return withTenant(orgId, async (db) => {
      const result = await callCBAMEngine(body, db);
      return result;
    });
  });

// POST /api/cbam/declaration
// Body: CBAMInput JSON
// Returns: { declaration: CBAMDeclaration, result: CBAMResult, report_id: string }
export const POST = createServerFn({ method: "POST" })
  .handler(async ({ request }) => {
    const { orgId, userId } = resolveTenantContext(request);
    const body = await request.json();
    return withTenant(orgId, async (db) => {
      const { declaration, result } = await callCBAMDeclaration(body, db);
      const reportId = await storeDeclaration(orgId, userId, declaration, result, db);
      await uploadToS3(declaration, result, body.facility_id, body.reporting_year);
      return { declaration, result, report_id: reportId };
    });
  });
```

### Frontend Components

**`CBAMDeclarationButton.tsx`**
- Calls `POST /api/cbam/declaration`
- On success: triggers browser download of `cbam_declaration_{facility}_{year}.json`
- Displays `declaration_sha256` hash in a copyable badge below the button
- Shows loading spinner during generation

**`NetFinancialImpactCard.tsx`**
- Reads `CBAMResult` from parent state (updated on every `POST /api/cbam/calculate` call)
- Displays three line items: Gross EU Obligation, Domestic Credit, Net Payable (all EUR, 2 d.p., thousand separators)
- Shows `Weekly_ETS_Price` and `week_start_date` as a footnote
- When `Net Payable = 0.0`: renders green notice "Full credit applied — no net CBAM payment required"
- Role-gated: `viewer` role sees redacted values with contact message

---

## Data Models

### New Database Tables

```sql
-- EU ETS weekly auction price history
CREATE TABLE cbam_ets_price_history (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    week_start_date  DATE NOT NULL UNIQUE,   -- upsert key
    price_eur_per_t_co2e NUMERIC(10,4) NOT NULL,
    source_url       TEXT NOT NULL,
    fetched_at_utc   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ECB exchange rate cache
CREATE TABLE cbam_fx_rates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    currency_code CHAR(3) NOT NULL,          -- ISO 4217
    rate_date     DATE NOT NULL,
    rate_to_eur   NUMERIC(18,8) NOT NULL,
    fetched_at_utc TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (currency_code, rate_date)        -- upsert key
);
```

### `GeneratedReport` Reuse

CBAM declarations are stored in the existing `generated_reports` table:

| Field | Value |
|---|---|
| `report_type` | `"cbam_annual"` |
| `sha256_hash` | `declaration_sha256` |
| `report_json` | Full `CBAMDeclaration` JSON |
| `storage_key` | `cbam/{facility_id}/{reporting_year}/{declaration_sha256}.json` |
| `standards_cited` | `["EU Regulation 2023/956", "CBAM Implementing Regulation 2023/1773", "GCCA Cement CO2 and Energy Protocol v3.1"]` |

### CBAM Declaration JSON Structure

```json
{
  "template_version": "EU_CBAM_TRANSITIONAL_2024",
  "declaration_metadata": {
    "reporting_period": "2026",
    "submission_date": "2027-05-31",
    "declarant_eori": "EG123456789"
  },
  "installation_metadata": { ... },
  "cn_classification": { ... },
  "see_breakdown": { ... },
  "direct_emissions": { ... },
  "indirect_emissions": { ... },
  "carbon_price_credit": { ... },
  "covered_gases": ["CO2", "N2O", "PFCs"],
  "compliance_warnings": ["Non-CO2 GHGs (N2O, PFCs) are negligible..."],
  "standards_cited": ["EU Regulation 2023/956", "CBAM Implementing Regulation 2023/1773", "GCCA Cement CO2 and Energy Protocol v3.1"]
}
```

### Declaration Hash Computation

```python
import hashlib, json

declaration_json = json.dumps(declaration, sort_keys=True, ensure_ascii=False)
declaration_sha256 = hashlib.sha256(declaration_json.encode("utf-8")).hexdigest()
```

### CBAM Calculation Pipeline

```
1. validate(CBAMInput)                          → ValidationResult (block if invalid)
2. fetch_ets_price(db)                          → ETSPriceReference
3. convert_currency(carbon_price_paid, db)      → (rate_to_eur, rate_date)
4. run_carbon_engine(PlantInput)                → CalculationResult
5. calculate_see(scope1, scope2, production_t)  → SEEBreakdown
6. calculate_certificate_obligation(see, qty, ets_price, credit_eur) → CarbonPriceCredit
7. assemble_declaration(all above)              → CBAMDeclaration dict
8. hash_declaration(declaration)                → declaration_sha256
9. return CBAMResult
```

### SEE Calculation

```
direct_emissions_t   = scope1.total_scope1_co2_t
indirect_emissions_t = scope2.electricity_co2_t
total_embedded_co2e_t = direct_emissions_t + indirect_emissions_t
SEE = round(total_embedded_co2e_t / cement_production_t_yr, 6)   # t CO2e / t product
```

### Certificate Obligation Calculation

```
carbon_price_paid_eur = carbon_price_paid.amount × exchange_rate_to_eur
gross_obligation      = SEE × imported_quantity_t × ets_price_eur_per_t
credit_certificates   = (carbon_price_paid_eur × imported_quantity_t) / ets_price_eur_per_t
net_obligation        = max(0.0, gross_obligation - credit_certificates)
```

### S3 Storage Key

```
cbam/{facility_id}/{reporting_year}/{declaration_sha256}.json
```

Encryption: SSE-KMS (inherits existing bucket policy from `infra/s3-bucket-policy.json`).

### Duplicate Declaration Detection

Before inserting a new `GeneratedReport`, the API route queries:

```sql
SELECT id FROM generated_reports
WHERE facility_id = $1
  AND reporting_year = $2
  AND sha256_hash = $3
  AND report_type = 'cbam_annual'
LIMIT 1;
```

If a row is found, the existing record is returned with warning code `CBAM_DECLARATION_ALREADY_EXISTS`.


---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

Before listing properties, redundancies are eliminated:

- Requirements 1.3, 2.1, and 2.2 all test the same mapping from Carbon Engine scope1/scope2 to CBAM direct/indirect fields. These are combined into one comprehensive emission mapping property.
- Requirements 1.1 and 1.2 (SEE arithmetic and rounding) are combined: if the arithmetic is correct and rounded to 6 d.p., both are satisfied.
- Requirements 3.3 and 3.4 (currency conversion arithmetic and certificate obligation formula) are kept separate — they test different arithmetic paths.
- Requirements 6.2 and 6.3 (hash computation and idempotence) are combined: if the hash is reproducible for any input, both are satisfied.
- Requirements 4.2 and 4.5 (CN code lookup and in-scope validation) are combined: if the lookup returns the correct code and cbam_in_scope=True for all 2523 codes, both are satisfied.
- Requirements 8.1 and 8.6 (validation gate and idempotence) are kept separate — they test different aspects of validation.
- Requirements 9.6 (sync idempotence) and 7.4 (declaration storage idempotence) are kept separate — they test different layers.
- Requirement 10.5 (EUR formatting) is kept as a standalone property for the formatting utility function.

---

### Property 1: SEE arithmetic and six-decimal precision

*For any* valid `CBAMInput` where `cement_production_t_yr > 0`, the `see_breakdown.specific_embedded_emissions_t_per_t` in the `CBAMResult` must equal `round((scope1.total_scope1_co2_t + scope2.electricity_co2_t) / cement_production_t_yr, 6)` within a floating-point tolerance of 1e-9.

**Validates: Requirements 1.1, 1.2**

---

### Property 2: Emission mapping from Carbon Engine to CBAM fields

*For any* valid `CBAMInput`, the `CBAMResult` must satisfy: `direct_emissions.calcination_co2_t == scope1.calcination_co2_t`, `direct_emissions.fuel_combustion_co2_t == scope1.fuel_combustion_co2_t`, `direct_emissions.total_direct_co2_t == scope1.total_scope1_co2_t`, and `indirect_emissions.electricity_co2_t == scope2.electricity_co2_t`.

**Validates: Requirements 1.3, 2.1, 2.2**

---

### Property 3: Direct emissions components sum to total

*For any* valid `CBAMResult`, `abs(direct_emissions.calcination_co2_t + direct_emissions.fuel_combustion_co2_t - direct_emissions.total_direct_co2_t)` must be less than or equal to `0.01`.

**Validates: Requirements 2.3**

---

### Property 4: N2O and PFC are always zero for CN 2523 products

*For any* valid `CBAMInput` with a `product_type` that maps to a CN code under heading 2523, the `CBAMResult` must have N2O and PFC values set to `0.0`, and `compliance_warnings` must contain the GCCA v3.1 protocol text.

**Validates: Requirements 1.6**

---

### Property 5: Currency conversion arithmetic

*For any* valid `(amount >= 0, exchange_rate_to_eur > 0)` pair, `carbon_price_credit.carbon_price_paid_eur_per_t_co2e` must equal `amount × exchange_rate_to_eur` within a tolerance of 1e-6.

**Validates: Requirements 3.3**

---

### Property 6: Certificate obligation formula and non-negativity

*For any* valid `CBAMInput`, the `net_cbam_obligation_certificates` must equal `max(0.0, (SEE × imported_quantity_t) - (carbon_price_paid_eur × imported_quantity_t / ets_price_eur_per_t))`, and must never be negative.

**Validates: Requirements 3.4, 3.5**

---

### Property 7: CN code lookup correctness and in-scope flag

*For any* `product_type` key present in `CN_CODE_MAP`, the `CBAMResult.cn_classification.cn_code` must equal `CN_CODE_MAP[product_type][0]`, and `cbam_in_scope` must be `True`.

**Validates: Requirements 4.2, 4.5**

---

### Property 8: Unknown product type always raises error

*For any* string that is NOT a key in `CN_CODE_MAP`, passing it as `product_type` in a `CBAMInput` must result in a validation error with code `CBAM_UNKNOWN_PRODUCT_TYPE`.

**Validates: Requirements 4.3**

---

### Property 9: Coordinate range validation

*For any* `installation_latitude` outside `[-90.0, 90.0]` or `installation_longitude` outside `[-180.0, 180.0]`, constructing a `CBAMInput` must raise a Pydantic `ValidationError`.

**Validates: Requirements 5.1**

---

### Property 10: Declaration structural completeness

*For any* valid `CBAMInput`, the assembled `CBAM_Declaration` dict must contain all of the following top-level keys: `template_version`, `declaration_metadata`, `installation_metadata`, `cn_classification`, `see_breakdown`, `direct_emissions`, `indirect_emissions`, `carbon_price_credit`, `covered_gases`, `standards_cited`, and `template_version` must equal `"EU_CBAM_TRANSITIONAL_2024"`.

**Validates: Requirements 6.1, 6.6, 6.7**

---

### Property 11: Declaration hash reproducibility

*For any* valid `CBAMInput`, calling `generate_declaration()` twice on the same input must produce the same `declaration_sha256`, and that value must equal `hashlib.sha256(json.dumps(declaration, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()`.

**Validates: Requirements 6.2, 6.3**

---

### Property 12: Validation is idempotent

*For any* valid `CBAMInput`, running `CBAMEngine.validate_input()` twice on the same input must produce identical `ValidationResult` objects (same `is_blocked`, same error codes, same warning codes).

**Validates: Requirements 8.6**

---

### Property 13: Weekly price sync is idempotent

*For any* `week_start_date`, running `WeeklyPriceSync.run()` twice for the same week must result in exactly one row in `cbam_ets_price_history` for that `week_start_date` (upsert semantics).

**Validates: Requirements 9.6**

---

### Property 14: Declaration storage is idempotent

*For any* `CBAM_Declaration` with a given `declaration_sha256`, calling `POST /api/cbam/declaration` twice with the same input must return the same `GeneratedReport` record ID on both calls, and must not create a duplicate row.

**Validates: Requirements 7.4**

---

### Property 15: EUR monetary formatting

*For any* non-negative float value, the `formatEUR(value)` utility function must return a string with exactly 2 decimal places, a `€` or `EUR` prefix/suffix, and thousand separators for values ≥ 1000.

**Validates: Requirements 10.5**

---

## Error Handling

| Condition | Code | Behaviour |
|---|---|---|
| `cement_production_t_yr` is zero | `CBAM_ZERO_PRODUCTION` | Return validation error; block calculation |
| `carbon_price_paid.amount` is negative | `CBAM_NEGATIVE_CARBON_PRICE` | Return validation error; block calculation |
| `imported_quantity_t` is zero or negative | `CBAM_INVALID_QUANTITY` | Return validation error; block calculation |
| `product_type` not in `CN_CODE_MAP` | `CBAM_UNKNOWN_PRODUCT_TYPE` | Return validation error with supported types list |
| CN code not under heading 2523 | `CBAM_OUT_OF_SCOPE` | Return validation error |
| Coordinates absent from input and Facility | `CBAM_MISSING_COORDINATES` | Return validation error |
| No ETS price in `cbam_ets_price_history` | `CBAM_NO_ETS_PRICE` | Return validation error; block calculation |
| ECB rate unavailable for currency | `CBAM_UNSUPPORTED_CURRENCY` | Return validation error |
| `scope2.electricity_co2_t` absent | `CBAM_NO_INDIRECT_DATA` | Set indirect to 0.0; attach non-blocking warning |
| `transaction_date` absent | `CBAM_RATE_DATE_FALLBACK` | Use latest ECB rate; attach non-blocking warning |
| `reporting_year < 2026` | `CBAM_PRE_OBLIGATION_YEAR` | Attach non-blocking warning; allow calculation |
| Credit exceeds obligation | `CBAM_CREDIT_EXCEEDS_OBLIGATION` | Clamp obligation to 0.0; attach non-blocking warning |
| Weekly price sync fetch fails | `CBAM_PRICE_SYNC_FAILED` | Retain last known price; attach system alert |
| Declaration with same sha256 already exists | `CBAM_DECLARATION_ALREADY_EXISTS` | Return existing record; attach non-blocking warning |
| Direct emissions components don't sum to total | — | Raise `ValueError("Direct emissions components do not sum to total_direct_co2_t")` |

---

## Testing Strategy

### Property-Based Testing Library

**`hypothesis`** (Python) — the standard PBT library for Python. Each property test runs a minimum of 100 iterations.

Tag format: `# Feature: cbam-compliance-module, Property {N}: {property_text}`

### Unit Tests (example-based)

- SEE calculation with known inputs: `direct=500t, indirect=100t, production=1000t` → `SEE=0.600000`
- CN code mapping: verify all 5 required entries resolve correctly
- Zero carbon price paid: full obligation, `credit_amount_eur=0.0`
- Credit exceeds obligation: `net_cbam_obligation_certificates=0.0` with `CBAM_CREDIT_EXCEEDS_OBLIGATION` warning
- Cold start (no ETS price): `CBAM_NO_ETS_PRICE` error
- Pre-obligation year (2025): `CBAM_PRE_OBLIGATION_YEAR` warning, calculation proceeds
- `dry_kiln_ph_pc` process type: accepted as valid enum, appears in `installation_metadata`
- Declaration JSON contains `template_version="EU_CBAM_TRANSITIONAL_2024"`
- `CBAMInput` has no `certificate_price` field (verify model schema)
- `NetFinancialImpactCard` renders three line items with correct labels
- `NetFinancialImpactCard` with `viewer` role: values redacted, contact message shown
- `CBAMDeclarationButton` triggers download with correct filename pattern

### Property Tests (hypothesis)

Each property from the Correctness Properties section maps to one `@given` test:

| Property | Hypothesis strategy |
|---|---|
| P1: SEE arithmetic and precision | `st.floats(min_value=0.01, max_value=1e7)` for emissions and production |
| P2: Emission mapping from Carbon Engine | `st.builds(CBAMInput, ...)` with valid field generators |
| P3: Direct emissions sum | `st.floats(min_value=0, max_value=1e6)` for calcination and fuel |
| P4: N2O/PFC always zero for CN 2523 | `st.sampled_from(list(CN_CODE_MAP.keys()))` for product_type |
| P5: Currency conversion arithmetic | `st.floats(min_value=0, max_value=1e6)` for amount, `st.floats(min_value=0.001, max_value=1000)` for rate |
| P6: Certificate obligation formula and non-negativity | `st.builds(CBAMInput, ...)` with full field generators |
| P7: CN code lookup correctness | `st.sampled_from(list(CN_CODE_MAP.keys()))` |
| P8: Unknown product type raises error | `st.text().filter(lambda s: s not in CN_CODE_MAP)` |
| P9: Coordinate range validation | `st.floats(min_value=-200, max_value=200)` for lat/lon, filter for out-of-range |
| P10: Declaration structural completeness | `st.builds(CBAMInput, ...)` |
| P11: Declaration hash reproducibility | `st.builds(CBAMInput, ...)` — call generate_declaration twice |
| P12: Validation idempotence | `st.builds(CBAMInput, ...)` — run validate_input twice |
| P13: Weekly price sync idempotence | `st.dates()` for week_start_date — run sync twice with mock API |
| P14: Declaration storage idempotence | `st.builds(CBAMInput, ...)` — call declaration endpoint twice |
| P15: EUR formatting | `st.floats(min_value=0, max_value=1e12, allow_nan=False, allow_infinity=False)` |

### Integration Tests

- End-to-end: `POST /api/cbam/calculate` with a full `CBAMInput` returns a `CBAMResult` with all required fields populated
- End-to-end: `POST /api/cbam/declaration` stores a `GeneratedReport` with `report_type="cbam_annual"` and uploads to S3 at the correct key
- Currency conversion: fetch USD→EUR rate from ECB API, cache in `cbam_fx_rates`, verify subsequent call uses cache
- Weekly price sync: mock EU ETS API response, verify `cbam_ets_price_history` row is created with correct schema
- RLS isolation: verify a tenant cannot retrieve another tenant's CBAM declarations
- Duplicate declaration: submit same `CBAMInput` twice, verify single `GeneratedReport` row and `CBAM_DECLARATION_ALREADY_EXISTS` warning on second call
