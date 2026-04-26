
"""
Tefnut — Client Master Data Importer
Imports company/plant/contact data from Excel or CSV into the platform.

Features:
  - Auto-detects existing companies by name+country (upsert, not duplicate)
  - Normalises into companies, plants, reporting_profiles, client_contacts
  - Full validation with structured error/warning output
  - Audit trail via client_import_log
  - Backward compatible — creates organizations + facilities entries too

Expected Excel columns (case-insensitive, extra columns ignored):
  company_name*, company_size, industry, sub_industry, country*, city,
  plant_name*, plant_capacity, employee_count, reporting_year*,
  contact_name, contact_email, currency, export_to_eu_flag,
  kiln_type, production_lines, plant_type, website, eori_number,
  reporting_standard, fiscal_year_start, base_year

  * = required
"""
from __future__ import annotations

import hashlib
import io
import logging
from dataclasses import dataclass, field
from typing import Any, Optional
from uuid import uuid4

import pandas as pd
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Column aliases — maps common variations to canonical names
# ---------------------------------------------------------------------------
_COLUMN_ALIASES: dict[str, str] = {
    "company": "company_name",
    "name": "company_name",
    "organisation": "company_name",
    "organization": "company_name",
    "size": "company_size",
    "sector": "industry",
    "sub_sector": "sub_industry",
    "location": "city",
    "capacity": "plant_capacity",
    "capacity_t_yr": "plant_capacity",
    "employees": "employee_count",
    "year": "reporting_year",
    "contact": "contact_name",
    "email": "contact_email",
    "export_eu": "export_to_eu_flag",
    "export_to_eu": "export_to_eu_flag",
    "eu_export": "export_to_eu_flag",
    "kiln": "kiln_type",
    "lines": "production_lines",
    "plant_type_detail": "plant_type",
}

_REQUIRED_COLUMNS = {"company_name", "country", "plant_name", "reporting_year"}

_VALID_COMPANY_SIZES = {"micro", "small", "medium", "large", "enterprise"}
_VALID_KILN_TYPES = {"dry_kiln", "wet_kiln", "semi_dry_kiln", "dry_kiln_ph_pc", "vertical_shaft_kiln", "other"}
_VALID_PLANT_TYPES = {"integrated", "grinding_only", "clinker_only", "white_cement", "other"}
_VALID_STANDARDS = {"GHG Protocol", "ISO 14064-1", "GCCA", "EU CBAM", "CDP", "GRI"}


# ---------------------------------------------------------------------------
# Pydantic row schema
# ---------------------------------------------------------------------------
class ClientRow(BaseModel):
    """One validated row from the import sheet."""
    company_name: str = Field(..., min_length=1, max_length=255)
    country: str = Field(..., min_length=2, max_length=100)
    plant_name: str = Field(..., min_length=1, max_length=255)
    reporting_year: int = Field(..., ge=2000, le=2100)

    # Optional company fields
    company_size: Optional[str] = None
    industry: str = "cement"
    sub_industry: Optional[str] = None
    city: Optional[str] = None
    website: Optional[str] = None
    employee_count: Optional[int] = Field(None, ge=0)
    currency: str = Field("USD", min_length=3, max_length=3)
    export_to_eu_flag: bool = False
    eori_number: Optional[str] = None
    reporting_standard: str = "GCCA"
    fiscal_year_start: int = Field(1, ge=1, le=12)
    base_year: Optional[int] = Field(None, ge=1990, le=2100)

    # Optional plant fields
    plant_capacity: Optional[float] = Field(None, ge=0)
    plant_type: str = "integrated"
    kiln_type: Optional[str] = None
    production_lines: Optional[int] = Field(None, ge=1, le=50)

    # Optional contact fields
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None

    @field_validator("company_size", mode="before")
    @classmethod
    def normalise_company_size(cls, v: Any) -> Optional[str]:
        if v is None or str(v).strip().lower() in ("", "nan", "none"):
            return None
        s = str(v).strip().lower()
        if s not in _VALID_COMPANY_SIZES:
            raise ValueError(f"company_size must be one of {_VALID_COMPANY_SIZES}, got '{v}'")
        return s

    @field_validator("kiln_type", mode="before")
    @classmethod
    def normalise_kiln_type(cls, v: Any) -> Optional[str]:
        if v is None or str(v).strip().lower() in ("", "nan", "none"):
            return None
        s = str(v).strip().lower().replace(" ", "_")
        if s not in _VALID_KILN_TYPES:
            return "other"
        return s

    @field_validator("plant_type", mode="before")
    @classmethod
    def normalise_plant_type(cls, v: Any) -> str:
        if v is None or str(v).strip().lower() in ("", "nan", "none"):
            return "integrated"
        s = str(v).strip().lower().replace(" ", "_")
        return s if s in _VALID_PLANT_TYPES else "other"

    @field_validator("export_to_eu_flag", mode="before")
    @classmethod
    def parse_bool(cls, v: Any) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, (int, float)):
            return bool(v)
        s = str(v).strip().lower()
        return s in ("yes", "true", "1", "y", "oui", "si")

    @field_validator("reporting_standard", mode="before")
    @classmethod
    def normalise_standard(cls, v: Any) -> str:
        if v is None or str(v).strip().lower() in ("", "nan"):
            return "GCCA"
        return str(v).strip()

    @field_validator("currency", mode="before")
    @classmethod
    def normalise_currency(cls, v: Any) -> str:
        if v is None or str(v).strip().lower() in ("", "nan"):
            return "USD"
        return str(v).strip().upper()[:3]

    @model_validator(mode="before")
    @classmethod
    def strip_strings(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {
                k: v.strip() if isinstance(v, str) else v
                for k, v in data.items()
            }
        return data


# ---------------------------------------------------------------------------
# Import result
# ---------------------------------------------------------------------------
@dataclass
class ImportResult:
    batch_id: str = field(default_factory=lambda: str(uuid4()))
    total_rows: int = 0
    imported_companies: int = 0
    imported_plants: int = 0
    updated_companies: int = 0
    updated_plants: int = 0
    skipped_rows: int = 0
    failed_rows: int = 0
    errors: list[dict] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    # Structured output for DB insertion
    companies: list[dict] = field(default_factory=list)
    plants: list[dict] = field(default_factory=list)
    contacts: list[dict] = field(default_factory=list)
    reporting_profiles: list[dict] = field(default_factory=list)

    def add_error(self, row: int, field_name: str, message: str) -> None:
        self.errors.append({"row": row, "field": field_name, "message": message})
        self.failed_rows += 1

    def add_warning(self, row: int, field_name: str, message: str) -> None:
        self.warnings.append({"row": row, "field": field_name, "message": message})

    @property
    def is_success(self) -> bool:
        return self.failed_rows == 0

    def summary(self) -> dict:
        return {
            "batch_id": self.batch_id,
            "total_rows": self.total_rows,
            "imported_companies": self.imported_companies,
            "imported_plants": self.imported_plants,
            "updated_companies": self.updated_companies,
            "updated_plants": self.updated_plants,
            "skipped_rows": self.skipped_rows,
            "failed_rows": self.failed_rows,
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "errors": self.errors[:50],    # cap for API response
            "warnings": self.warnings[:50],
        }


# ---------------------------------------------------------------------------
# Importer
# ---------------------------------------------------------------------------
class ClientImporter:
    """
    Parses an Excel or CSV file and produces structured records
    ready for insertion into companies, plants, reporting_profiles,
    and client_contacts tables.

    Does NOT write to the DB directly — returns ImportResult so the
    caller (API route or admin script) controls the transaction.
    """

    def __init__(self, existing_companies: Optional[list[dict]] = None) -> None:
        """
        Args:
            existing_companies: List of existing company dicts from DB
                                 (keys: company_name, country, org_id, id).
                                 Used for duplicate detection / upsert logic.
        """
        self._existing: dict[str, dict] = {}
        for c in (existing_companies or []):
            key = self._company_key(c.get("company_name", ""), c.get("country", ""))
            self._existing[key] = c

    # ------------------------------------------------------------------
    # Public entry points
    # ------------------------------------------------------------------
    def import_excel(self, file_bytes: bytes, filename: str) -> ImportResult:
        """Parse an Excel file and return ImportResult."""
        try:
            df = pd.read_excel(io.BytesIO(file_bytes), engine="openpyxl")
        except Exception as exc:
            result = ImportResult()
            result.add_error(0, "file", f"Cannot read Excel file: {exc}")
            return result
        return self._process_dataframe(df, filename, file_bytes)

    def import_csv(self, file_bytes: bytes, filename: str) -> ImportResult:
        """Parse a CSV file and return ImportResult."""
        try:
            df = pd.read_csv(io.BytesIO(file_bytes), encoding="utf-8-sig")
        except Exception as exc:
            result = ImportResult()
            result.add_error(0, "file", f"Cannot read CSV file: {exc}")
            return result
        return self._process_dataframe(df, filename, file_bytes)

    # ------------------------------------------------------------------
    # Core processing
    # ------------------------------------------------------------------
    def _process_dataframe(
        self, df: pd.DataFrame, filename: str, raw_bytes: bytes
    ) -> ImportResult:
        result = ImportResult()
        result.total_rows = len(df)

        # Normalise column names
        df.columns = [self._normalise_col(c) for c in df.columns]

        # Check required columns
        missing_required = _REQUIRED_COLUMNS - set(df.columns)
        if missing_required:
            result.add_error(0, "columns", f"Missing required columns: {missing_required}")
            return result

        # Track seen company keys to detect duplicates within the file
        seen_companies: dict[str, str] = {}   # key → batch_id of first occurrence

        for idx, raw_row in df.iterrows():
            row_num = int(idx) + 2  # 1-indexed, +1 for header
            row_dict = self._clean_row(raw_row.to_dict())

            # Validate with Pydantic
            try:
                row = ClientRow(**row_dict)
            except Exception as exc:
                result.add_error(row_num, "validation", str(exc))
                continue

            company_key = self._company_key(row.company_name, row.country)
            existing = self._existing.get(company_key)
            is_update = existing is not None
            is_infile_dup = company_key in seen_companies

            # Build company record
            company_id = existing["id"] if is_update else str(uuid4())
            org_id = existing["org_id"] if is_update else str(uuid4())

            if not is_infile_dup:
                seen_companies[company_key] = company_id
                company_rec = {
                    "id": company_id,
                    "org_id": org_id,
                    "company_name": row.company_name,
                    "company_size": row.company_size,
                    "industry": row.industry,
                    "sub_industry": row.sub_industry,
                    "country": row.country,
                    "city": row.city,
                    "website": row.website,
                    "currency": row.currency,
                    "fiscal_year_start": row.fiscal_year_start,
                    "export_to_eu": row.export_to_eu_flag,
                    "eori_number": row.eori_number,
                    "reporting_standard": row.reporting_standard,
                    "employee_count": row.employee_count,
                    "source_file": filename,
                    "source_row": row_num,
                    "import_batch_id": result.batch_id,
                    "_is_update": is_update,
                }
                result.companies.append(company_rec)
                if is_update:
                    result.updated_companies += 1
                else:
                    result.imported_companies += 1
            else:
                # Same company appears again — just use the existing company_id
                company_id = seen_companies[company_key]
                org_id = (
                    next(c["org_id"] for c in result.companies if c["id"] == company_id)
                    if not is_update else existing["org_id"]
                )
                result.add_warning(
                    row_num, "company_name",
                    f"Company '{row.company_name}' ({row.country}) appears multiple times — "
                    "additional plants linked to first occurrence.",
                )

            # Build plant record
            plant_id = str(uuid4())
            plant_rec = {
                "id": plant_id,
                "facility_id": str(uuid4()),   # new facilities entry
                "org_id": org_id,
                "company_id": company_id,
                "plant_name": row.plant_name,
                "plant_type": row.plant_type,
                "country": row.country,
                "city": row.city,
                "plant_capacity_t_yr": row.plant_capacity,
                "kiln_type": row.kiln_type,
                "production_lines": row.production_lines,
                "source_file": filename,
                "source_row": row_num,
                "import_batch_id": result.batch_id,
            }
            result.plants.append(plant_rec)
            result.imported_plants += 1

            # Build reporting profile
            rp_rec = {
                "id": str(uuid4()),
                "org_id": org_id,
                "company_id": company_id,
                "reporting_year": row.reporting_year,
                "reporting_standard": row.reporting_standard,
                "includes_cbam": row.export_to_eu_flag,
                "base_year": row.base_year,
                "source_file": filename,
                "import_batch_id": result.batch_id,
            }
            result.reporting_profiles.append(rp_rec)

            # Build contact record
            if row.contact_name or row.contact_email:
                if row.contact_email and not self._is_valid_email(row.contact_email):
                    result.add_warning(
                        row_num, "contact_email",
                        f"Invalid email format: '{row.contact_email}' — contact saved without email.",
                    )
                    row = row.model_copy(update={"contact_email": None})

                contact_rec = {
                    "id": str(uuid4()),
                    "org_id": org_id,
                    "company_id": company_id,
                    "contact_name": row.contact_name or "",
                    "contact_email": row.contact_email,
                    "is_primary": True,
                }
                result.contacts.append(contact_rec)

        return result

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _company_key(name: str, country: str) -> str:
        """Normalised deduplication key."""
        return f"{name.strip().lower()}|{country.strip().lower()}"

    @staticmethod
    def _normalise_col(col: str) -> str:
        """Lowercase, strip, replace spaces/hyphens with underscores, apply aliases."""
        normalised = col.strip().lower().replace(" ", "_").replace("-", "_")
        return _COLUMN_ALIASES.get(normalised, normalised)

    @staticmethod
    def _clean_row(row: dict) -> dict:
        """Replace NaN/None with Python None; strip strings."""
        cleaned = {}
        for k, v in row.items():
            if v is None:
                cleaned[k] = None
            elif isinstance(v, float) and (v != v):  # NaN check
                cleaned[k] = None
            elif isinstance(v, str):
                cleaned[k] = v.strip() or None
            else:
                cleaned[k] = v
        return cleaned

    @staticmethod
    def _is_valid_email(email: str) -> bool:
        import re
        return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email))

    @staticmethod
    def file_sha256(file_bytes: bytes) -> str:
        return hashlib.sha256(file_bytes).hexdigest()
