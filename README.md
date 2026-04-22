# Tefnut — Enterprise ISO Sustainability Platform

Tefnut is an enterprise-grade sustainability reporting platform for the cement and building materials industry. It provides ISO-compliant carbon and water KPI calculations with a full cryptographic audit trail.

## Standards Supported

| Standard | Scope |
|---|---|
| **ISO 14064-1:2018** | Greenhouse gas inventory — quantification and reporting at the organisation level |
| **ISO 14046:2014** | Water footprint — principles, requirements, and guidelines |
| **GCCA Carbon Protocol** | Cement-sector-specific CO₂ intensity methodology |
| **GCCA Water Protocol** | Cement-sector-specific water KPI methodology |

## Architecture

### Backend — Amazon RDS (PostgreSQL)

- Multi-tenant PostgreSQL database hosted on **Amazon RDS**
- Row-Level Security (RLS) enforced at the database layer — every query runs inside a transaction that sets `app.current_org_id`, activating tenant-scoped policies
- Schema covers `carbon_inventory`, `water_inventory`, `generated_reports`, and `input_hash_registry` tables
- All connections use SSL (`rejectUnauthorized: true`)
- Credentials supplied exclusively via `DATABASE_URL` environment variable — never hardcoded

### File Storage — Amazon S3

- All uploaded files and generated reports stored in a private **Amazon S3** bucket (`tefnut-data`)
- Bucket layout enforces org-level isolation: `{org_id}/uploads/`, `{org_id}/processed/`, `{org_id}/reports/`
- SSE-KMS encryption at rest on every object
- Access via short-lived presigned URLs (15–30 min) — no public access
- SHA-256 integrity hash stored as S3 object metadata and verified on download
- ISO reports are immutable — deletion is blocked at the application layer

### Calculation Engines

- `carbon_engine/` — Python engine implementing GCCA Carbon Protocol (ISO 14064-1:2018)
- `water_engine/` — Python engine implementing GCCA Water Protocol (ISO 14046:2014)
- Both engines produce a cryptographic audit hash of all inputs for tamper-evident reporting

## Environment Variables

Copy `.env.example` to `.env` and fill in the values. **Never commit `.env`.**

```
DATABASE_URL=postgres://tefnut_app:<password>@<rds-host>:5432/tefnut
AWS_REGION=eu-west-1
S3_BUCKET_NAME=tefnut-data
KMS_KEY_ID=arn:aws:kms:eu-west-1:<account>:key/<key-id>
AWS_ACCESS_KEY_ID=     # omit in production — use IAM instance profile
AWS_SECRET_ACCESS_KEY= # omit in production — use IAM instance profile
DEV_ORG_ID=            # development fallback org ID
```

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Lint
npm run lint

# Format
npm run format
```

## Python Engines

```bash
cd carbon_engine
pip install -r requirements.txt
python -m pytest tests/

cd ../water_engine
python -m pytest tests/
```
