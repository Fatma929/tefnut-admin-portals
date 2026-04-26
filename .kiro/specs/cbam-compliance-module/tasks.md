# Implementation Plan: CBAM Compliance Module

## Overview

Implement the EU CBAM Compliance Module as a new Python engine (`cbam_engine.py`), a currency conversion layer (`currency_conversion.py`), a weekly ETS price sync service (`weekly_price_sync.py`), two new TanStack Start API routes, two new React components, and dashboard integration. The module wraps the existing `CarbonEngine`, reuses the SHA-256 audit infrastructure, RDS PostgreSQL with RLS, and S3 with SSE-KMS.

## Tasks

- [x] 1. Database migrations — CBAM support tables
  - Create `db/migrations/0003_cbam_tables.sql`
  - Add `cbam_ets_price_history` table: `id UUID PK`, `week_start_date DATE NOT NULL UNIQUE`, `price_eur_per_t_co2e NUMERIC(10,4) NOT NULL`, `source_url TEXT NOT NULL`, `fetched_at_utc TIMESTAMPTZ NOT NULL DEFAULT now()`
  - Add `cbam_fx_rates` table: `id UUID PK`, `currency_code CHAR(3) NOT NULL`, `rate_date DATE NOT NULL`, `rate_to_eur NUMERIC(18,8) NOT NULL`, `fetched_at_utc TIMESTAMPTZ NOT NULL DEFAULT now()`, `UNIQUE (currency_code, rate_date)`
  - Add indexes: `idx_cbam_ets_week` on `cbam_ets_price_history(week_start_date)`, `idx_cbam_fx_currency_date` on `cbam_fx_rates(currency_code, rate_date)`
  - Add TypeScript row types `CBAMEtsPriceHistory` and `CBAMFxRate` to `db/schema.ts`
  - _Requirements: 9.1, 3.2_

- [x] 2. Implement `cbam_engine/cbam_engine.py` — Pydantic V2 models
  - Create `cbam_engine/` package with `__init__.py`
  - Implement `KilnProcessType` enum: `DRY_KILN`, `WET_KILN`, `SEMI_DRY_KILN`, `DRY_KILN_PH_PC`
  - Implement `ProductionProcess` model: `process_type: KilnProcessType`, `kiln_capacity_t_clinker_per_day: float (gt=0)`, `annual_operating_hours: float (ge=1, le=8760)`, `clinker_to_cement_ratio: float (ge=0.0, le=1.0)`
  - Implement `CarbonPricePaid` model: `amount: float (ge=0.0)`, `currency_code: str (min_length=3, max_length=3)`
  - Implement `CBAMInput(PlantInput)`: `product_type: str`, `imported_quantity_t: float (gt=0)`, `carbon_price_paid: CarbonPricePaid`, `transaction_date: Optional[str]`, `installation_latitude: Optional[float] (ge=-90.0, le=90.0)`, `installation_longitude: Optional[float] (ge=-180.0, le=180.0)`, `production_process: ProductionProcess`, `declarant_eori: str`, `reporting_year: int (ge=2026)` — NO `certificate_price` field
  - Implement output models: `SEEBreakdown`, `DirectEmissions`, `IndirectEmissions`, `CarbonPriceCredit`, `ETSPriceReference`, `CNClassification`, `InstallationMetadata`, `CBAMResult`
  - Add `CN_CODE_MAP` static dict with all 5 required cement product type entries
  - _Requirements: 1.4, 2.1, 2.2, 2.4, 3.1, 3.6, 4.1, 5.1, 5.2, 5.3, 5.6, 9.2, 9.5_

- [x] 3. Implement `cbam_engine/currency_conversion.py` — ECB exchange rate layer
  - Implement `CurrencyConversionLayer` class with `get_rate_to_eur(currency_code, rate_date, db) -> tuple[float, str]`
  - Step 1: query `cbam_fx_rates` cache for `(currency_code, rate_date)`; return cached rate if found
  - Step 2: on cache miss, fetch from ECB API `https://data-api.ecb.europa.eu/service/data/EXR/D.{currency}.EUR.SP00.A`; parse XML/JSON response; insert into `cbam_fx_rates`
  - Step 3: if ECB fetch fails, fall back to most recent row in `cbam_fx_rates` for that currency; attach `CBAM_RATE_DATE_FALLBACK` warning
  - Raise `ValueError` with code `CBAM_UNSUPPORTED_CURRENCY` if no rate is available at all
  - Handle `transaction_date=None` by using the latest available ECB rate and attaching `CBAM_RATE_DATE_FALLBACK` warning
  - _Requirements: 3.2, 3.3, 3.8_

- [x] 4. Implement `cbam_engine/weekly_price_sync.py` — ETS price cron service
  - Implement `WeeklyPriceSync` class with `run(db)`, `_fetch_price() -> tuple[float, str]`, and `_upsert_price(db, week_start_date, price, source_url)` methods
  - `_fetch_price()` calls the EU ETS registry API; returns `(price_eur_per_t_co2e, source_url)`
  - `_upsert_price()` performs `INSERT ... ON CONFLICT (week_start_date) DO UPDATE SET ...` — idempotent
  - On fetch failure: log `CBAM_PRICE_SYNC_FAILED` alert with last known price date; do NOT raise; retain last row
  - `run()` computes `week_start_date` as the Monday of the current ISO week
  - _Requirements: 9.1, 9.3, 9.6_

- [x] 5. Implement `CBAMEngine` class — calculation pipeline
  - [x] 5.1 Implement `CBAMEngine.__init__(cbam_input: CBAMInput, db: TenantDb)` and `validate_input()` method
    - Validate all `CBAMInput` fields via Pydantic V2 before any calculation
    - Return structured `ValidationResult` with `is_blocked=True` on any blocking error; do NOT proceed to calculation
    - Blocking errors: `CBAM_ZERO_PRODUCTION`, `CBAM_NEGATIVE_CARBON_PRICE`, `CBAM_INVALID_QUANTITY`, `CBAM_UNKNOWN_PRODUCT_TYPE`, `CBAM_OUT_OF_SCOPE`, `CBAM_MISSING_COORDINATES`, `CBAM_NO_ETS_PRICE`, `CBAM_UNSUPPORTED_CURRENCY`, `CBAM_INVALID_CLINKER_RATIO`
    - Non-blocking warnings: `CBAM_NO_INDIRECT_DATA`, `CBAM_RATE_DATE_FALLBACK`, `CBAM_PRE_OBLIGATION_YEAR`, `CBAM_CREDIT_EXCEEDS_OBLIGATION`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 5.2 Implement `_fetch_ets_price(db) -> ETSPriceReference`
    - Query `cbam_ets_price_history` for the most recent row
    - Raise `CBAM_NO_ETS_PRICE` error if table is empty
    - Set `is_stale=True` if `week_start_date` is more than 14 days ago
    - _Requirements: 9.2, 9.4, 9.5_

  - [x] 5.3 Implement `_calculate_see(scope1, scope2, production_t) -> SEEBreakdown`
    - `direct_emissions_t = scope1.total_scope1_co2_t`
    - `indirect_emissions_t = scope2.electricity_co2_t` (default 0.0 with `CBAM_NO_INDIRECT_DATA` warning if absent)
    - `total_embedded_co2e_t = direct_emissions_t + indirect_emissions_t`
    - `specific_embedded_emissions_t_per_t = round(total_embedded_co2e_t / production_t, 6)`
    - Raise `CBAM_ZERO_PRODUCTION` if `production_t <= 0`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.5_

  - [x] 5.4 Implement `_calculate_certificate_obligation(see, qty, ets_price, credit_eur) -> CarbonPriceCredit`
    - `gross_obligation = SEE × imported_quantity_t × ets_price_eur_per_t`
    - `credit_certificates = (carbon_price_paid_eur × imported_quantity_t) / ets_price_eur_per_t`
    - `net_obligation = max(0.0, gross_obligation - credit_certificates)`
    - Attach `CBAM_CREDIT_EXCEEDS_OBLIGATION` warning when clamped to 0.0
    - _Requirements: 3.4, 3.5, 3.6, 3.7_

  - [x] 5.5 Implement `_resolve_cn_code(product_type) -> CNClassification`
    - Look up `CN_CODE_MAP`; raise `CBAM_UNKNOWN_PRODUCT_TYPE` with supported types list if not found
    - Validate CN heading is `2523`; raise `CBAM_OUT_OF_SCOPE` if not
    - Set `cbam_in_scope=True` for all heading 2523 codes
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 5.6 Implement `_build_direct_indirect_emissions(scope1, scope2) -> tuple[DirectEmissions, IndirectEmissions]`
    - Map `scope1.calcination_co2_t`, `scope1.fuel_combustion_co2_t`, `scope1.total_scope1_co2_t` to `DirectEmissions`
    - Validate `abs(calcination + fuel - total_direct) <= 0.01`; raise `ValueError` if not
    - Map `scope2.electricity_co2_t` to `IndirectEmissions`
    - Set `regulatory_classification` labels per Article 19
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 5.7 Implement `calculate() -> CBAMResult` — wire the full pipeline
    - Call steps in order: validate → fetch ETS price → convert currency → run CarbonEngine → calculate SEE → calculate certificate obligation → resolve CN code → build direct/indirect → assemble installation metadata → set N2O/PFC to 0.0 with compliance warning
    - Return `CBAMResult` with all sub-models populated
    - _Requirements: 1.6, 5.4, 5.5, 5.6_

  - [x] 5.8 Implement `generate_declaration() -> tuple[dict, CBAMResult]`
    - Assemble `CBAM_Declaration` dict with all required top-level keys: `template_version="EU_CBAM_TRANSITIONAL_2024"`, `declaration_metadata`, `installation_metadata`, `cn_classification`, `see_breakdown`, `direct_emissions`, `indirect_emissions`, `carbon_price_credit`, `covered_gases`, `compliance_warnings`, `standards_cited`
    - Compute `declaration_sha256 = hashlib.sha256(json.dumps(declaration, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()`
    - Return `(declaration_dict, cbam_result_with_sha256)`
    - _Requirements: 6.1, 6.2, 6.3, 6.6, 6.7_

- [x] 6. Checkpoint — verify reference calculation
  - Instantiate `CBAMEngine` with a known input (`direct=500t, indirect=100t, production=1000t`) and assert `SEE=0.600000`; verify all 5 CN code entries resolve correctly; ensure all tests pass, ask the user if questions arise.

- [ ] 7. Write property-based tests — `cbam_engine/tests/test_cbam_properties.py`
  - [ ]* 7.1 Property 1: SEE arithmetic and six-decimal precision
    - Use `st.floats(min_value=0.01, max_value=1e7)` for emissions and production; assert `see_breakdown.specific_embedded_emissions_t_per_t == round((direct + indirect) / production, 6)` within 1e-9
    - **Property 1: SEE arithmetic and six-decimal precision**
    - **Validates: Requirements 1.1, 1.2**

  - [ ]* 7.2 Property 2: Emission mapping from Carbon Engine to CBAM fields
    - Use `st.builds(CBAMInput, ...)` with valid field generators; assert `direct_emissions.calcination_co2_t == scope1.calcination_co2_t`, `direct_emissions.fuel_combustion_co2_t == scope1.fuel_combustion_co2_t`, `direct_emissions.total_direct_co2_t == scope1.total_scope1_co2_t`, `indirect_emissions.electricity_co2_t == scope2.electricity_co2_t`
    - **Property 2: Emission mapping from Carbon Engine to CBAM fields**
    - **Validates: Requirements 1.3, 2.1, 2.2**

  - [ ]* 7.3 Property 3: Direct emissions components sum to total
    - Use `st.floats(min_value=0, max_value=1e6)` for calcination and fuel; assert `abs(calcination + fuel - total_direct) <= 0.01`
    - **Property 3: Direct emissions components sum to total**
    - **Validates: Requirements 2.3**

  - [ ]* 7.4 Property 4: N2O and PFC are always zero for CN 2523 products
    - Use `st.sampled_from(list(CN_CODE_MAP.keys()))` for `product_type`; assert N2O and PFC values are `0.0` and `compliance_warnings` contains the GCCA v3.1 text
    - **Property 4: N2O and PFC are always zero for CN 2523 products**
    - **Validates: Requirements 1.6**

  - [ ]* 7.5 Property 5: Currency conversion arithmetic
    - Use `st.floats(min_value=0, max_value=1e6)` for amount and `st.floats(min_value=0.001, max_value=1000)` for rate; assert `carbon_price_paid_eur_per_t_co2e == amount × rate` within 1e-6
    - **Property 5: Currency conversion arithmetic**
    - **Validates: Requirements 3.3**

  - [ ]* 7.6 Property 6: Certificate obligation formula and non-negativity
    - Use `st.builds(CBAMInput, ...)` with full field generators; assert `net_cbam_obligation_certificates == max(0.0, (SEE × qty) - (credit_eur × qty / ets_price))` and is never negative
    - **Property 6: Certificate obligation formula and non-negativity**
    - **Validates: Requirements 3.4, 3.5**

  - [ ]* 7.7 Property 7: CN code lookup correctness and in-scope flag
    - Use `st.sampled_from(list(CN_CODE_MAP.keys()))`; assert `cn_classification.cn_code == CN_CODE_MAP[product_type][0]` and `cbam_in_scope is True`
    - **Property 7: CN code lookup correctness and in-scope flag**
    - **Validates: Requirements 4.2, 4.5**

  - [ ]* 7.8 Property 8: Unknown product type always raises error
    - Use `st.text().filter(lambda s: s not in CN_CODE_MAP)`; assert validation error with code `CBAM_UNKNOWN_PRODUCT_TYPE`
    - **Property 8: Unknown product type always raises error**
    - **Validates: Requirements 4.3**

  - [ ]* 7.9 Property 9: Coordinate range validation
    - Use `st.floats(min_value=-200, max_value=200)` for lat/lon, filter for out-of-range values; assert Pydantic `ValidationError` is raised
    - **Property 9: Coordinate range validation**
    - **Validates: Requirements 5.1**

  - [ ]* 7.10 Property 10: Declaration structural completeness
    - Use `st.builds(CBAMInput, ...)` with valid generators; assert assembled declaration dict contains all required top-level keys and `template_version == "EU_CBAM_TRANSITIONAL_2024"`
    - **Property 10: Declaration structural completeness**
    - **Validates: Requirements 6.1, 6.6, 6.7**

  - [ ]* 7.11 Property 11: Declaration hash reproducibility
    - Use `st.builds(CBAMInput, ...)`; call `generate_declaration()` twice on the same input; assert both `declaration_sha256` values are identical and equal `hashlib.sha256(json.dumps(declaration, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()`
    - **Property 11: Declaration hash reproducibility**
    - **Validates: Requirements 6.2, 6.3**

  - [ ]* 7.12 Property 12: Validation is idempotent
    - Use `st.builds(CBAMInput, ...)`; call `CBAMEngine.validate_input()` twice on the same input; assert both `ValidationResult` objects have identical `is_blocked`, error codes, and warning codes
    - **Property 12: Validation is idempotent**
    - **Validates: Requirements 8.6**

  - [ ]* 7.13 Property 13: Weekly price sync is idempotent
    - Use `st.dates()` for `week_start_date`; run `WeeklyPriceSync._upsert_price()` twice with the same date and mock price; assert exactly one row exists in `cbam_ets_price_history` for that date
    - **Property 13: Weekly price sync is idempotent**
    - **Validates: Requirements 9.6**

  - [ ]* 7.14 Property 14: Declaration storage is idempotent
    - Use `st.builds(CBAMInput, ...)`; call `POST /api/cbam/declaration` twice with the same input via test client; assert same `report_id` returned and no duplicate row in `generated_reports`
    - **Property 14: Declaration storage is idempotent**
    - **Validates: Requirements 7.4**

  - [ ]* 7.15 Property 15: EUR monetary formatting
    - Use `st.floats(min_value=0, max_value=1e12, allow_nan=False, allow_infinity=False)`; assert `formatEUR(value)` returns a string with exactly 2 decimal places and thousand separators for values ≥ 1000
    - **Property 15: EUR monetary formatting**
    - **Validates: Requirements 10.5**

- [ ] 8. Write unit tests — `cbam_engine/tests/test_cbam_engine.py`
  - [ ]* 8.1 Test SEE reference case: `direct=500t, indirect=100t, production=1000t` → `SEE=0.600000`
    - _Requirements: 1.1, 1.2_

  - [ ]* 8.2 Test all 5 CN code mapping entries resolve to correct codes and descriptions
    - _Requirements: 4.1, 4.2_

  - [ ]* 8.3 Test zero `carbon_price_paid`: full obligation, `credit_amount_eur=0.0`
    - _Requirements: 3.7_

  - [ ]* 8.4 Test credit exceeds obligation: `net_cbam_obligation_certificates=0.0` with `CBAM_CREDIT_EXCEEDS_OBLIGATION` warning
    - _Requirements: 3.5_

  - [ ]* 8.5 Test cold start (no ETS price row): `CBAM_NO_ETS_PRICE` validation error
    - _Requirements: 9.4_

  - [ ]* 8.6 Test pre-obligation year (2025): `CBAM_PRE_OBLIGATION_YEAR` warning, calculation proceeds
    - _Requirements: 8.4_

  - [ ]* 8.7 Test `dry_kiln_ph_pc` process type: accepted as valid enum, appears in `installation_metadata`
    - _Requirements: 5.3_

  - [ ]* 8.8 Test declaration JSON contains `template_version="EU_CBAM_TRANSITIONAL_2024"`
    - _Requirements: 6.6_

  - [ ]* 8.9 Test `CBAMInput` schema has no `certificate_price` field
    - _Requirements: 9.2_

- [ ] 9. Checkpoint — Ensure all Python tests pass
  - Run `pytest cbam_engine/tests/ -v` and confirm all unit tests and property tests pass; ask the user if questions arise.

- [x] 10. Implement API routes — `src/routes/api.cbam.calculate.ts` and `src/routes/api.cbam.declaration.ts`
  - [x] 10.1 Create `src/routes/api.cbam.calculate.ts` — `POST /api/cbam/calculate`
    - Use `createAPIFileRoute` pattern matching `src/routes/api.persist.ts`
    - Extract `orgId` via `resolveTenantContext(request)`; wrap DB calls in `withTenant(orgId, ...)`
    - Call Python `cbam_engine.calculate()` via Lambda/subprocess (same pattern as carbon engine handler)
    - Return `CBAMResult` JSON; return 422 with structured errors on validation failure
    - _Requirements: 8.1_

  - [x] 10.2 Create `src/routes/api.cbam.declaration.ts` — `POST /api/cbam/declaration`
    - Call `cbam_engine.generate_declaration()` to get `(declaration, result)`
    - Before inserting, query `generated_reports` for existing row with same `facility_id`, `reporting_year`, and `sha256_hash`; if found, return existing record with `CBAM_DECLARATION_ALREADY_EXISTS` warning
    - Insert `GeneratedReport` row: `report_type="cbam_annual"`, `sha256_hash=declaration_sha256`, `report_json=declaration`, `standards_cited=["EU Regulation 2023/956", ...]`
    - Upload declaration JSON to S3 at key `cbam/{facility_id}/{reporting_year}/{declaration_sha256}.json` using existing `src/lib/s3-storage.ts` helper
    - Return `{ declaration, result, report_id }`
    - _Requirements: 6.4, 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 11. Implement `src/components/CBAMDeclarationButton.tsx`
  - Render a "CBAM Declaration" button that calls `POST /api/cbam/declaration` with the current `CBAMInput` state
  - Show `Loader2` spinner during generation
  - On success: trigger browser download of `cbam_declaration_{facility_name}_{reporting_year}.json` using `URL.createObjectURL`
  - Display `declaration_sha256` in a copyable monospace badge below the button (same copy-to-clipboard pattern as `app.index.tsx` audit hash copy)
  - On error: display inline error message
  - _Requirements: 6.4, 6.5_

- [x] 12. Implement `src/components/NetFinancialImpactCard.tsx`
  - Accept props: `cbamResult: CBAMResult | null`, `userRole: UserRole`
  - Display three line items: `Gross EU Obligation (EUR)`, `Domestic Credit (EUR)`, `Net Payable (EUR)` — all formatted with `formatEUR()` utility (2 d.p., thousand separators, EUR prefix)
  - Show `Weekly_ETS_Price` and `week_start_date` as a footnote
  - When `net_payable === 0.0`: render green notice "Full credit applied — no net CBAM payment required"
  - Role-gate: when `userRole === "viewer"`, redact all monetary values and show "Contact your compliance lead for financial details" message
  - Implement `formatEUR(value: number): string` utility in `src/lib/utils.ts`
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 13. Integrate `NetFinancialImpactCard` into `src/routes/app.index.tsx`
  - Import `NetFinancialImpactCard` and add it to the dashboard layout after the stat cards row
  - Pass `cbamResult` from component state (initially `null`; populated after `POST /api/cbam/calculate` response)
  - Pass `userRole` from tenant context
  - _Requirements: 10.1, 10.2_

- [x] 14. Final checkpoint — Ensure all tests pass
  - Run `pytest cbam_engine/tests/ -v` to confirm all Python tests pass; verify TypeScript components have no type errors via `getDiagnostics`; ask the user if questions arise.

- [-] 15. Git commit of all changes
  - Stage all new and modified files: `cbam_engine/`, `db/migrations/0003_cbam_tables.sql`, `db/schema.ts`, `src/routes/api.cbam.calculate.ts`, `src/routes/api.cbam.declaration.ts`, `src/components/CBAMDeclarationButton.tsx`, `src/components/NetFinancialImpactCard.tsx`, `src/routes/app.index.tsx`
  - Commit with message: `feat(cbam): implement CBAM compliance module — EU Regulation 2023/956`

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All property tests use `hypothesis` with `@settings(max_examples=100)` and tag comment: `# Feature: cbam-compliance-module, Property {N}: {property_text}`
- `CBAMEngine` receives a `TenantDb` instance from the API route handler — it never opens its own DB connection
- `CBAMInput` deliberately has no `certificate_price` field; the engine always reads from `cbam_ets_price_history`
- Declaration hash uses `json.dumps(declaration, sort_keys=True, ensure_ascii=False)` for reproducibility
- S3 upload inherits SSE-KMS from the existing bucket policy in `infra/s3-bucket-policy.json`
- The `reporting_year` field on `CBAMInput` overrides the `PlantInput` base field with `ge=2026`; attach `CBAM_PRE_OBLIGATION_YEAR` warning for years before 2026 rather than blocking
