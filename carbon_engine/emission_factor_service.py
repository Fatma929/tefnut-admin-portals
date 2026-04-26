
"""
Tefnut — Emission Factor Service
Persistent DB-backed emission factor management with four-tier priority selection.

Priority (lower = higher):
  1  plant-specific   (org_id + facility_id set)
  2  geography-specific (org_id set, geography matches)
  3  latest active source (org_id set, no geography filter)
  4  internal default  (org_id IS NULL — global)

Integrates with:
  - carbon_engine.carbon_engine.CarbonEngine (calcination + fuel EFs)
  - carbon_engine.factor_provider.FactorProvider (backward compat shim)
  - calculation_factor_usage table (full traceability)
"""
from __future__ import annotations

import csv
import io
import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional
from uuid import UUID, uuid4

import pandas as pd
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pydantic schemas (API contract)
# ---------------------------------------------------------------------------

class EFSourceType(str):
    GCCA_DEFAULT = "gcca_default"
    IPCC_EFDB = "ipcc_efdb"
    NATIONAL_INVENTORY = "national_inventory"
    PEER_REVIEWED = "peer_reviewed"
    PLANT_SPECIFIC = "plant_specific"
    OPERATOR_SUPPLIED = "operator_supplied"
    REGULATORY = "regulatory"
    OTHER = "other"


class EmissionFactorCreate(BaseModel):
    factor_code: str = Field(..., min_length=1, max_length=100)
    category: str = Field(..., description="fuel | electricity | cement_process | transport | water")
    subcategory: str
    fuel_type: Optional[str] = None
    process_type: Optional[str] = None
    geography: Optional[str] = None
    source_name: str
    source_type: str = "gcca_default"
    source_file: Optional[str] = None
    source_sheet: Optional[str] = None
    reporting_year: Optional[int] = Field(None, ge=1990, le=2100)
    applicable_from: Optional[date] = None
    applicable_to: Optional[date] = None
    unit: str
    value: float = Field(..., ge=0)
    value_min: Optional[float] = None
    value_max: Optional[float] = None
    confidence_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    priority_rank: int = Field(4, ge=1, le=4)
    is_active: bool = True
    notes: Optional[str] = None

    @field_validator("value_min", "value_max", mode="before")
    @classmethod
    def _none_if_negative(cls, v: Any) -> Any:
        if v is not None and float(v) < 0:
            raise ValueError("value_min/value_max must be >= 0")
        return v


class EmissionFactorUpdate(BaseModel):
    """Partial update — only provided fields are changed."""
    value: Optional[float] = Field(None, ge=0)
    value_min: Optional[float] = None
    value_max: Optional[float] = None
    unit: Optional[str] = None
    source_name: Optional[str] = None
    reporting_year: Optional[int] = None
    applicable_from: Optional[date] = None
    applicable_to: Optional[date] = None
    confidence_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    priority_rank: Optional[int] = Field(None, ge=1, le=4)
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class EmissionFactorResponse(BaseModel):
    id: str
    org_id: Optional[str]
    facility_id: Optional[str]
    factor_code: str
    category: str
    subcategory: str
    fuel_type: Optional[str]
    process_type: Optional[str]
    geography: Optional[str]
    source_name: str
    source_type: str
    source_file: Optional[str]
    source_sheet: Optional[str]
    reporting_year: Optional[int]
    applicable_from: Optional[str]
    applicable_to: Optional[str]
    unit: str
    value: float
    value_min: Optional[float]
    value_max: Optional[float]
    confidence_score: Optional[float]
    priority_rank: int
    is_active: bool
    notes: Optional[str]
    created_at: str
    updated_at: str


class FactorSearchParams(BaseModel):
    category: Optional[str] = None
    subcategory: Optional[str] = None
    fuel_type: Optional[str] = None
    geography: Optional[str] = None
    source_type: Optional[str] = None
    is_active: bool = True
    year: Optional[int] = None
    limit: int = Field(50, ge=1, le=500)
    offset: int = Field(0, ge=0)


# ---------------------------------------------------------------------------
# Selection result (returned by select_factor)
# ---------------------------------------------------------------------------
@dataclass
class SelectedFactor:
    factor_id: Optional[str]        # None if plant-supplied inline
    factor_code: str
    value: float
    unit: str
    source_name: str
    priority_rank: int
    reason_selected: str
    year_used: Optional[int] = None
    geography: Optional[str] = None
    confidence_score: Optional[float] = None


# ---------------------------------------------------------------------------
# Service class
# ---------------------------------------------------------------------------
class EmissionFactorService:
    """
    DB-backed emission factor CRUD + selection logic.

    The `db` parameter is a TenantDb instance (from db/pg-client.ts pattern)
    or any object with .queryOne(), .queryMany(), .query() methods.
    """

    def __init__(self, db: Any, org_id: Optional[str] = None) -> None:
        self.db = db
        self.org_id = org_id

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------
    def create(self, data: EmissionFactorCreate, facility_id: Optional[str] = None) -> str:
        """Insert a new emission factor. Returns the new UUID."""
        new_id = str(uuid4())
        self.db.query(
            """
            INSERT INTO emission_factors (
                id, org_id, facility_id, factor_code, category, subcategory,
                fuel_type, process_type, geography,
                source_name, source_type, source_file, source_sheet,
                reporting_year, applicable_from, applicable_to,
                unit, value, value_min, value_max, confidence_score,
                priority_rank, is_active, notes
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
            )
            ON CONFLICT ON CONSTRAINT uq_ef_scope DO UPDATE SET
                value = EXCLUDED.value,
                value_min = EXCLUDED.value_min,
                value_max = EXCLUDED.value_max,
                unit = EXCLUDED.unit,
                source_name = EXCLUDED.source_name,
                is_active = EXCLUDED.is_active,
                updated_at = NOW()
            RETURNING id
            """,
            [
                new_id, self.org_id, facility_id,
                data.factor_code, data.category, data.subcategory,
                data.fuel_type, data.process_type, data.geography,
                data.source_name, data.source_type, data.source_file, data.source_sheet,
                data.reporting_year,
                data.applicable_from.isoformat() if data.applicable_from else None,
                data.applicable_to.isoformat() if data.applicable_to else None,
                data.unit, data.value, data.value_min, data.value_max,
                data.confidence_score, data.priority_rank, data.is_active, data.notes,
            ],
        )
        return new_id

    def get_by_id(self, factor_id: str) -> Optional[dict]:
        return self.db.queryOne(
            "SELECT * FROM emission_factors WHERE id = $1", [factor_id]
        )

    def update(self, factor_id: str, data: EmissionFactorUpdate) -> bool:
        """Partial update. Returns True if a row was updated."""
        updates: list[str] = []
        params: list[Any] = []
        idx = 1

        for field_name, val in data.model_dump(exclude_none=True).items():
            updates.append(f"{field_name} = ${idx}")
            params.append(val.isoformat() if isinstance(val, date) else val)
            idx += 1

        if not updates:
            return False

        params.append(factor_id)
        result = self.db.query(
            f"UPDATE emission_factors SET {', '.join(updates)}, updated_at = NOW() "
            f"WHERE id = ${idx}",
            params,
        )
        return True

    def deactivate(self, factor_id: str) -> bool:
        """Soft-delete: set is_active = FALSE."""
        self.db.query(
            "UPDATE emission_factors SET is_active = FALSE, updated_at = NOW() WHERE id = $1",
            [factor_id],
        )
        return True

    def list_factors(self, params: FactorSearchParams) -> list[dict]:
        """List/search factors with optional filters."""
        conditions = ["(org_id IS NULL OR org_id = $1)"]
        args: list[Any] = [self.org_id]
        idx = 2

        if params.category:
            conditions.append(f"category = ${idx}")
            args.append(params.category)
            idx += 1
        if params.subcategory:
            conditions.append(f"subcategory = ${idx}")
            args.append(params.subcategory)
            idx += 1
        if params.fuel_type:
            conditions.append(f"fuel_type = ${idx}")
            args.append(params.fuel_type)
            idx += 1
        if params.geography:
            conditions.append(f"(geography = ${idx} OR geography = 'Global')")
            args.append(params.geography)
            idx += 1
        if params.source_type:
            conditions.append(f"source_type = ${idx}")
            args.append(params.source_type)
            idx += 1
        if params.is_active is not None:
            conditions.append(f"is_active = ${idx}")
            args.append(params.is_active)
            idx += 1
        if params.year:
            conditions.append(
                f"(reporting_year IS NULL OR reporting_year <= ${idx})"
            )
            args.append(params.year)
            idx += 1

        where = " AND ".join(conditions)
        args.extend([params.limit, params.offset])
        return self.db.queryMany(
            f"SELECT * FROM emission_factors WHERE {where} "
            f"ORDER BY priority_rank ASC, reporting_year DESC NULLS LAST "
            f"LIMIT ${idx} OFFSET ${idx + 1}",
            args,
        )

    # ------------------------------------------------------------------
    # Selection logic (four-tier priority)
    # ------------------------------------------------------------------
    def select_factor(
        self,
        category: str,
        subcategory: str,
        year: int,
        geography: Optional[str] = None,
        facility_id: Optional[str] = None,
        plant_supplied_value: Optional[float] = None,
        plant_supplied_unit: Optional[str] = None,
    ) -> SelectedFactor:
        """
        Select the best emission factor using four-tier priority.

        Priority 1: plant-supplied inline value (if provided and > 0)
        Priority 2: plant-specific DB factor (org_id + facility_id)
        Priority 3: geography-specific DB factor
        Priority 4: latest active source DB factor (any geography)
        Priority 5: internal default (org_id IS NULL)
        """
        # ── Priority 1: plant-supplied inline ──────────────────────────
        if plant_supplied_value is not None and plant_supplied_value > 0:
            return SelectedFactor(
                factor_id=None,
                factor_code="PLANT_SUPPLIED",
                value=plant_supplied_value,
                unit=plant_supplied_unit or "unknown",
                source_name="plant_input",
                priority_rank=1,
                reason_selected=(
                    f"Plant-supplied value ({plant_supplied_value}) used directly. "
                    "Highest priority — overrides all DB factors."
                ),
                year_used=year,
            )

        # ── Priority 2: plant-specific DB factor ───────────────────────
        if facility_id:
            row = self._query_factor(
                category, subcategory, year,
                geography=None, facility_id=facility_id, priority_rank=1,
            )
            if row:
                return self._row_to_selected(row, priority_rank=1,
                    reason=f"Plant-specific factor for facility {facility_id}.")

        # ── Priority 3: geography-specific ─────────────────────────────
        if geography:
            row = self._query_factor(
                category, subcategory, year,
                geography=geography, facility_id=None, priority_rank=2,
            )
            if row:
                return self._row_to_selected(row, priority_rank=2,
                    reason=f"Geography-specific factor for '{geography}'.")

        # ── Priority 4: latest active source (any geography) ───────────
        row = self._query_factor(
            category, subcategory, year,
            geography=None, facility_id=None, priority_rank=3,
        )
        if row:
            return self._row_to_selected(row, priority_rank=3,
                reason="Latest active source factor (no geography filter).")

        # ── Priority 5: internal default (org_id IS NULL) ──────────────
        row = self._query_global_default(category, subcategory, year)
        if row:
            return self._row_to_selected(row, priority_rank=4,
                reason="Internal global default factor (GCCA/IPCC).")

        raise ValueError(
            f"No emission factor found for category='{category}', "
            f"subcategory='{subcategory}', year={year}. "
            "Add a factor via POST /api/v1/factors."
        )

    def record_usage(
        self,
        run_id: str,
        metric_name: str,
        selected: SelectedFactor,
    ) -> None:
        """Persist factor usage to calculation_factor_usage for full traceability."""
        self.db.query(
            """
            INSERT INTO calculation_factor_usage (
                org_id, calculation_run_id, factor_id, metric_name,
                selected_value, selected_unit, source_name,
                priority_rank_used, reason_selected
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            """,
            [
                self.org_id, run_id, selected.factor_id, metric_name,
                selected.value, selected.unit, selected.source_name,
                selected.priority_rank, selected.reason_selected,
            ],
        )

    # ------------------------------------------------------------------
    # Import from Excel / CSV
    # ------------------------------------------------------------------
    def import_from_excel(
        self,
        file_bytes: bytes,
        filename: str,
        facility_id: Optional[str] = None,
    ) -> tuple[int, int, list[str]]:
        """
        Import emission factors from an Excel file.
        Expected columns: factor_code, category, subcategory, unit, value,
                          source_name, geography (optional), reporting_year (optional)

        Returns (imported_count, failed_count, error_messages).
        """
        try:
            df = pd.read_excel(io.BytesIO(file_bytes), engine="openpyxl")
        except Exception as exc:
            return 0, 0, [f"Could not read Excel file: {exc}"]

        return self._import_dataframe(df, filename, facility_id)

    def import_from_csv(
        self,
        file_bytes: bytes,
        filename: str,
        facility_id: Optional[str] = None,
    ) -> tuple[int, int, list[str]]:
        """Import emission factors from a CSV file."""
        try:
            text = file_bytes.decode("utf-8-sig")
            reader = csv.DictReader(io.StringIO(text))
            df = pd.DataFrame(list(reader))
        except Exception as exc:
            return 0, 0, [f"Could not read CSV file: {exc}"]

        return self._import_dataframe(df, filename, facility_id)

    def _import_dataframe(
        self,
        df: pd.DataFrame,
        filename: str,
        facility_id: Optional[str],
    ) -> tuple[int, int, list[str]]:
        required = {"factor_code", "category", "subcategory", "unit", "value", "source_name"}
        missing = required - set(df.columns.str.lower())
        if missing:
            return 0, 0, [f"Missing required columns: {missing}"]

        df.columns = df.columns.str.lower().str.strip()
        imported = 0
        failed = 0
        errors: list[str] = []

        for i, row in df.iterrows():
            try:
                data = EmissionFactorCreate(
                    factor_code=str(row["factor_code"]).strip(),
                    category=str(row["category"]).strip(),
                    subcategory=str(row["subcategory"]).strip(),
                    unit=str(row["unit"]).strip(),
                    value=float(row["value"]),
                    source_name=str(row["source_name"]).strip(),
                    source_file=filename,
                    source_sheet=str(row.get("source_sheet", "")).strip() or None,
                    geography=str(row.get("geography", "")).strip() or None,
                    reporting_year=int(row["reporting_year"]) if pd.notna(row.get("reporting_year")) else None,
                    fuel_type=str(row.get("fuel_type", "")).strip() or None,
                    process_type=str(row.get("process_type", "")).strip() or None,
                    source_type=str(row.get("source_type", "operator_supplied")).strip(),
                    priority_rank=int(row.get("priority_rank", 3)),
                    notes=str(row.get("notes", "")).strip() or None,
                )
                self.create(data, facility_id=facility_id)
                imported += 1
            except Exception as exc:
                failed += 1
                errors.append(f"Row {i + 2}: {exc}")

        return imported, failed, errors

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _query_factor(
        self,
        category: str,
        subcategory: str,
        year: int,
        geography: Optional[str],
        facility_id: Optional[str],
        priority_rank: int,
    ) -> Optional[dict]:
        conditions = [
            "category = $1",
            "subcategory = $2",
            "is_active = TRUE",
            f"priority_rank = ${5 if geography else 4}",
            "(applicable_to IS NULL OR applicable_to >= CURRENT_DATE)",
            "(reporting_year IS NULL OR reporting_year <= $3)",
        ]
        params: list[Any] = [category, subcategory, year]

        if facility_id:
            conditions.append("facility_id = $4")
            params.append(facility_id)
        elif geography:
            conditions.append("(geography = $4 OR geography = 'Global')")
            params.append(geography)
        else:
            conditions.append("org_id = $4")
            params.append(self.org_id)

        params.append(priority_rank)

        return self.db.queryOne(
            f"SELECT * FROM emission_factors WHERE {' AND '.join(conditions)} "
            "ORDER BY reporting_year DESC NULLS LAST, confidence_score DESC NULLS LAST "
            "LIMIT 1",
            params,
        )

    def _query_global_default(
        self, category: str, subcategory: str, year: int
    ) -> Optional[dict]:
        return self.db.queryOne(
            """
            SELECT * FROM emission_factors
            WHERE category = $1
              AND subcategory = $2
              AND org_id IS NULL
              AND is_active = TRUE
              AND (reporting_year IS NULL OR reporting_year <= $3)
              AND (applicable_to IS NULL OR applicable_to >= CURRENT_DATE)
            ORDER BY reporting_year DESC NULLS LAST
            LIMIT 1
            """,
            [category, subcategory, year],
        )

    @staticmethod
    def _row_to_selected(row: dict, priority_rank: int, reason: str) -> SelectedFactor:
        return SelectedFactor(
            factor_id=str(row["id"]),
            factor_code=row["factor_code"],
            value=float(row["value"]),
            unit=row["unit"],
            source_name=row["source_name"],
            priority_rank=priority_rank,
            reason_selected=reason,
            year_used=row.get("reporting_year"),
            geography=row.get("geography"),
            confidence_score=float(row["confidence_score"]) if row.get("confidence_score") else None,
        )
