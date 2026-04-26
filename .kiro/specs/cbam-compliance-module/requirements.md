# Requirements Document

## Introduction

The CBAM Compliance Module extends the Tefnut platform to satisfy the EU Carbon Border Adjustment Mechanism (Regulation 2023/956). Cement factory clients exporting to Europe must submit CBAM declarations starting 31 May 2027 (covering calendar year 2026). This module transforms Tefnut from a monitoring tool into a legal bridge to the European market by: (1) computing Specific Embedded Emissions per Article 7, with explicit Direct/Indirect emission separation per Article 19; (2) applying a Carbon Price Paid credit per Article 46 to prevent double taxation, with automated currency conversion for domestic carbon taxes paid in non-EUR currencies; (3) mapping products to CN Code 2523 and capturing all mandatory installation metadata including PH/PC kiln process types; (4) generating a SHA-256-verified CBAM Declaration export formatted to the EU transitional period template per Article 47; (5) automatically syncing the weekly EU ETS auction price per Article 23 so no manual price entry is required; and (6) displaying a Net Financial Impact card on the dashboard showing gross obligation, domestic credit, and net payable in EUR.

The module builds on the existing Python `carbon_engine`, the SHA-256 audit hashing infrastructure, the Amazon RDS PostgreSQL backend with RLS tenant isolation, and the TanStack Start frontend.

---

## Glossary

- **CBAM_Engine**: The new Python module (`cbam_engine.py`) responsible for all CBAM-specific calculations and declaration assembly.
- **Carbon_Engine**: The existing Python calculation engine (`carbon_engine.py`) that computes GCCA-compliant CO2 emissions.
- **Specific_Embedded_Emissions (SEE)**: Total CO2 equivalent per tonne of cement product, expressed in t CO2e / t product, as defined in CBAM Regulation 2023/956 Article 7.
- **Direct_Emissions**: Scope 1 CO2 arising from the kiln calcination process and on-site fuel combustion, as classified under Article 19 of CBAM Regulation 2023/956.
- **Indirect_Emissions**: Scope 2 CO2 arising from purchased electricity consumption, as classified under Article 19 of CBAM Regulation 2023/956.
- **Carbon_Price_Paid**: The monetary amount already paid by the installation in its country of origin under a domestic carbon pricing mechanism, as defined in CBAM Regulation 2023/956 Article 46. May be entered in any currency; the system converts to EUR using the transaction-date exchange rate.
- **Carbon_Price_Paid_EUR**: The EUR-equivalent of Carbon_Price_Paid after currency conversion, used in all CBAM certificate obligation calculations.
- **CBAM_Certificate_Obligation**: The number of CBAM certificates the EU importer must surrender, calculated as SEE multiplied by the quantity of imported goods, minus the Carbon_Price_Paid credit expressed in certificate units.
- **Weekly_ETS_Price**: The weekly average EU ETS auction price (EUR/t CO2e) fetched automatically by the Weekly Price Sync service per Article 23. Never entered manually.
- **Weekly_Price_Sync**: The background service that fetches the EU ETS weekly average auction price from the EU ETS registry API and stores it in the database every Monday.
- **Currency_Conversion_Layer**: The service that converts a domestic carbon price from any input currency to EUR using the ECB (European Central Bank) exchange rate for the transaction date.
- **CN_Code**: Combined Nomenclature code used to classify goods under EU customs law. Cement products fall under CN Code 2523.
- **CBAM_Declaration**: The structured report submitted to EU authorities, containing SEE, installation metadata, and verification hash, formatted to the EU transitional period template.
- **Installation_Metadata**: The set of mandatory fields required by the EU CBAM template: installation name, geographical coordinates (latitude/longitude), production process parameters, and reporting period.
- **Declaration_Hash**: The SHA-256 hex digest of the serialised CBAM_Declaration JSON, applied per Article 47 for tamper-evident verification.
- **Covered_Gases**: The greenhouse gases subject to CBAM for cement: CO2, N2O, and PFCs. For cement (CN 2523), N2O and PFCs are set to default zero per GCCA v3.1 protocols.
- **Reporting_Period**: The calendar year for which the CBAM declaration is submitted (first mandatory period: 2026).
- **PlantInput**: The existing Pydantic input model that carries all plant-level data into the Carbon_Engine.
- **CBAMInput**: The new Pydantic input model that extends PlantInput with CBAM-specific fields: Carbon_Price_Paid with currency code, installation coordinates, production process parameters, and CN code. Does NOT include a manual certificate price field.
- **CBAMResult**: The Pydantic output model returned by the CBAM_Engine, containing SEE breakdown, certificate obligation, financial impact summary, and declaration metadata.
- **Facility**: The database entity (existing) that stores installation-level data including latitude, longitude, and facility type.
- **Net_Financial_Impact**: The dashboard display showing: Gross EU Obligation (EUR) − Domestic Credit (EUR) = Net Payable (EUR).
- **PH/PC_Kiln**: Dry kiln with Preheater and Precalciner — the global standard for high-efficiency cement plants, characterised by lower specific heat consumption and lower specific CO2 emissions per tonne of clinker compared to basic dry, wet, or semi-dry kilns.

---

## Requirements

### Requirement 1: Specific Embedded Emissions Calculation (Article 7)

**User Story:** As a sustainability lead at a cement factory, I want the system to calculate Specific Embedded Emissions per tonne of product as defined in Article 7, so that I have the legally required figure to include in my CBAM declaration.

#### Acceptance Criteria

1. THE `CBAM_Engine` SHALL calculate `Specific_Embedded_Emissions` as the sum of `Direct_Emissions` and `Indirect_Emissions` divided by the total cement production in tonnes for the reporting period.
2. THE `CBAM_Engine` SHALL express `Specific_Embedded_Emissions` in units of t CO2e per tonne of cement product, rounded to six decimal places.
3. WHEN the `Carbon_Engine` result contains `scope1.total_scope1_co2_t` and `scope2.electricity_co2_t`, THE `CBAM_Engine` SHALL derive `Direct_Emissions` from `scope1.total_scope1_co2_t` and `Indirect_Emissions` from `scope2.electricity_co2_t`.
4. THE `CBAMResult` SHALL include a `see_breakdown` object containing `direct_emissions_t`, `indirect_emissions_t`, `total_embedded_co2e_t`, and `specific_embedded_emissions_t_per_t`.
5. WHEN `cement_production_t_yr` is zero or absent, THE `CBAM_Engine` SHALL return a validation error with code `CBAM_ZERO_PRODUCTION` and message `"Cement production must be greater than zero to calculate Specific Embedded Emissions"`.
6. FOR cement products under CN heading 2523, THE `CBAM_Engine` SHALL set N2O and PFC emissions to `0.0` by default and SHALL include a `compliance_warning` in the `CBAMResult` with text: `"Non-CO2 GHGs (N2O, PFCs) are negligible for this installation type as per GCCA Cement CO2 and Energy Protocol v3.1. Values set to zero."` This warning SHALL appear in the CBAM Declaration export so auditors can verify the basis for the zero values.

---

### Requirement 2: Direct and Indirect Emission Separation (Article 19)

**User Story:** As a compliance officer, I want the system to explicitly separate Direct Emissions (kiln/calcination) from Indirect Emissions (electricity) in the CBAM output, so that the declaration correctly reflects the Article 19 classification and auditors can verify each component independently.

#### Acceptance Criteria

1. THE `CBAMResult` SHALL include a `direct_emissions` object containing `calcination_co2_t`, `fuel_combustion_co2_t`, and `total_direct_co2_t`, sourced directly from the `Carbon_Engine` `scope1` output.
2. THE `CBAMResult` SHALL include an `indirect_emissions` object containing `electricity_co2_t` and `total_indirect_co2_t`, sourced directly from the `Carbon_Engine` `scope2` output.
3. THE `CBAM_Engine` SHALL validate that `direct_emissions.total_direct_co2_t` equals `calcination_co2_t` plus `fuel_combustion_co2_t` within a floating-point tolerance of 0.01 t CO2; IF the validation fails, THE `CBAM_Engine` SHALL raise a `ValueError` with message `"Direct emissions components do not sum to total_direct_co2_t"`.
4. THE `CBAMResult` SHALL label each emission component with its Article 19 classification (`"Article 19 - Direct"` or `"Article 19 - Indirect"`) in a `regulatory_classification` field, so that the declaration is self-documenting for auditors.
5. WHEN the `Carbon_Engine` result contains no electricity data (`scope2.electricity_co2_t` is zero or absent), THE `CBAM_Engine` SHALL set `indirect_emissions.electricity_co2_t` to `0.0` and attach a warning with code `CBAM_NO_INDIRECT_DATA` and message `"No indirect emission data provided; indirect emissions set to zero"`.

---

### Requirement 3: Carbon Price Paid Credit with Currency Conversion (Article 46)

**User Story:** As a cement factory operator in Egypt, I want to input the carbon price I already paid in my home country in Egyptian Pounds, so that the system automatically converts it to EUR and deducts the correct amount from my CBAM certificate obligation, preventing double taxation without requiring me to do manual currency conversion.

#### Acceptance Criteria

1. THE `CBAMInput` SHALL accept a `carbon_price_paid` object containing `amount` (float, minimum 0.0) and `currency_code` (ISO 4217 string, e.g., `"EGP"`, `"USD"`, `"EUR"`) representing the carbon price already paid per tonne CO2e in the country of origin.
2. THE `Currency_Conversion_Layer` SHALL fetch the ECB (European Central Bank) exchange rate for the specified `currency_code` to EUR on the `transaction_date` provided in `CBAMInput`; IF `transaction_date` is absent, THE system SHALL use the last available ECB rate and attach a warning with code `CBAM_RATE_DATE_FALLBACK`.
3. THE `CBAM_Engine` SHALL compute `Carbon_Price_Paid_EUR` as `carbon_price_paid.amount × exchange_rate_to_eur` and store both the original amount, currency, exchange rate used, and rate date in the `CBAMResult` for full auditability.
4. THE `CBAM_Engine` SHALL calculate `cbam_certificate_obligation` as: `(SEE × imported_quantity_t) − (Carbon_Price_Paid_EUR × imported_quantity_t / Weekly_ETS_Price)`, using the `Weekly_ETS_Price` fetched automatically — never a manually entered price.
5. THE `CBAM_Engine` SHALL ensure `cbam_certificate_obligation` is never negative; IF the calculated value is negative, THE `CBAM_Engine` SHALL clamp it to `0.0` and attach a warning with code `CBAM_CREDIT_EXCEEDS_OBLIGATION` and message `"Carbon price paid credit exceeds total CBAM obligation; net obligation set to zero"`.
6. THE `CBAMResult` SHALL include a `carbon_price_credit` object containing `original_amount`, `original_currency`, `exchange_rate_eur`, `rate_date`, `carbon_price_paid_eur_per_t_co2e`, `imported_quantity_t`, `credit_amount_eur`, and `net_cbam_obligation_certificates`.
7. WHEN `carbon_price_paid.amount` is zero, THE `CBAM_Engine` SHALL calculate the full certificate obligation without any deduction and set `credit_amount_eur` to `0.0`.
8. IF the `Currency_Conversion_Layer` cannot fetch an exchange rate for the specified currency, THEN THE `CBAM_Engine` SHALL return a validation error with code `CBAM_UNSUPPORTED_CURRENCY` and message `"Exchange rate unavailable for currency '{currency_code}'"`.

---

### Requirement 4: CN Code Classification and Mapping

**User Story:** As a compliance officer, I want the system to automatically classify cement products under CN Code 2523 and validate that the goods being declared are within CBAM scope, so that the declaration is correctly categorised under EU customs law.

#### Acceptance Criteria

1. THE `CBAM_Engine` SHALL maintain a mapping of cement product types to their corresponding CN codes, including at minimum: `"cement_clinker"` → `"2523 10"`, `"white_cement"` → `"2523 21"`, `"other_portland_cement"` → `"2523 29"`, `"aluminous_cement"` → `"2523 30"`, `"other_hydraulic_cement"` → `"2523 90"`.
2. WHEN a `CBAMInput` specifies a `product_type`, THE `CBAM_Engine` SHALL resolve the corresponding CN code from the mapping and include it in the `CBAMResult` as `cn_code`.
3. IF a `product_type` is not found in the CN code mapping, THEN THE `CBAM_Engine` SHALL return a validation error with code `CBAM_UNKNOWN_PRODUCT_TYPE` and message `"Product type '{product_type}' is not mapped to a CN code. Supported types: {list}"`.
4. THE `CBAMResult` SHALL include a `cn_classification` object containing `cn_code`, `product_type`, `cn_description`, and `cbam_in_scope` (boolean), where `cbam_in_scope` is `True` for all CN codes under heading 2523.
5. THE `CBAM_Engine` SHALL validate that the resolved CN code falls under heading `2523`; IF it does not, THE `CBAM_Engine` SHALL return a validation error with code `CBAM_OUT_OF_SCOPE` and message `"CN code '{cn_code}' is not within CBAM scope for cement (heading 2523)"`.

---

### Requirement 5: Installation Metadata and Kiln Process Capture

**User Story:** As a sustainability lead, I want every CBAM declaration to automatically include the installation's geographical coordinates and production process parameters including PH/PC kiln type, so that the report satisfies the EU's mandatory metadata requirements without manual data entry.

#### Acceptance Criteria

1. THE `CBAMInput` SHALL require `installation_latitude` (float, range −90.0 to 90.0) and `installation_longitude` (float, range −180.0 to 180.0) fields representing the installation's geographical coordinates in decimal degrees.
2. THE `CBAMInput` SHALL require a `production_process` object containing: `process_type` (enum: `"dry_kiln"`, `"wet_kiln"`, `"semi_dry_kiln"`, `"dry_kiln_ph_pc"`), `kiln_capacity_t_clinker_per_day` (float, gt 0), `annual_operating_hours` (float, range 1 to 8760), and `clinker_to_cement_ratio` (float, range 0.0 to 1.0).
3. THE `process_type` value `"dry_kiln_ph_pc"` SHALL represent a Dry Kiln with Preheater and Precalciner (PH/PC) — the global standard for high-efficiency plants — and SHALL be treated as the primary benchmark process type in all CBAM efficiency comparisons.
4. WHEN the `Facility` record in the database contains non-null `latitude` and `longitude` values, THE system SHALL pre-populate `installation_latitude` and `installation_longitude` in the `CBAMInput` from the `Facility` record.
5. IF `installation_latitude` or `installation_longitude` is absent from both the `CBAMInput` and the `Facility` record, THEN THE `CBAM_Engine` SHALL return a validation error with code `CBAM_MISSING_COORDINATES` and message `"Installation coordinates are required for CBAM declaration"`.
6. THE `CBAMResult` SHALL include an `installation_metadata` object containing `installation_name`, `latitude`, `longitude`, `country`, `production_process` (including `process_type` with its full label), and `reporting_period`, formatted to match the EU CBAM transitional period template field names.

---

### Requirement 6: CBAM Declaration Export (Article 47)

**User Story:** As a sustainability lead, I want to generate a CBAM Declaration export that is formatted exactly like the EU's transitional period template and protected by a SHA-256 hash, so that I can submit it to EU authorities with confidence in its integrity and legal validity.

#### Acceptance Criteria

1. THE `CBAM_Engine` SHALL assemble a `CBAM_Declaration` JSON document containing: `declaration_metadata` (reporting period, submission date, declarant EORI number), `installation_metadata` (from Requirement 5), `cn_classification` (from Requirement 4), `see_breakdown` (from Requirement 1), `direct_emissions` (from Requirement 2), `indirect_emissions` (from Requirement 2), `carbon_price_credit` (from Requirement 3), and `covered_gases` list.
2. THE `CBAM_Engine` SHALL compute `Declaration_Hash` as the SHA-256 hex digest of the UTF-8-encoded JSON serialisation of the `CBAM_Declaration`, with keys sorted alphabetically, and include it in the `CBAMResult` as `declaration_sha256`.
3. THE `Declaration_Hash` SHALL be reproducible: FOR ALL valid `CBAMInput` objects, serialising the same `CBAM_Declaration` twice SHALL produce the same `declaration_sha256` (idempotence property).
4. THE frontend SHALL expose a dedicated "CBAM Declaration" export button on the report page that triggers generation of the `CBAM_Declaration` and downloads it as a JSON file named `cbam_declaration_{facility_name}_{reporting_year}.json`.
5. WHEN the export is triggered, THE system SHALL display the `declaration_sha256` hash alongside the download link so that the user can record it for submission verification.
6. THE `CBAM_Declaration` JSON structure SHALL include a `template_version` field set to `"EU_CBAM_TRANSITIONAL_2024"` to identify the template format used.
7. THE `CBAM_Engine` SHALL include `standards_cited` in the `CBAM_Declaration` listing `"EU Regulation 2023/956"`, `"CBAM Implementing Regulation 2023/1773"`, and `"GCCA Cement CO2 and Energy Protocol v3.1"`.

---

### Requirement 7: CBAM Declaration Storage and Audit Trail

**User Story:** As an auditor, I want every generated CBAM Declaration to be stored immutably with its hash in the database, so that I can retrieve and verify any past declaration without relying on the user's local copy.

#### Acceptance Criteria

1. WHEN a `CBAM_Declaration` is generated, THE system SHALL persist a `GeneratedReport` record in the database with `report_type` set to `"cbam_annual"` or `"cbam_quarterly"` as appropriate, `sha256_hash` set to `declaration_sha256`, and `report_json` containing the full `CBAM_Declaration` JSON.
2. THE system SHALL store the `CBAM_Declaration` JSON file in Amazon S3 with SSE-KMS encryption, using the storage key pattern `cbam/{facility_id}/{reporting_year}/{declaration_sha256}.json`.
3. THE `GeneratedReport` record SHALL include `standards_cited` as a JSON array containing `"EU Regulation 2023/956"`.
4. WHEN a `CBAM_Declaration` with the same `declaration_sha256` already exists for the same facility and reporting year, THE system SHALL return the existing record without creating a duplicate, and attach a warning with code `CBAM_DECLARATION_ALREADY_EXISTS`.
5. THE system SHALL enforce RLS tenant isolation on `GeneratedReport` records so that a facility can only retrieve its own CBAM declarations.

---

### Requirement 8: Input Validation and Data Quality

**User Story:** As a plant engineer, I want the system to validate all CBAM-specific inputs before generating a declaration, so that I receive clear, actionable error messages if any required data is missing or out of range.

#### Acceptance Criteria

1. THE `CBAM_Engine` SHALL validate all `CBAMInput` fields using Pydantic V2 before performing any calculation; IF validation fails, THE `CBAM_Engine` SHALL return a structured `ValidationResult` with `is_blocked` set to `True` and SHALL NOT proceed to calculation.
2. WHEN `carbon_price_paid.amount` is negative, THE `CBAM_Engine` SHALL return a validation error with code `CBAM_NEGATIVE_CARBON_PRICE` and message `"Carbon price paid cannot be negative"`.
3. WHEN `imported_quantity_t` is zero or negative, THE `CBAM_Engine` SHALL return a validation error with code `CBAM_INVALID_QUANTITY` and message `"Imported quantity must be greater than zero"`.
4. WHEN `reporting_year` is earlier than 2026, THE `CBAM_Engine` SHALL attach a warning with code `CBAM_PRE_OBLIGATION_YEAR` and message `"CBAM declaration obligation begins for reporting year 2026; this declaration is for a pre-obligation period"`.
5. THE `CBAM_Engine` SHALL validate that `clinker_to_cement_ratio` is between 0.0 and 1.0 inclusive; IF it is outside this range, THE `CBAM_Engine` SHALL return a validation error with code `CBAM_INVALID_CLINKER_RATIO` and message `"Clinker-to-cement ratio must be between 0.0 and 1.0"`.
6. FOR ALL valid `CBAMInput` objects, the `CBAM_Engine` validation SHALL be idempotent: running validation twice on the same input SHALL produce the same `ValidationResult` (idempotence property).

---

### Requirement 9: Weekly EU ETS Price Sync (Article 23)

**User Story:** As a compliance officer, I want the CBAM certificate price to be automatically fetched from the EU ETS registry every week, so that my declarations always use the legally correct price without any manual entry or risk of using a stale figure.

#### Acceptance Criteria

1. THE `Weekly_Price_Sync` service SHALL fetch the weekly average EU ETS auction price (EUR/t CO2e) from the EU ETS registry API every Monday at 06:00 UTC and store the result in a `cbam_ets_price_history` database table with columns: `week_start_date`, `price_eur_per_t_co2e`, `source_url`, `fetched_at_utc`.
2. THE `CBAM_Engine` SHALL retrieve `Weekly_ETS_Price` exclusively from the `cbam_ets_price_history` table — the `CBAMInput` model SHALL NOT expose a manual certificate price field.
3. WHEN the `Weekly_Price_Sync` fetch fails (network error, API unavailable), THE service SHALL retain the most recent successfully fetched price and attach a system alert with code `CBAM_PRICE_SYNC_FAILED` and message `"EU ETS price sync failed; using last known price from {last_fetch_date}"`.
4. IF no price has ever been successfully fetched (cold start), THE `CBAM_Engine` SHALL return a validation error with code `CBAM_NO_ETS_PRICE` and message `"No EU ETS price available; Weekly Price Sync has not completed successfully"`.
5. THE `CBAMResult` SHALL include an `ets_price_reference` object containing `price_eur_per_t_co2e`, `week_start_date`, `source_url`, and `is_stale` (boolean, true if the price is more than 14 days old), so that the declaration is fully auditable on the price used.
6. THE `Weekly_Price_Sync` service SHALL be idempotent: running it twice in the same week SHALL NOT create duplicate records; it SHALL upsert on `week_start_date`.

---

### Requirement 10: Net Financial Impact Dashboard Card

**User Story:** As a cement factory CFO, I want to see a clear financial summary on the dashboard showing my gross CBAM obligation, domestic carbon credit, and net amount payable in EUR, so that I can immediately understand the financial impact of exporting to Europe without reading through the full declaration.

#### Acceptance Criteria

1. THE dashboard SHALL display a `Net Financial Impact` card containing three line items: `Gross EU Obligation (EUR)` = SEE × imported_quantity_t × Weekly_ETS_Price; `Domestic Credit (EUR)` = Carbon_Price_Paid_EUR × imported_quantity_t; `Net Payable (EUR)` = Gross EU Obligation − Domestic Credit (floored at 0.0).
2. THE `Net Financial Impact` card SHALL update in real time whenever the user changes `imported_quantity_t` or `carbon_price_paid` inputs, without requiring a full page reload.
3. THE `Net Financial Impact` card SHALL display the `Weekly_ETS_Price` used in the calculation with its `week_start_date` so the user knows the price basis.
4. WHEN `Net Payable` is `0.0` due to the credit exceeding the obligation, THE card SHALL display a `"Full credit applied — no net CBAM payment required"` notice in green.
5. ALL monetary values in the `Net Financial Impact` card SHALL be displayed in EUR, rounded to two decimal places, with thousand separators.
6. THE `Net Financial Impact` card SHALL be visible only to users with `role` of `"analyst"` or higher; users with `role` of `"viewer"` SHALL see the card with values redacted and a `"Contact your compliance lead for financial details"` message.
