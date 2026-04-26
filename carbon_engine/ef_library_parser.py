"""
Tefnut — IPCC Emission Factor Library Parser
Parses 2A_Cement_Lime_Production.xlsx (IPCC EFDB Extra-Page data)
into a structured dataset for use by FactorProvider.

Detected sheets:
  - Data EB14 (2016): EU BAT reference — organic carbon, CaCO3%, CaO/MgO
  - Data EB18 (2020): Australia NIR — cement EF 0.535-0.560 tCO2/t clinker
  - Data EB19 (2021): UK/Canada NIRs — cement EF 0.521-0.600 tCO2/t clinker
  - Data EB20 (2022): China peer-reviewed — NSP 0.52, VSK 0.501 tCO2/t clinker
  - Data_EB21 (2023): Brazil peer-reviewed — 0.488-0.500 tCO2/t clinker (CCW)

Usable cement calcination EF records: 9
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

import pandas as pd

# ---------------------------------------------------------------------------
# Schema for a single emission factor record
# ---------------------------------------------------------------------------
EF_RECORD_KEYS = [
    "category",
    "subcategory",
    "year",
    "value",
    "value_min",
    "value_max",
    "unit",
    "source",
    "sheet",
    "region",
    "technology",
    "year_used",
    "why_selected",
]


def _parse_value_range(raw: str) -> tuple[Optional[float], Optional[float], Optional[float]]:
    """
    Parse a value string that may be a range ("0.535-0.560") or single ("0.52").
    Returns (midpoint, min, max).
    """
    if raw is None or str(raw).strip() in ("", "nan"):
        return None, None, None

    s = str(raw).strip()
    # Range: "0.535-0.560" or "0.535 – 0.560"
    range_match = re.match(r"^([\d.]+)\s*[-–]\s*([\d.]+)$", s)
    if range_match:
        lo = float(range_match.group(1))
        hi = float(range_match.group(2))
        return round((lo + hi) / 2, 6), lo, hi

    # Single value
    try:
        v = float(s)
        return v, v, v
    except ValueError:
        return None, None, None


# ---------------------------------------------------------------------------
# Hardcoded records extracted from the document
# (The Excel file uses a vertical key-value layout, not a tabular one.
#  We embed the records directly from the parsed document content.)
# ---------------------------------------------------------------------------
_HARDCODED_RECORDS: list[dict] = [
    # ── EB18 (2020) — Australia NIR ──────────────────────────────────────
    {
        "category": "cement_production",
        "subcategory": "calcination_ef_t_co2_per_t_clinker",
        "year": 2020,
        "value": 0.5475,
        "value_min": 0.535,
        "value_max": 0.560,
        "unit": "tCO2/t clinker",
        "source": "2A_Cement_Lime_Production.xlsx",
        "sheet": "Data EB18 (2020)",
        "region": "Australia",
        "technology": None,
        "description": "CO2 emission factor for cement production (Australian NIR 2019)",
        "reference": "Australian National Inventory Report 2019, Volume 1",
    },
    # ── EB19 (2021) — United Kingdom NIR ─────────────────────────────────
    {
        "category": "cement_production",
        "subcategory": "calcination_ef_t_co2_per_t_clinker",
        "year": 2021,
        "value": 0.5815,
        "value_min": 0.563,
        "value_max": 0.600,
        "unit": "tCO2/t clinker",
        "source": "2A_Cement_Lime_Production.xlsx",
        "sheet": "Data EB19 (2021)",
        "region": "United Kingdom",
        "technology": None,
        "description": "CO2 emission factor per tonne of clinker (UK NIR 2020)",
        "reference": "UK Greenhouse Gas Inventory, 1990 to 2018, 2020",
    },
    # ── EB19 (2021) — Canada NIR ──────────────────────────────────────────
    {
        "category": "cement_production",
        "subcategory": "calcination_ef_t_co2_per_t_clinker",
        "year": 2021,
        "value": 0.527,
        "value_min": 0.521,
        "value_max": 0.533,
        "unit": "tCO2/t clinker",
        "source": "2A_Cement_Lime_Production.xlsx",
        "sheet": "Data EB19 (2021)",
        "region": "Canada",
        "technology": None,
        "description": "CO2 emission factor per tonne of clinker (Canada NIR 2021)",
        "reference": "National Inventory Report 1990-2019: GHG sources and sinks in Canada, 2021",
    },
    # ── EB20 (2022) — China, NSP kiln ────────────────────────────────────
    {
        "category": "cement_production",
        "subcategory": "calcination_ef_t_co2_per_t_clinker",
        "year": 2022,
        "value": 0.52,
        "value_min": 0.478,
        "value_max": 0.556,
        "unit": "tCO2/t clinker",
        "source": "2A_Cement_Lime_Production.xlsx",
        "sheet": "Data EB20 (2022)",
        "region": "China",
        "technology": "NSP (New Suspension Preheating and Pre-calcining kiln)",
        "description": "CO2 emission factor for clinker — NSP kiln (China)",
        "reference": "Yang Y. et al., J. Geogr. Sci. 2017, 27(6): 711-730",
    },
    # ── EB20 (2022) — China, VSK kiln ────────────────────────────────────
    {
        "category": "cement_production",
        "subcategory": "calcination_ef_t_co2_per_t_clinker",
        "year": 2022,
        "value": 0.501,
        "value_min": 0.392,
        "value_max": 0.529,
        "unit": "tCO2/t clinker",
        "source": "2A_Cement_Lime_Production.xlsx",
        "sheet": "Data EB20 (2022)",
        "region": "China",
        "technology": "VSK (Vertical Shaft Kiln)",
        "description": "CO2 emission factor for clinker — VSK kiln (China)",
        "reference": "Yang Y. et al., J. Geogr. Sci. 2017, 27(6): 711-730",
    },
    # ── EB21 (2023) — Brazil, reference cement ───────────────────────────
    {
        "category": "cement_production",
        "subcategory": "calcination_ef_t_co2_per_t_clinker",
        "year": 2023,
        "value": 0.500,
        "value_min": 0.500,
        "value_max": 0.500,
        "unit": "tCO2/t clinker",
        "source": "2A_Cement_Lime_Production.xlsx",
        "sheet": "Data_EB21 (2023)",
        "region": "Brazil",
        "technology": "Reference cement (no CCW substitution)",
        "description": "CO2 emission factor per tonne of clinker — reference cement (Brazil)",
        "reference": "Costa et al., Journal of Cleaner Production, Vol.276, 2020, 123302",
    },
    # ── EB21 (2023) — Brazil, CCW-1 ──────────────────────────────────────
    {
        "category": "cement_production",
        "subcategory": "calcination_ef_t_co2_per_t_clinker",
        "year": 2023,
        "value": 0.488,
        "value_min": 0.488,
        "value_max": 0.488,
        "unit": "tCO2/t clinker",
        "source": "2A_Cement_Lime_Production.xlsx",
        "sheet": "Data_EB21 (2023)",
        "region": "Brazil",
        "technology": "CL-CCW-1 (construction waste cement, 1% substitution)",
        "description": "CO2 EF per tonne clinker — CL-CCW-1 (Brazil)",
        "reference": "Costa et al., Journal of Cleaner Production, Vol.276, 2020, 123302",
    },
    # ── EB21 (2023) — Brazil, CCW-4 ──────────────────────────────────────
    {
        "category": "cement_production",
        "subcategory": "calcination_ef_t_co2_per_t_clinker",
        "year": 2023,
        "value": 0.4718,
        "value_min": 0.4718,
        "value_max": 0.4718,
        "unit": "tCO2/t clinker",
        "source": "2A_Cement_Lime_Production.xlsx",
        "sheet": "Data_EB21 (2023)",
        "region": "Brazil",
        "technology": "CL-CCW-4 (construction waste cement, 4% substitution)",
        "description": "CO2 EF per tonne clinker — CL-CCW-4 (Brazil)",
        "reference": "Costa et al., Journal of Cleaner Production, Vol.276, 2020, 123302",
    },
    # ── EB21 (2023) — Brazil, CCW-0-10 ───────────────────────────────────
    {
        "category": "cement_production",
        "subcategory": "calcination_ef_t_co2_per_t_clinker",
        "year": 2023,
        "value": 0.4595,
        "value_min": 0.4595,
        "value_max": 0.4595,
        "unit": "tCO2/t clinker",
        "source": "2A_Cement_Lime_Production.xlsx",
        "sheet": "Data_EB21 (2023)",
        "region": "Brazil",
        "technology": "CL-CCW-0-10 (building waste, 0-10% substitution)",
        "description": "CO2 EF per tonne clinker — CL-CCW-0-10 (Brazil)",
        "reference": "Costa et al., Journal of Cleaner Production, Vol.276, 2020, 123302",
    },
]


def load_from_excel(xlsx_path: str | Path) -> list[dict]:
    """
    Load and parse the IPCC 2A Cement/Lime Excel file.
    Falls back to hardcoded records if the file is not available.

    Returns a list of standardised EF record dicts.
    """
    path = Path(xlsx_path)
    if not path.exists():
        return list(_HARDCODED_RECORDS)

    try:
        xl = pd.ExcelFile(path, engine="openpyxl")
        sheet_names = xl.sheet_names
        print(f"[ef_library_parser] Detected sheets: {sheet_names}")
    except Exception as exc:
        print(f"[ef_library_parser] Could not open {path}: {exc}. Using hardcoded records.")
        return list(_HARDCODED_RECORDS)

    # The file uses a vertical key-value layout (rows = fields, cols = records)
    # We parse each known sheet and extract cement-related EF rows.
    records: list[dict] = []

    _SHEET_META = {
        "Data EB14 (2016)": {"year": 2016, "region": "European Union"},
        "Data EB18 (2020)": {"year": 2020, "region": "Australia"},
        "Data EB19 (2021)": {"year": 2021, "region": "UK/Canada"},
        "Data EB20 (2022)": {"year": 2022, "region": "China"},
        "Data_EB21 (2023)": {"year": 2023, "region": "Brazil"},
    }

    for sheet_name, meta in _SHEET_META.items():
        if sheet_name not in sheet_names:
            continue
        try:
            df = pd.read_excel(path, sheet_name=sheet_name, header=None, engine="openpyxl")
        except Exception:
            continue

        # Find rows where first column contains "Value" or "Unit"
        # and second column contains cement-related content
        for col_idx in range(1, min(df.shape[1], 10)):
            description_row = None
            value_row = None
            unit_row = None
            region_row = None
            technology_row = None

            for row_idx in range(df.shape[0]):
                cell = str(df.iloc[row_idx, 0]).strip().lower()
                if "description" in cell:
                    description_row = row_idx
                elif cell == "value":
                    value_row = row_idx
                elif cell == "unit":
                    unit_row = row_idx
                elif "region" in cell:
                    region_row = row_idx
                elif "technolog" in cell:
                    technology_row = row_idx

            if value_row is None or unit_row is None:
                continue

            raw_value = str(df.iloc[value_row, col_idx]).strip()
            raw_unit = str(df.iloc[unit_row, col_idx]).strip()

            # Only keep cement calcination EFs
            if not any(kw in raw_unit.lower() for kw in ["clinker", "cement"]):
                continue
            if raw_value in ("", "nan", "NaN"):
                continue

            value, vmin, vmax = _parse_value_range(raw_value)
            if value is None:
                continue

            description = ""
            if description_row is not None:
                description = str(df.iloc[description_row, col_idx]).strip()

            region = meta["region"]
            if region_row is not None:
                r = str(df.iloc[region_row, col_idx]).strip()
                if r not in ("", "nan"):
                    region = r

            technology = None
            if technology_row is not None:
                t = str(df.iloc[technology_row, col_idx]).strip()
                if t not in ("", "nan"):
                    technology = t

            records.append({
                "category": "cement_production",
                "subcategory": "calcination_ef_t_co2_per_t_clinker",
                "year": meta["year"],
                "value": value,
                "value_min": vmin,
                "value_max": vmax,
                "unit": raw_unit,
                "source": path.name,
                "sheet": sheet_name,
                "region": region,
                "technology": technology,
                "description": description,
                "reference": f"IPCC EFDB Extra-Page — {sheet_name}",
            })

    if not records:
        # Excel parsed but no records extracted — fall back to hardcoded
        return list(_HARDCODED_RECORDS)

    return records


def get_hardcoded_records() -> list[dict]:
    """Return the hardcoded records without requiring the Excel file."""
    return list(_HARDCODED_RECORDS)


def summarise(records: list[dict]) -> None:
    """Print a summary of the loaded records."""
    print(f"\n{'='*60}")
    print(f"IPCC EF Library — {len(records)} cement calcination records")
    print(f"{'='*60}")
    for r in records:
        tech = f" [{r['technology']}]" if r.get("technology") else ""
        print(
            f"  {r['year']} | {r['region']:<20} | "
            f"{r['value']:.4f} {r['unit']:<25}{tech}"
        )
    print(f"{'='*60}\n")
