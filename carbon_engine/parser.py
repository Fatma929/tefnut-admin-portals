"""
Tefnut Data Ingestion Layer
Parses the Tefnut Standard Excel/CSV Template into a validated PlantInput model.

Supported formats: .xlsx, .xls, .csv
Each format uses a fixed sheet/column schema (see TEMPLATE_SCHEMA below).

The workbook has 5 sheets:
  1. plant_info      — general plant metadata and calcination settings
  2. kiln_fuels      — one row per kiln fuel type
  3. non_kiln_fuels  — one row per non-kiln fuel type
  4. transport       — one row per transport leg (Scope 3)
  5. water           — single-row water balance

For CSV uploads, only the plant_info sheet is supported (simple single-plant mode).
"""

from __future__ import annotations

import base64
import io
import logging
from dataclasses import dataclass
from typing import Any

import pandas as pd

from carbon_engine import (
    CalcinationInputA1,
    CalcinationInputB1,
    CalcinationMethod,
    CarbonEngine,
    ElectricityInput,
    FuelEntry,
    FuelType,
    PlantInput,
    TransportEntry,
    WaterInput,
)
from carbon_engine.carbon_engine import GCCA_DEFAULT_CALCINATION_EF_KG_PER_T_CLINKER

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Column name constants — single source of truth for the Excel template
# ---------------------------------------------------------------------------

# Sheet: plant_info
PI_PLANT_NAME = "plant_name"
PI_REPORTING_YEAR = "reporting_year"
PI_CALCINATION_METHOD = "calcination_method"
PI_CEMENT_PRODUCTION = "cement_production_t_yr"
PI_CLINKER_PRODUCTION = "clinker_production_t_yr"
PI_CBAM_GOODS_COUNT = "cbam_goods_count"
PI_CBAM_COMPLETENESS = "cbam_data_completeness_pct"

# Calcination B1 sub-fields (columns in plant_info sheet)
PI_B1_CLINKER = "b1_clinker_production_t_yr"
PI_B1_BYPASS_DUST = "b1_bypass_dust_t_yr"
PI_B1_CKD = "b1_ckd_leaving_kiln_t_yr"
PI_B1_CKD_RATE = "b1_ckd_calcination_rate_d"
PI_B1_EF = "b1_calcination_ef_kg_per_t_clinker"

# Calcination A1 sub-fields (columns in plant_info sheet)
PI_A1_KILN_FEED = "a1_kiln_feed_t_yr"
PI_A1_DUST_RETURN = "a1_dust_return_correction_pct"
PI_A1_LOI_RM = "a1_loi_raw_meal_pct"
PI_A1_CKD = "a1_ckd_leaving_kiln_t_yr"
PI_A1_LOI_CKD = "a1_loi_ckd_pct"

# Electricity (columns in plant_info sheet)
PI_ELEC_MWH = "electricity_purchased_mwh_yr"
PI_ELEC_EF = "electricity_grid_ef_kg_co2_per_mwh"

# Water (columns in plant_info sheet OR water sheet)
PI_WATER_WITHDRAWAL = "water_withdrawal_m3_yr"
PI_WATER_DISCHARGE = "water_discharge_m3_yr"
PI_WATER_RECYCLED = "water_recycled_m3_yr"

# Sheet: kiln_fuels / non_kiln_fuels
FUEL_TYPE_COL = "fuel_type"
FUEL_CONSUMPTION_COL = "consumption_t_per_yr"
FUEL_LHV_COL = "lhv_gj_per_t"
FUEL_EF_COL = "ef_kg_co2_per_gj"
FUEL_BIO_COL = "biogenic_fraction"

# Sheet: transport
TRANSPORT_DESC_COL = "description"
TRANSPORT_TKM_COL = "freight_tonne_km"
TRANSPORT_EF_COL = "ef_kg_co2_per_tonne_km"


# ---------------------------------------------------------------------------
# Template schema documentation (used to generate the Excel template)
# ---------------------------------------------------------------------------
TEMPLATE_SCHEMA: dict[str, list[dict]] = {
    "plant_info": [
        {"column": PI_PLANT_NAME,          "type": "string",  "required": True,  "example": "Cement Plant — Suez"},
        {"column": PI_REPORTING_YEAR,      "type": "integer", "required": True,  "example": 2026},
        {"column": PI_CALCINATION_METHOD,  "type": "string",  "required": True,  "example": "B1",  "allowed": ["B1", "A1"]},
        {"column": PI_CEMENT_PRODUCTION,   "type": "float",   "required": True,  "example": 1_200_000, "unit": "t/yr"},
        {"column": PI_CLINKER_PRODUCTION,  "type": "float",   "required": False, "example": 1_000_000, "unit": "t/yr"},
        {"column": PI_CBAM_GOODS_COUNT,    "type": "integer", "required": False, "example": 14},
        {"column": PI_CBAM_COMPLETENESS,   "type": "float",   "required": False, "example": 92.0,  "unit": "%"},
        # B1 calcination
        {"column": PI_B1_CLINKER,          "type": "float",   "required": False, "example": 1_000_000, "unit": "t/yr", "note": "Required if calcination_method=B1"},
        {"column": PI_B1_BYPASS_DUST,      "type": "float",   "required": False, "example": 0.0,   "unit": "t/yr"},
        {"column": PI_B1_CKD,              "type": "float",   "required": False, "example": 0.0,   "unit": "t/yr"},
        {"column": PI_B1_CKD_RATE,         "type": "float",   "required": False, "example": 0.0,   "unit": "0-1"},
        {"column": PI_B1_EF,               "type": "float",   "required": False, "example": 525.0, "unit": "kg CO2/t clinker"},
        # A1 calcination
        {"column": PI_A1_KILN_FEED,        "type": "float",   "required": False, "example": 1_861_500, "unit": "t/yr", "note": "Required if calcination_method=A1"},
        {"column": PI_A1_DUST_RETURN,      "type": "float",   "required": False, "example": 10.33, "unit": "%"},
        {"column": PI_A1_LOI_RM,           "type": "float",   "required": False, "example": 35.0,  "unit": "%"},
        {"column": PI_A1_CKD,              "type": "float",   "required": False, "example": 0.0,   "unit": "t/yr"},
        {"column": PI_A1_LOI_CKD,          "type": "float",   "required": False, "example": 0.0,   "unit": "%"},
        # Electricity
        {"column": PI_ELEC_MWH,            "type": "float",   "required": False, "example": 50_000.0, "unit": "MWh/yr"},
        {"column": PI_ELEC_EF,             "type": "float",   "required": False, "example": 0.5,   "unit": "kg CO2/MWh"},
        # Water
        {"column": PI_WATER_WITHDRAWAL,    "type": "float",   "required": False, "example": 1_200_000, "unit": "m3/yr"},
        {"column": PI_WATER_DISCHARGE,     "type": "float",   "required": False, "example": 200_000,   "unit": "m3/yr"},
        {"column": PI_WATER_RECYCLED,      "type": "float",   "required": False, "example": 50_000,    "unit": "m3/yr"},
    ],
    "kiln_fuels": [
        {"column": FUEL_TYPE_COL,       "type": "string", "required": True,  "example": "coal_anthracite",
         "allowed": [e.value for e in FuelType]},
        {"column": FUEL_CONSUMPTION_COL,"type": "float",  "required": True,  "example": 10_000.0, "unit": "t/yr"},
        {"column": FUEL_LHV_COL,        "type": "float",  "required": True,  "example": 26.0,     "unit": "GJ/t"},
        {"column": FUEL_EF_COL,         "type": "float",  "required": False, "example": "",       "unit": "kg CO2/GJ", "note": "Leave blank to use GCCA default"},
        {"column": FUEL_BIO_COL,        "type": "float",  "required": False, "example": 0.0,      "unit": "0-1"},
    ],
    "non_kiln_fuels": [
        {"column": FUEL_TYPE_COL,       "type": "string", "required": True,  "example": "diesel_oil"},
        {"column": FUEL_CONSUMPTION_COL,"type": "float",  "required": True,  "example": 500.0,    "unit": "t/yr"},
        {"column": FUEL_LHV_COL,        "type": "float",  "required": True,  "example": 42.7,     "unit": "GJ/t"},
        {"column": FUEL_EF_COL,         "type": "float",  "required": False, "example": ""},
        {"column": FUEL_BIO_COL,        "type": "float",  "required": False, "example": 0.0},
    ],
    "transport": [
        {"column": TRANSPORT_DESC_COL,  "type": "string", "required": True,  "example": "Limestone quarry to plant"},
        {"column": TRANSPORT_TKM_COL,   "type": "float",  "required": True,  "example": 1_000_000, "unit": "tonne-km"},
        {"column": TRANSPORT_EF_COL,    "type": "float",  "required": False, "example": 0.062,     "unit": "kg CO2/tonne-km"},
    ],
}


# ---------------------------------------------------------------------------
# Parse errors
# ---------------------------------------------------------------------------
@dataclass
class ParseError:
    sheet: str
    row: int | None
    column: str
    message: str

    def to_dict(self) -> dict:
        return {
            "sheet": self.sheet,
            "row": self.row,
            "column": self.column,
            "message": self.message,
        }


class TemplateParseError(Exception):
    """Raised when the uploaded file cannot be parsed into a valid PlantInput."""

    def __init__(self, errors: list[ParseError]) -> None:
        self.errors = errors
        super().__init__(f"{len(errors)} parse error(s) found in uploaded file")

    def to_response_body(self) -> dict:
        return {
            "error": "Template parse failed",
            "detail": [e.to_dict() for e in self.errors],
        }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
def _get(row: pd.Series, col: str, default: Any = None) -> Any:
    """Safe column accessor — returns default if column missing or NaN."""
    if col not in row.index:
        return default
    val = row[col]
    if pd.isna(val):
        return default
    return val


def _require(
    row: pd.Series,
    col: str,
    sheet: str,
    row_idx: int,
    errors: list[ParseError],
) -> Any:
    """Accessor that appends a ParseError if the value is missing."""
    val = _get(row, col)
    if val is None:
        errors.append(ParseError(sheet, row_idx, col, f"Required column '{col}' is missing or empty"))
    return val


def _parse_fuel_sheet(
    df: pd.DataFrame,
    sheet_name: str,
    errors: list[ParseError],
) -> list[FuelEntry]:
    """Convert a fuel DataFrame (kiln_fuels or non_kiln_fuels) into FuelEntry list."""
    entries: list[FuelEntry] = []
    df = df.dropna(how="all")  # skip blank rows

    for idx, row in df.iterrows():
        row_num = int(idx) + 2  # 1-based + header row

        fuel_type_raw = _require(row, FUEL_TYPE_COL, sheet_name, row_num, errors)
        consumption = _require(row, FUEL_CONSUMPTION_COL, sheet_name, row_num, errors)
        lhv = _require(row, FUEL_LHV_COL, sheet_name, row_num, errors)

        if fuel_type_raw is None or consumption is None or lhv is None:
            continue  # error already recorded

        # Validate fuel type enum
        try:
            fuel_type = FuelType(str(fuel_type_raw).strip().lower())
        except ValueError:
            errors.append(ParseError(
                sheet_name, row_num, FUEL_TYPE_COL,
                f"Unknown fuel_type '{fuel_type_raw}'. "
                f"Allowed values: {[e.value for e in FuelType]}"
            ))
            continue

        ef_raw = _get(row, FUEL_EF_COL)
        ef = float(ef_raw) if ef_raw is not None else None

        bio_raw = _get(row, FUEL_BIO_COL, 0.0)
        bio = float(bio_raw) if bio_raw is not None else 0.0

        try:
            entries.append(FuelEntry(
                fuel_type=fuel_type,
                consumption_t_per_yr=float(consumption),
                lhv_gj_per_t=float(lhv),
                ef_kg_co2_per_gj=ef,
                biogenic_fraction=bio,
            ))
        except Exception as exc:
            errors.append(ParseError(sheet_name, row_num, "*", str(exc)))

    return entries


def _parse_transport_sheet(
    df: pd.DataFrame,
    errors: list[ParseError],
) -> list[TransportEntry]:
    entries: list[TransportEntry] = []
    df = df.dropna(how="all")

    for idx, row in df.iterrows():
        row_num = int(idx) + 2
        desc = _require(row, TRANSPORT_DESC_COL, "transport", row_num, errors)
        tkm = _require(row, TRANSPORT_TKM_COL, "transport", row_num, errors)
        if desc is None or tkm is None:
            continue

        ef_raw = _get(row, TRANSPORT_EF_COL, 0.062)
        try:
            entries.append(TransportEntry(
                description=str(desc),
                freight_tonne_km=float(tkm),
                ef_kg_co2_per_tonne_km=float(ef_raw),
            ))
        except Exception as exc:
            errors.append(ParseError("transport", row_num, "*", str(exc)))

    return entries


def _parse_plant_info_row(
    row: pd.Series,
    errors: list[ParseError],
) -> dict:
    """
    Parse the single data row from the plant_info sheet into a raw dict
    that will be assembled into PlantInput.
    """
    sheet = "plant_info"
    r = 2  # data is always row 2 (row 1 = header)

    plant_name = _require(row, PI_PLANT_NAME, sheet, r, errors)
    reporting_year = _require(row, PI_REPORTING_YEAR, sheet, r, errors)
    calc_method_raw = _require(row, PI_CALCINATION_METHOD, sheet, r, errors)
    cement_prod = _require(row, PI_CEMENT_PRODUCTION, sheet, r, errors)

    if any(v is None for v in [plant_name, reporting_year, calc_method_raw, cement_prod]):
        return {}

    try:
        calc_method = CalcinationMethod(str(calc_method_raw).strip().upper())
    except ValueError:
        errors.append(ParseError(sheet, r, PI_CALCINATION_METHOD,
                                 f"Invalid calcination_method '{calc_method_raw}'. Use B1 or A1."))
        return {}

    result: dict[str, Any] = {
        "plant_name": str(plant_name),
        "reporting_year": int(reporting_year),
        "calcination_method": calc_method,
        "cement_production_t_yr": float(cement_prod),
        "clinker_production_t_yr": _get(row, PI_CLINKER_PRODUCTION),
        "cbam_goods_count": int(_get(row, PI_CBAM_GOODS_COUNT, 0)),
        "cbam_data_completeness_pct": float(_get(row, PI_CBAM_COMPLETENESS, 0.0)),
    }

    # --- Calcination B1 ---
    if calc_method == CalcinationMethod.B1_SIMPLE_OUTPUT:
        b1_clinker = _get(row, PI_B1_CLINKER)
        if b1_clinker is None:
            # Fall back to top-level clinker_production if provided
            b1_clinker = _get(row, PI_CLINKER_PRODUCTION)
        if b1_clinker is None:
            errors.append(ParseError(sheet, r, PI_B1_CLINKER,
                                     "b1_clinker_production_t_yr is required for method B1"))
            return {}
        result["calcination_b1"] = CalcinationInputB1(
            clinker_production_t_yr=float(b1_clinker),
            bypass_dust_t_yr=float(_get(row, PI_B1_BYPASS_DUST, 0.0)),
            ckd_leaving_kiln_t_yr=float(_get(row, PI_B1_CKD, 0.0)),
            ckd_calcination_rate_d=float(_get(row, PI_B1_CKD_RATE, 0.0)),
            calcination_ef_kg_per_t_clinker=float(
                _get(row, PI_B1_EF, GCCA_DEFAULT_CALCINATION_EF_KG_PER_T_CLINKER)
            ),
        )

    # --- Calcination A1 ---
    elif calc_method == CalcinationMethod.A1_SIMPLE_INPUT:
        a1_kf = _get(row, PI_A1_KILN_FEED)
        a1_dr = _get(row, PI_A1_DUST_RETURN)
        a1_loi = _get(row, PI_A1_LOI_RM)
        for col, val in [(PI_A1_KILN_FEED, a1_kf), (PI_A1_DUST_RETURN, a1_dr), (PI_A1_LOI_RM, a1_loi)]:
            if val is None:
                errors.append(ParseError(sheet, r, col, f"'{col}' is required for method A1"))
        if any(v is None for v in [a1_kf, a1_dr, a1_loi]):
            return {}
        result["calcination_a1"] = CalcinationInputA1(
            kiln_feed_t_yr=float(a1_kf),
            dust_return_correction_pct=float(a1_dr),
            loi_raw_meal_pct=float(a1_loi),
            ckd_leaving_kiln_t_yr=float(_get(row, PI_A1_CKD, 0.0)),
            loi_ckd_pct=float(_get(row, PI_A1_LOI_CKD, 0.0)),
        )

    # --- Electricity ---
    elec_mwh = _get(row, PI_ELEC_MWH)
    elec_ef = _get(row, PI_ELEC_EF)
    if elec_mwh is not None and elec_ef is not None:
        result["electricity"] = ElectricityInput(
            purchased_electricity_mwh_yr=float(elec_mwh),
            grid_ef_kg_co2_per_mwh=float(elec_ef),
        )

    # --- Water ---
    w_wd = _get(row, PI_WATER_WITHDRAWAL)
    if w_wd is not None:
        result["water"] = WaterInput(
            withdrawal_m3_yr=float(w_wd),
            discharge_m3_yr=float(_get(row, PI_WATER_DISCHARGE, 0.0)),
            recycled_m3_yr=float(_get(row, PI_WATER_RECYCLED, 0.0)),
        )

    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def parse_excel(file_bytes: bytes) -> PlantInput:
    """
    Parse a Tefnut Standard Excel workbook (.xlsx/.xls) into a PlantInput.

    Raises TemplateParseError with a list of field-level errors if the file
    is invalid or missing required data.
    """
    errors: list[ParseError] = []

    try:
        xls = pd.ExcelFile(io.BytesIO(file_bytes))
    except Exception as exc:
        raise TemplateParseError([
            ParseError("file", None, "*", f"Cannot open Excel file: {exc}")
        ]) from exc

    available_sheets = xls.sheet_names

    # --- plant_info (required) ---
    if "plant_info" not in available_sheets:
        raise TemplateParseError([
            ParseError("plant_info", None, "*", "Sheet 'plant_info' not found in workbook")
        ])

    df_info = xls.parse("plant_info", dtype=str)
    # Normalise column names: strip whitespace, lowercase
    df_info.columns = [str(c).strip().lower() for c in df_info.columns]
    df_info = df_info.dropna(how="all")

    if df_info.empty:
        raise TemplateParseError([
            ParseError("plant_info", 2, "*", "plant_info sheet has no data rows")
        ])

    # Use first data row only
    plant_row = df_info.iloc[0]
    # Re-cast numeric-looking strings to float where possible
    plant_row = plant_row.apply(_try_numeric)

    plant_dict = _parse_plant_info_row(plant_row, errors)

    # --- kiln_fuels (optional) ---
    kiln_fuels: list[FuelEntry] = []
    if "kiln_fuels" in available_sheets:
        df_kf = xls.parse("kiln_fuels", dtype=str)
        df_kf.columns = [str(c).strip().lower() for c in df_kf.columns]
        df_kf = df_kf.apply(lambda col: col.map(_try_numeric))
        kiln_fuels = _parse_fuel_sheet(df_kf, "kiln_fuels", errors)

    # --- non_kiln_fuels (optional) ---
    non_kiln_fuels: list[FuelEntry] = []
    if "non_kiln_fuels" in available_sheets:
        df_nkf = xls.parse("non_kiln_fuels", dtype=str)
        df_nkf.columns = [str(c).strip().lower() for c in df_nkf.columns]
        df_nkf = df_nkf.apply(lambda col: col.map(_try_numeric))
        non_kiln_fuels = _parse_fuel_sheet(df_nkf, "non_kiln_fuels", errors)

    # --- transport (optional) ---
    transport: list[TransportEntry] = []
    if "transport" in available_sheets:
        df_tr = xls.parse("transport", dtype=str)
        df_tr.columns = [str(c).strip().lower() for c in df_tr.columns]
        df_tr = df_tr.apply(lambda col: col.map(_try_numeric))
        transport = _parse_transport_sheet(df_tr, errors)

    # Bail out if any errors accumulated
    if errors:
        raise TemplateParseError(errors)

    if not plant_dict:
        raise TemplateParseError([
            ParseError("plant_info", 2, "*", "Could not build plant data from sheet")
        ])

    plant_dict["kiln_fuels"] = kiln_fuels
    plant_dict["non_kiln_fuels"] = non_kiln_fuels
    plant_dict["transport_entries"] = transport

    try:
        return PlantInput.model_validate(plant_dict)
    except Exception as exc:
        raise TemplateParseError([
            ParseError("*", None, "*", f"Model validation failed: {exc}")
        ]) from exc


def parse_csv(file_bytes: bytes) -> PlantInput:
    """
    Parse a single-sheet CSV (plant_info columns only, no fuel rows).
    Useful for quick integrations; fuel data defaults to empty lists.
    """
    errors: list[ParseError] = []

    try:
        df = pd.read_csv(io.BytesIO(file_bytes), dtype=str)
    except Exception as exc:
        raise TemplateParseError([
            ParseError("file", None, "*", f"Cannot parse CSV: {exc}")
        ]) from exc

    df.columns = [str(c).strip().lower() for c in df.columns]
    df = df.dropna(how="all")

    if df.empty:
        raise TemplateParseError([ParseError("csv", 2, "*", "CSV file has no data rows")])

    row = df.iloc[0].apply(_try_numeric)
    plant_dict = _parse_plant_info_row(row, errors)

    if errors:
        raise TemplateParseError(errors)

    plant_dict.setdefault("kiln_fuels", [])
    plant_dict.setdefault("non_kiln_fuels", [])
    plant_dict.setdefault("transport_entries", [])

    try:
        return PlantInput.model_validate(plant_dict)
    except Exception as exc:
        raise TemplateParseError([
            ParseError("*", None, "*", f"Model validation failed: {exc}")
        ]) from exc


def parse_file(file_bytes: bytes, filename: str) -> PlantInput:
    """
    Dispatch to the correct parser based on file extension.
    Accepts .xlsx, .xls, or .csv.
    """
    name = filename.lower().strip()
    if name.endswith(".csv"):
        return parse_csv(file_bytes)
    if name.endswith((".xlsx", ".xls")):
        return parse_excel(file_bytes)
    raise TemplateParseError([
        ParseError("file", None, "filename",
                   f"Unsupported file type '{filename}'. Use .xlsx, .xls, or .csv")
    ])


# ---------------------------------------------------------------------------
# Internal utility
# ---------------------------------------------------------------------------
def _try_numeric(val: Any) -> Any:
    """Convert string to int/float if possible, otherwise return as-is."""
    if not isinstance(val, str):
        return val
    val = val.strip()
    if val == "" or val.lower() in ("nan", "none", "null", "-"):
        return None
    try:
        as_int = int(val)
        return as_int
    except ValueError:
        pass
    try:
        return float(val)
    except ValueError:
        return val
