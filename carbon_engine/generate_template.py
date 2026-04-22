"""
Tefnut Standard Excel Template Generator
Run this script once to produce the client-facing upload template:

    python carbon_engine/generate_template.py

Outputs: tefnut_data_template.xlsx
"""

from __future__ import annotations

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

from carbon_engine.carbon_engine import FuelType, GCCA_DEFAULT_CALCINATION_EF_KG_PER_T_CLINKER

# ---------------------------------------------------------------------------
# Style constants
# ---------------------------------------------------------------------------
HEADER_FILL = PatternFill("solid", fgColor="1A3A5C")   # Tefnut dark blue
HEADER_FONT = Font(color="FFFFFF", bold=True, size=10)
REQUIRED_FILL = PatternFill("solid", fgColor="FFF3CD")  # amber — required field
OPTIONAL_FILL = PatternFill("solid", fgColor="E8F5E9")  # green — optional field
NOTE_FONT = Font(italic=True, color="666666", size=9)
SECTION_FILL = PatternFill("solid", fgColor="D6E4F0")   # light blue section header
SECTION_FONT = Font(bold=True, size=10, color="1A3A5C")


def _header(ws, col: int, row: int, text: str, required: bool = True) -> None:
    cell = ws.cell(row=row, column=col, value=text)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.alignment = Alignment(horizontal="center", wrap_text=True)


def _note(ws, col: int, row: int, text: str) -> None:
    cell = ws.cell(row=row, column=col, value=text)
    cell.font = NOTE_FONT
    cell.alignment = Alignment(wrap_text=True)


def _data_cell(ws, col: int, row: int, value, required: bool = False) -> None:
    cell = ws.cell(row=row, column=col, value=value)
    cell.fill = REQUIRED_FILL if required else OPTIONAL_FILL
    cell.alignment = Alignment(horizontal="left")


def _section_label(ws, col: int, row: int, text: str) -> None:
    cell = ws.cell(row=row, column=col, value=text)
    cell.font = SECTION_FONT
    cell.fill = SECTION_FILL


# ---------------------------------------------------------------------------
# Sheet 1: plant_info
# ---------------------------------------------------------------------------
def _build_plant_info(wb: openpyxl.Workbook) -> None:
    ws = wb.create_sheet("plant_info")

    columns = [
        # (header_text, column_name, unit, required, example_value, note)
        ("Plant Name",                  "plant_name",                    "",           True,  "Cement Plant — Suez",  ""),
        ("Reporting Year",              "reporting_year",                "",           True,  2026,                   ""),
        ("Calcination Method",          "calcination_method",            "",           True,  "B1",                   "B1 or A1"),
        ("Cement Production",           "cement_production_t_yr",        "t/yr",       True,  1_200_000,              "Total cement produced"),
        ("Clinker Production",          "clinker_production_t_yr",       "t/yr",       False, 1_000_000,              "Used for energy intensity KPI"),
        ("CBAM Goods Count",            "cbam_goods_count",              "",           False, 14,                     "Number of CBAM-covered goods"),
        ("CBAM Completeness",           "cbam_data_completeness_pct",    "%",          False, 92.0,                   "0–100"),
        # B1
        ("B1: Clinker Production",      "b1_clinker_production_t_yr",    "t/yr",       False, 1_000_000,              "Required if method=B1"),
        ("B1: Bypass Dust",             "b1_bypass_dust_t_yr",           "t/yr",       False, 0,                      ""),
        ("B1: CKD Leaving Kiln",        "b1_ckd_leaving_kiln_t_yr",      "t/yr",       False, 0,                      ""),
        ("B1: CKD Calcination Rate d",  "b1_ckd_calcination_rate_d",     "0–1",        False, 0.0,                    "0=dry process, 1=wet process"),
        ("B1: Calcination EF",          "b1_calcination_ef_kg_per_t_clinker", "kg CO2/t cli", False, GCCA_DEFAULT_CALCINATION_EF_KG_PER_T_CLINKER, "GCCA default=525"),
        # A1
        ("A1: Kiln Feed",               "a1_kiln_feed_t_yr",             "t/yr",       False, 1_861_500,              "Required if method=A1"),
        ("A1: Dust Return Correction",  "a1_dust_return_correction_pct", "%",          False, 10.33,                  "% of kiln feed"),
        ("A1: LOI Raw Meal",            "a1_loi_raw_meal_pct",           "%",          False, 35.0,                   "Loss on Ignition of raw meal"),
        ("A1: CKD Leaving Kiln",        "a1_ckd_leaving_kiln_t_yr",      "t/yr",       False, 0,                      ""),
        ("A1: LOI CKD",                 "a1_loi_ckd_pct",                "%",          False, 0.0,                    ""),
        # Electricity
        ("Electricity Purchased",       "electricity_purchased_mwh_yr",  "MWh/yr",     False, 50_000,                 "Leave blank if no grid electricity"),
        ("Grid EF",                     "electricity_grid_ef_kg_co2_per_mwh", "kg CO2/MWh", False, 0.5,              "Country/regional grid factor"),
        # Water
        ("Water Withdrawal",            "water_withdrawal_m3_yr",        "m3/yr",      False, 1_200_000,              ""),
        ("Water Discharge",             "water_discharge_m3_yr",         "m3/yr",      False, 200_000,                ""),
        ("Water Recycled",              "water_recycled_m3_yr",          "m3/yr",      False, 50_000,                 ""),
    ]

    # Row 1: column machine names (used by parser)
    # Row 2: human-readable headers
    # Row 3: units
    # Row 4: notes
    # Row 5: example data (highlighted)

    for col_idx, (label, col_name, unit, required, example, note) in enumerate(columns, start=1):
        ws.cell(row=1, column=col_idx, value=col_name).font = Font(color="999999", size=8)
        _header(ws, col_idx, 2, label, required)
        _note(ws, col_idx, 3, unit)
        _note(ws, col_idx, 4, note)
        _data_cell(ws, col_idx, 5, example, required)
        ws.column_dimensions[get_column_letter(col_idx)].width = max(18, len(label) + 2)

    # Calcination method dropdown
    dv = DataValidation(type="list", formula1='"B1,A1"', allow_blank=False)
    ws.add_data_validation(dv)
    dv.add(ws.cell(row=5, column=3))

    ws.row_dimensions[2].height = 30
    ws.freeze_panes = "A5"


# ---------------------------------------------------------------------------
# Sheet 2 & 3: kiln_fuels / non_kiln_fuels
# ---------------------------------------------------------------------------
def _build_fuel_sheet(wb: openpyxl.Workbook, sheet_name: str, is_kiln: bool) -> None:
    ws = wb.create_sheet(sheet_name)

    headers = [
        ("fuel_type",           "Fuel Type",                  "See allowed values →"),
        ("consumption_t_per_yr","Consumption",                 "t/yr"),
        ("lhv_gj_per_t",        "Lower Heating Value (LHV)",  "GJ/t"),
        ("ef_kg_co2_per_gj",    "CO2 Emission Factor",        "kg CO2/GJ — blank = GCCA default"),
        ("biogenic_fraction",   "Biogenic Fraction",          "0–1 (0 for fossil fuels)"),
    ]

    for col_idx, (col_name, label, unit) in enumerate(headers, start=1):
        ws.cell(row=1, column=col_idx, value=col_name).font = Font(color="999999", size=8)
        _header(ws, col_idx, 2, label)
        _note(ws, col_idx, 3, unit)
        ws.column_dimensions[get_column_letter(col_idx)].width = 28

    # Example rows
    examples = [
        ("coal_anthracite",    10_000, 26.0,  "",    0.0),
        ("petrol_coke",         2_000, 32.5,  "",    0.0),
        ("natural_gas",         1_500, 48.0,  "",    0.0),
    ] if is_kiln else [
        ("diesel_oil",            500, 42.7,  "",    0.0),
    ]

    for row_offset, row_data in enumerate(examples):
        for col_idx, val in enumerate(row_data, start=1):
            _data_cell(ws, col_idx, 4 + row_offset, val if val != "" else None, required=(col_idx <= 3))

    # Fuel type dropdown validation
    fuel_values = ",".join(e.value for e in FuelType)
    dv = DataValidation(type="list", formula1=f'"{fuel_values}"', allow_blank=False)
    ws.add_data_validation(dv)
    for row in range(4, 54):  # allow up to 50 fuel rows
        dv.add(ws.cell(row=row, column=1))

    # Allowed values reference table (column G onwards)
    ws.cell(row=2, column=7, value="Allowed fuel_type values").font = SECTION_FONT
    for i, ft in enumerate(FuelType, start=3):
        ws.cell(row=i, column=7, value=ft.value).font = Font(size=9)

    ws.freeze_panes = "A4"


# ---------------------------------------------------------------------------
# Sheet 4: transport
# ---------------------------------------------------------------------------
def _build_transport_sheet(wb: openpyxl.Workbook) -> None:
    ws = wb.create_sheet("transport")

    headers = [
        ("description",              "Description",              "e.g. Limestone quarry to plant"),
        ("freight_tonne_km",         "Freight",                  "tonne-km"),
        ("ef_kg_co2_per_tonne_km",   "Transport EF",             "kg CO2/tonne-km — default 0.062 (road)"),
    ]

    for col_idx, (col_name, label, unit) in enumerate(headers, start=1):
        ws.cell(row=1, column=col_idx, value=col_name).font = Font(color="999999", size=8)
        _header(ws, col_idx, 2, label)
        _note(ws, col_idx, 3, unit)
        ws.column_dimensions[get_column_letter(col_idx)].width = 35

    examples = [
        ("Limestone quarry to plant",   1_000_000, 0.062),
        ("Coal supplier to plant",        500_000, 0.062),
        ("Cement to distribution hub",    800_000, 0.062),
    ]
    for row_offset, row_data in enumerate(examples):
        for col_idx, val in enumerate(row_data, start=1):
            _data_cell(ws, col_idx, 4 + row_offset, val, required=(col_idx <= 2))

    ws.freeze_panes = "A4"


# ---------------------------------------------------------------------------
# Sheet 5: instructions
# ---------------------------------------------------------------------------
def _build_instructions(wb: openpyxl.Workbook) -> None:
    ws = wb.create_sheet("instructions")
    ws.sheet_properties.tabColor = "1A3A5C"

    lines = [
        ("TEFNUT STANDARD DATA TEMPLATE", True, 14),
        ("GCCA Cement CO2 and Energy Protocol — v3.1 compliant", False, 10),
        ("", False, 10),
        ("HOW TO USE THIS TEMPLATE", True, 11),
        ("1. Fill in the 'plant_info' sheet. Row 5 contains example data — replace with your values.", False, 10),
        ("2. Add kiln fuel rows to 'kiln_fuels' sheet (one row per fuel type).", False, 10),
        ("3. Add non-kiln fuel rows to 'non_kiln_fuels' sheet.", False, 10),
        ("4. Add transport legs to 'transport' sheet for Scope 3.", False, 10),
        ("5. Upload this file to the Tefnut portal via the 'Upload file' button.", False, 10),
        ("", False, 10),
        ("CALCINATION METHODS", True, 11),
        ("B1 (Simple Output) — Default. Requires: b1_clinker_production_t_yr.", False, 10),
        ("  Uses GCCA default EF of 525 kg CO2/t clinker. No lab analysis needed.", False, 10),
        ("A1 (Simple Input)  — Requires: a1_kiln_feed_t_yr, a1_dust_return_correction_pct, a1_loi_raw_meal_pct.", False, 10),
        ("  Based on Loss on Ignition (LOI) analysis of raw meal.", False, 10),
        ("", False, 10),
        ("IMPORTANT NOTES", True, 11),
        ("• Do NOT rename or delete the machine-name row (Row 1 in each sheet).", False, 10),
        ("• Do NOT rename sheet tabs.", False, 10),
        ("• Leave EF columns blank to use GCCA default emission factors.", False, 10),
        ("• Biomass fuels are automatically excluded from Scope 1 totals (GCCA memo item).", False, 10),
        ("• Natural gas consumption should be in tonnes/yr (convert from Nm3 if needed).", False, 10),
        ("", False, 10),
        ("SUPPORT", True, 11),
        ("Contact: support@tefnut.io", False, 10),
    ]

    for row_idx, (text, bold, size) in enumerate(lines, start=1):
        cell = ws.cell(row=row_idx, column=1, value=text)
        cell.font = Font(bold=bold, size=size, color="1A3A5C" if bold else "333333")
        cell.alignment = Alignment(wrap_text=True)

    ws.column_dimensions["A"].width = 90


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def generate_template(output_path: str = "tefnut_data_template.xlsx") -> None:
    wb = openpyxl.Workbook()
    # Remove default sheet
    wb.remove(wb.active)

    _build_instructions(wb)
    _build_plant_info(wb)
    _build_fuel_sheet(wb, "kiln_fuels", is_kiln=True)
    _build_fuel_sheet(wb, "non_kiln_fuels", is_kiln=False)
    _build_transport_sheet(wb)

    wb.save(output_path)
    print(f"Template saved to: {output_path}")


if __name__ == "__main__":
    generate_template()
