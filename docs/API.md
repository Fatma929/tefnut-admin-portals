
# Tefnut API Reference

[![Python CI](https://github.com/Fatma929/tefnut-admin-portals/actions/workflows/test.yml/badge.svg)](https://github.com/Fatma929/tefnut-admin-portals/actions/workflows/test.yml)

## Overview

Tefnut exposes two API layers:

| Layer | Runtime | Base URL |
|---|---|---|
| **Carbon / Water Engine** | AWS Lambda (Python 3.13) | `https://<api-gateway-id>.execute-api.<region>.amazonaws.com/prod` |
| **CBAM & Storage** | TanStack Start (Node.js / Cloudflare Workers) | `https://<your-domain>` |

All endpoints accept and return `application/json` unless noted otherwise.  
All responses include `Content-Type: application/json` and CORS headers (`Access-Control-Allow-Origin: *`).

---

## Authentication

> Authentication is enforced at the infrastructure level (API Gateway authorizer / Cloudflare Access).  
> The CBAM and Storage routes additionally require an `X-Org-Id` header to scope all data to the correct tenant.

| Header | Required | Description |
|---|---|---|
| `X-Org-Id` | Yes (CBAM + Storage routes) | Organisation UUID — scopes all DB queries via RLS |
| `X-User-Id` | Optional | User identifier recorded in the audit trail |
| `X-User-Role` | Optional | `admin` \| `sustainability_lead` \| `analyst` \| `auditor` \| `viewer` |
| `Authorization` | Future | JWT bearer token (not yet enforced) |

---

## Rate Limits

| Tier | Requests / minute | Notes |
|---|---|---|
| Lambda (calculate) | 100 | Enforced by API Gateway usage plan |
| CBAM routes | 60 | Cloudflare Workers rate limiting |
| Storage presign | 200 | S3 presigned URL generation |

Exceeding limits returns `429 Too Many Requests`.

---

## Audit Trail

Every calculation response includes an `audit_trail` object:

```json
{
  "audit_trail": {
    "source_reference": {
      "source_filename": "cement_data_2024.xlsx",
      "upload_timestamp_utc": "2026-01-15T10:30:00Z",
      "input_hash": "a3f8c2d1e9b047f6..."
    },
    "user_id": "user_001"
  }
}
```

- `input_hash` — SHA-256 hex digest of the canonical JSON serialisation of all inputs (`json.dumps(data, sort_keys=True)`). Identical inputs always produce the same hash, enabling duplicate detection.
- `upload_timestamp_utc` — ISO-8601 UTC timestamp of when the data was received.
- Duplicate submissions (same `input_hash`) return a `DUPLICATE_SUBMISSION` warning but do **not** block the response.

---

## Error Format

All errors follow this envelope:

```json
{
  "error": "Human-readable summary",
  "detail": [ ... ]
}
```

`detail` is present on validation errors and contains a list of field-level error objects:

```json
{
  "error": "Validation failed",
  "detail": [
    {
      "error_code": "MISSING_COLUMN",
      "field": "cement_production_t_yr",
      "message": "Required field 'cement_production_t_yr' is missing or null.",
      "suggested_fix": "Provide a value for the required field.",
      "meta": {}
    }
  ]
}
```

### HTTP Status Codes

| Code | Meaning | When |
|---|---|---|
| `200` | OK | Calculation succeeded (may include non-blocking warnings) |
| `400` | Bad Request | Malformed JSON, missing required fields, empty file |
| `403` | Forbidden | Tenant isolation violation (wrong `X-Org-Id` for S3 key) |
| `422` | Unprocessable Entity | Pydantic validation failed — field-level errors in `detail` |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Internal Server Error | Unexpected calculation or infrastructure error |

### Validation Error Codes

| Code | Blocking | Description |
|---|---|---|
| `MISSING_COLUMN` | Yes | Required field absent or null |
| `NEGATIVE_VALUE_ERROR` | Yes | Numeric field has a negative value |
| `INVALID_CATEGORY` | Yes | Enum field contains an unrecognised value |
| `DUPLICATE_SUBMISSION` | Yes | Same `input_hash` already processed |
| `CRITICAL_DATA_ERROR` | Yes | Computed value is physically impossible |
| `UNIT_MISMATCH_SUSPECTED` | No | Value likely entered in wrong unit (e.g. kg instead of t) |
| `OUT_OF_INDUSTRY_RANGE` | No | Specific CO₂ outside 300–1000 kg/t cement range |
| `INCONSISTENT_FUEL_DATA` | No | Fuel emission factor or consumption looks inconsistent |
| `NEGATIVE_CONSUMPTION_ERROR` | No | Water discharge exceeds withdrawal; consumption clamped to 0 |

---

## Endpoints

---

### POST /api/calculate

Calculate carbon footprint from a JSON body.

**Runtime:** AWS Lambda (Python)  
**Content-Type:** `application/json`

#### Request Body

Mirrors the `PlantInput` Pydantic model (`carbon_engine/carbon_engine.py`).

```json
{
  "plant_name": "Suez Cement Plant",
  "reporting_year": 2026,
  "calcination_method": "B1",
  "calcination_b1": {
    "clinker_production_t_yr": 1200000,
    "bypass_dust_t_yr": 0,
    "ckd_leaving_kiln_t_yr": 15000,
    "ckd_calcination_rate_d": 0.85,
    "calcination_ef_kg_per_t_clinker": 525.0
  },
  "kiln_fuels": [
    {
      "fuel_type": "coal_anthracite",
      "consumption_t_per_yr": 180000,
      "lhv_gj_per_t": 26.7,
      "ef_kg_co2_per_gj": null,
      "biogenic_fraction": 0.0
    }
  ],
  "non_kiln_fuels": [],
  "cement_production_t_yr": 1500000,
  "clinker_production_t_yr": 1200000,
  "electricity": {
    "purchased_electricity_mwh_yr": 320000,
    "grid_ef_kg_co2_per_mwh": 0.45
  },
  "transport_entries": [],
  "water": {
    "withdrawal_m3_yr": 550000,
    "discharge_m3_yr": 100000,
    "recycled_m3_yr": 38000
  },
  "cbam_goods_count": 0,
  "cbam_data_completeness_pct": 0.0
}
```

#### Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `plant_name` | string | Yes | Installation name |
| `reporting_year` | integer (2000–2100) | Yes | Calendar year of the inventory |
| `calcination_method` | `"B1"` \| `"A1"` | Yes | GCCA calcination method |
| `calcination_b1` | object | If method=B1 | Simple output method inputs |
| `calcination_a1` | object | If method=A1 | LOI-based input method inputs |
| `kiln_fuels` | array | No | Fuels burned in the kiln |
| `non_kiln_fuels` | array | No | Fuels burned outside the kiln |
| `cement_production_t_yr` | float > 0 | Yes | Total cementitious production (tonnes/year) |
| `electricity` | object | No | Grid electricity consumption |
| `transport_entries` | array | No | Scope 3 logistics entries |
| `water` | object | No | Water withdrawal/discharge/recycled |

**`calcination_b1` fields:**

| Field | Type | Default | Description |
|---|---|---|---|
| `clinker_production_t_yr` | float > 0 | — | Annual clinker output |
| `bypass_dust_t_yr` | float ≥ 0 | 0 | Bypass dust removed from kiln |
| `ckd_leaving_kiln_t_yr` | float ≥ 0 | 0 | Cement kiln dust leaving kiln |
| `ckd_calcination_rate_d` | float 0–1 | 0 | Calcination rate of CKD |
| `calcination_ef_kg_per_t_clinker` | float > 0 | 525.0 | Emission factor (kg CO₂/t clinker) |

**`fuel_type` allowed values:**
`coal_anthracite`, `petrol_coke`, `heavy_fuel_oil`, `diesel_oil`, `natural_gas`, `oil_shale`, `lignite`, `gasoline`, `waste_oil`, `tyres`, `rdf_plastics`, `solvents`, `impregnated_saw_dust`, `mixed_industrial_waste`, `other_fossil_waste`, `dried_sewage_sludge`, `wood_saw_dust`, `paper_carton`, `animal_meal`, `animal_bone_meal`, `animal_fat`, `other_biomass`

#### Response — 200 OK

```json
{
  "plant_name": "Suez Cement Plant",
  "reporting_year": 2026,
  "scope1": {
    "calcination_co2_t": 641250.0,
    "fuel_combustion_co2_t": 461124.0,
    "biomass_co2_memo_t": 0.0,
    "total_scope1_co2_t": 1102374.0
  },
  "scope2": {
    "electricity_co2_t": 144.0
  },
  "scope3": {
    "transport_co2_t": 0.0
  },
  "total_co2e_t": 1102518.0,
  "specific_co2_kg_per_t_cement": 735.012,
  "energy": {
    "total_kiln_energy_tj": 4806.0,
    "total_non_kiln_energy_tj": 0.0,
    "energy_intensity_gj_per_t_clinker": 4.005
  },
  "water": {
    "withdrawal_m3": 550000.0,
    "consumption_m3": 450000.0,
    "recycled_m3": 38000.0
  },
  "cbam": {
    "specific_embedded_co2_t_per_t_cement": 0.7351,
    "completeness_pct": 0.0,
    "goods_count": 0
  },
  "source_mix": [
    { "name": "Process emissions", "value": 58.2 },
    { "name": "Fuel combustion (kiln)", "value": 41.8 },
    { "name": "Fuel combustion (non-kiln)", "value": 0.0 },
    { "name": "Electricity", "value": 0.0 },
    { "name": "Logistics", "value": 0.0 }
  ],
  "validation_warnings": []
}
```

#### Examples

**curl:**
```bash
curl -X POST https://<lambda-url>/api/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "plant_name": "Suez Cement Plant",
    "reporting_year": 2026,
    "calcination_method": "B1",
    "calcination_b1": { "clinker_production_t_yr": 1200000 },
    "cement_production_t_yr": 1500000
  }'
```

**Python:**
```python
import requests

response = requests.post(
    "https://<lambda-url>/api/calculate",
    json={
        "plant_name": "Suez Cement Plant",
        "reporting_year": 2026,
        "calcination_method": "B1",
        "calcination_b1": {"clinker_production_t_yr": 1200000},
        "cement_production_t_yr": 1500000,
    },
)
result = response.json()
print(result["specific_co2_kg_per_t_cement"])  # e.g. 735.012
```

**JavaScript (fetch):**
```js
const res = await fetch("https://<lambda-url>/api/calculate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    plant_name: "Suez Cement Plant",
    reporting_year: 2026,
    calcination_method: "B1",
    calcination_b1: { clinker_production_t_yr: 1200000 },
    cement_production_t_yr: 1500000,
  }),
});
const result = await res.json();
```

---

### POST /api/calculate/upload

Calculate carbon footprint from an Excel (.xlsx) or CSV file.

**Runtime:** AWS Lambda (Python)  
**Content-Type:** `multipart/form-data` OR `application/octet-stream`

#### Request

**Option A — multipart/form-data (recommended):**
```
POST /api/calculate/upload
Content-Type: multipart/form-data; boundary=----boundary

------boundary
Content-Disposition: form-data; name="file"; filename="plant_data.xlsx"
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet

<binary file content>
------boundary--
```

**Option B — raw binary:**
```
POST /api/calculate/upload
Content-Type: application/octet-stream
X-Filename: plant_data.xlsx

<binary file content>
```

**Supported file formats:** `.xlsx`, `.xls`, `.csv`

#### Excel Template Structure

The Excel file must contain a `Plant Info` sheet with these rows:

| Row key | Example value | Required |
|---|---|---|
| `plant_name` | `Suez Cement Plant` | Yes |
| `reporting_year` | `2026` | Yes |
| `calcination_method` | `B1` | Yes |
| `clinker_production_t_yr` | `1200000` | If B1 |
| `cement_production_t_yr` | `1500000` | Yes |
| `purchased_electricity_mwh_yr` | `320000` | No |
| `grid_ef_kg_co2_per_mwh` | `0.45` | No |

An optional `Kiln Fuels` sheet may contain one row per fuel type with columns: `fuel_type`, `consumption_t_per_yr`, `lhv_gj_per_t`, `ef_kg_co2_per_gj`.

Download the template: `GET /api/calculate/template` *(not yet implemented — use `carbon_engine/generate_template.py` locally)*.

#### Response — 200 OK

```json
{
  "result": { ... },
  "parsed_input": { ... }
}
```

`result` is identical to the `POST /api/calculate` response.  
`parsed_input` echoes back the `PlantInput` that was parsed from the file — useful for verifying the parser interpreted the data correctly.

#### curl example:
```bash
curl -X POST https://<lambda-url>/api/calculate/upload \
  -F "file=@plant_data.xlsx"
```

---

### POST /api/cbam/calculate

Calculate CBAM Specific Embedded Emissions and certificate obligation.

**Runtime:** TanStack Start (Node.js)  
**Auth:** `X-Org-Id` header required

#### Request Body

```json
{
  "plant_name": "Suez Cement Plant",
  "reporting_year": 2026,
  "calcination_method": "B1",
  "calcination_b1": { "clinker_production_t_yr": 1200000 },
  "cement_production_t_yr": 1500000,
  "product_type": "other_portland_cement",
  "imported_quantity_t": 50000,
  "carbon_price_paid": {
    "amount": 150.0,
    "currency_code": "EGP"
  },
  "transaction_date": "2026-03-15",
  "installation_latitude": 29.9792,
  "installation_longitude": 31.1342,
  "production_process": {
    "process_type": "dry_kiln_ph_pc",
    "kiln_capacity_t_clinker_per_day": 5000,
    "annual_operating_hours": 8000,
    "clinker_to_cement_ratio": 0.78
  },
  "declarant_eori": "EG123456789",
  "transaction_date": "2026-03-15"
}
```

**`product_type` allowed values:**

| Value | CN Code | Description |
|---|---|---|
| `cement_clinker` | 2523 10 | Cement clinker |
| `white_cement` | 2523 21 | White Portland cement |
| `other_portland_cement` | 2523 29 | Other Portland cement |
| `aluminous_cement` | 2523 30 | Aluminous cement |
| `other_hydraulic_cement` | 2523 90 | Other hydraulic cements |

**`process_type` allowed values:**

| Value | Description |
|---|---|
| `dry_kiln` | Basic dry process kiln |
| `wet_kiln` | Wet process kiln |
| `semi_dry_kiln` | Semi-dry (Lepol) kiln |
| `dry_kiln_ph_pc` | Dry kiln with Preheater + Precalciner — primary benchmark |

#### Response — 200 OK

```json
{
  "see_breakdown": {
    "direct_emissions_t": 30000.0,
    "indirect_emissions_t": 5000.0,
    "total_embedded_co2e_t": 35000.0,
    "specific_embedded_emissions_t_per_t": 0.600000
  },
  "direct_emissions": {
    "calcination_co2_t": 25000.0,
    "fuel_combustion_co2_t": 5000.0,
    "total_direct_co2_t": 30000.0,
    "regulatory_classification": "Article 19 - Direct"
  },
  "indirect_emissions": {
    "electricity_co2_t": 5000.0,
    "total_indirect_co2_t": 5000.0,
    "regulatory_classification": "Article 19 - Indirect"
  },
  "carbon_price_credit": {
    "original_amount": 150.0,
    "original_currency": "EGP",
    "exchange_rate_eur": 0.019,
    "rate_date": "2026-03-15",
    "carbon_price_paid_eur_per_t_co2e": 2.85,
    "imported_quantity_t": 50000,
    "credit_amount_eur": 142500.0,
    "net_cbam_obligation_certificates": 27807.69
  },
  "ets_price_reference": {
    "price_eur_per_t_co2e": 65.0,
    "week_start_date": "2026-03-09",
    "source_url": "https://www.eex.com/...",
    "is_stale": false
  },
  "cn_classification": {
    "cn_code": "2523 29",
    "product_type": "other_portland_cement",
    "cn_description": "Other Portland cement",
    "cbam_in_scope": true
  },
  "installation_metadata": {
    "installation_name": "Suez Cement Plant",
    "latitude": 29.9792,
    "longitude": 31.1342,
    "country": "",
    "production_process": { "process_type": "dry_kiln_ph_pc", "..." : "..." },
    "reporting_period": "2026"
  },
  "declaration_sha256": "",
  "compliance_warnings": [
    "Non-CO2 GHGs (N2O, PFCs) are negligible for this installation type as per GCCA Cement CO2 and Energy Protocol v3.1. Values set to zero."
  ],
  "validation_warnings": []
}
```

#### curl example:
```bash
curl -X POST https://<domain>/api/cbam/calculate \
  -H "Content-Type: application/json" \
  -H "X-Org-Id: org_abc123" \
  -d '{
    "plant_name": "Suez Cement Plant",
    "reporting_year": 2026,
    "calcination_method": "B1",
    "calcination_b1": { "clinker_production_t_yr": 1200000 },
    "cement_production_t_yr": 1500000,
    "product_type": "other_portland_cement",
    "imported_quantity_t": 50000,
    "carbon_price_paid": { "amount": 150.0, "currency_code": "EGP" },
    "production_process": {
      "process_type": "dry_kiln_ph_pc",
      "kiln_capacity_t_clinker_per_day": 5000,
      "annual_operating_hours": 8000,
      "clinker_to_cement_ratio": 0.78
    },
    "declarant_eori": "EG123456789"
  }'
```

---

### POST /api/cbam/declaration

Generate, hash, and store a CBAM Declaration per EU Regulation 2023/956 Article 47.

**Runtime:** TanStack Start (Node.js)  
**Auth:** `X-Org-Id` header required

#### Request Body

Same as `POST /api/cbam/calculate` — see above.

#### Response — 200 OK

```json
{
  "declaration": {
    "template_version": "EU_CBAM_TRANSITIONAL_2024",
    "declaration_metadata": {
      "reporting_period": "2026",
      "submission_date": "2026-05-31",
      "declarant_eori": "EG123456789"
    },
    "installation_metadata": { "..." : "..." },
    "cn_classification": { "..." : "..." },
    "see_breakdown": { "..." : "..." },
    "direct_emissions": { "..." : "..." },
    "indirect_emissions": { "..." : "..." },
    "carbon_price_credit": { "..." : "..." },
    "covered_gases": ["CO2", "N2O", "PFCs"],
    "compliance_warnings": ["..."],
    "standards_cited": [
      "EU Regulation 2023/956",
      "CBAM Implementing Regulation 2023/1773",
      "GCCA Cement CO2 and Energy Protocol v3.1"
    ]
  },
  "result": { "declaration_sha256": "a3f8c2d1...", "..." : "..." },
  "report_id": "cbam-org_abc123-facility_001-2026-1714123456789"
}
```

The `declaration` object is the exact JSON to submit to EU CBAM authorities.  
`result.declaration_sha256` is the SHA-256 of the declaration (sorted keys, UTF-8) — record this for submission verification.

#### Duplicate Detection

If a declaration with the same `facility_id`, `reporting_year`, and `sha256_hash` already exists, the existing record is returned with a `CBAM_DECLARATION_ALREADY_EXISTS` warning — no duplicate is created.

---

### POST /api/storage

Manage file uploads and downloads via S3 presigned URLs.

**Runtime:** TanStack Start (Node.js)  
**Auth:** `X-Org-Id` header required

All three actions share the same endpoint — the `action` field in the body selects the operation.

---

#### Action: `upload-url`

Get a presigned PUT URL for direct browser-to-S3 upload.

**Request:**
```json
{
  "action": "upload-url",
  "filename": "cement_data_2026.xlsx",
  "fileType": "uploads",
  "contentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "sha256Hash": "a3f8c2d1e9b047f6...",
  "expiresInSeconds": 900
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `filename` | string | Yes | Original filename |
| `fileType` | `"uploads"` \| `"processed"` \| `"reports"` | Yes | S3 path segment |
| `contentType` | string | Yes | MIME type |
| `sha256Hash` | string | Yes | SHA-256 of the file (hex) — stored as S3 metadata |
| `expiresInSeconds` | integer | No | URL validity (default 900, max 1800) |

**Response:**
```json
{
  "url": "https://tefnut-data.s3.eu-west-1.amazonaws.com/org_abc123/uploads/cement_data_2026.xlsx?X-Amz-...",
  "key": "org_abc123/uploads/cement_data_2026.xlsx",
  "expiresAt": "2026-01-15T11:15:00.000Z"
}
```

**Upload the file directly from the browser:**
```js
await fetch(presignedUrl, {
  method: "PUT",
  headers: { "Content-Type": contentType },
  body: fileBlob,
});
```

---

#### Action: `download-url`

Get a presigned GET URL for a stored file.

**Request:**
```json
{
  "action": "download-url",
  "s3Key": "org_abc123/reports/cbam_declaration_suez_2026.json",
  "sha256Hash": "a3f8c2d1...",
  "expiresInSeconds": 900
}
```

**Response:**
```json
{
  "url": "https://tefnut-data.s3.eu-west-1.amazonaws.com/org_abc123/reports/...?X-Amz-...",
  "key": "org_abc123/reports/cbam_declaration_suez_2026.json",
  "expiresAt": "2026-01-15T11:15:00.000Z"
}
```

> Tenant isolation is enforced: the `org_id` prefix in `s3Key` must match the `X-Org-Id` header. Mismatches return `403 Forbidden` with error `S3_TENANT_VIOLATION`.

---

#### Action: `verify`

Verify a file's SHA-256 integrity against the hash stored in S3 metadata.

**Request:**
```json
{
  "action": "verify",
  "s3Key": "org_abc123/uploads/cement_data_2026.xlsx",
  "sha256Hash": "a3f8c2d1e9b047f6..."
}
```

**Response:**
```json
{
  "verified": true,
  "storedHash": "a3f8c2d1e9b047f6..."
}
```

`verified: false` means the file was modified after upload.

---

### POST /api/persist

Persist a calculation result to the database after a successful engine call.

**Runtime:** TanStack Start (Cloudflare Workers / D1)  
**Auth:** `X-Org-Id` header required

#### Request Body

```json
{
  "type": "carbon",
  "result": { "..." : "..." },
  "fileHash": "a3f8c2d1...",
  "fileName": "cement_data_2026.xlsx",
  "fileSize": 204800,
  "facilityId": "facility_001",
  "userId": "user_001",
  "reportingYear": 2026
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"carbon"` \| `"water"` | Yes | Engine type |
| `result` | object | Yes | Full `CarbonResult` or `WaterResult` |
| `fileHash` | string | Yes | SHA-256 of the uploaded file |
| `fileName` | string | Yes | Original filename |
| `fileSize` | integer | No | File size in bytes |
| `facilityId` | string | Yes | Facility UUID |
| `userId` | string | No | User identifier (default: `"anonymous"`) |
| `reportingYear` | integer | No | Defaults to current year |

#### Response — 200 OK

```json
{
  "recordIds": ["uuid-1", "uuid-2"],
  "isDuplicate": false,
  "firstSeenAt": null,
  "uploadedFileId": "uuid-file"
}
```

If `isDuplicate: true`, `firstSeenAt` contains the ISO-8601 timestamp of the original submission.

---

## OpenAPI Schema Export

Generate an OpenAPI 3.1 schema from the Pydantic models:

```bash
cd carbon_engine
python - <<'EOF'
from pydantic import TypeAdapter
from carbon_engine.carbon_engine import PlantInput, CalculationResult
import json

schema = {
    "openapi": "3.1.0",
    "info": {"title": "Tefnut Carbon Engine", "version": "1.0.0"},
    "components": {
        "schemas": {
            "PlantInput": PlantInput.model_json_schema(),
            "CalculationResult": CalculationResult.model_json_schema(),
        }
    }
}
print(json.dumps(schema, indent=2))
EOF
```

For the CBAM engine:

```bash
cd cbam_engine
python - <<'EOF'
from cbam_engine.cbam_engine import CBAMInput, CBAMResult
import json

schema = {
    "openapi": "3.1.0",
    "info": {"title": "Tefnut CBAM Engine", "version": "1.0.0"},
    "components": {
        "schemas": {
            "CBAMInput": CBAMInput.model_json_schema(),
            "CBAMResult": CBAMResult.model_json_schema(),
        }
    }
}
print(json.dumps(schema, indent=2))
EOF
```

---

## Standards & Compliance

| Standard | Scope | Relevant Endpoints |
|---|---|---|
| ISO 14064-1:2018 | GHG inventory quantification | `/api/calculate`, `/api/persist` |
| ISO 14046:2014 | Water footprint | `/api/calculate`, `/api/persist` |
| EU Regulation 2023/956 (CBAM) | Carbon border adjustment | `/api/cbam/calculate`, `/api/cbam/declaration` |
| CBAM Implementing Regulation 2023/1773 | CBAM transitional period reporting | `/api/cbam/declaration` |
| GCCA Cement CO₂ and Energy Protocol v3.1 | Cement-sector methodology | All calculation endpoints |
