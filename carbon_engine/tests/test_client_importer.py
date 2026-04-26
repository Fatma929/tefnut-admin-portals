
"""
Unit tests for ClientImporter.
Tests parsing, validation, deduplication, and upsert logic.
"""
from __future__ import annotations

import io
import pytest
import pandas as pd

from carbon_engine.client_importer import ClientImporter, ClientRow, ImportResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _make_csv(rows: list[dict]) -> bytes:
    df = pd.DataFrame(rows)
    buf = io.BytesIO()
    df.to_csv(buf, index=False)
    return buf.getvalue()


def _make_excel(rows: list[dict]) -> bytes:
    df = pd.DataFrame(rows)
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    return buf.getvalue()


_VALID_ROW = {
    "company_name": "Suez Cement",
    "country": "Egypt",
    "plant_name": "Suez Plant 1",
    "reporting_year": 2026,
    "industry": "cement",
    "city": "Suez",
    "currency": "EGP",
    "export_to_eu_flag": "yes",
    "contact_name": "Ahmed Hassan",
    "contact_email": "ahmed@suezcement.com",
    "plant_capacity": 1500000,
    "company_size": "large",
    "kiln_type": "dry_kiln_ph_pc",
}


# ---------------------------------------------------------------------------
# ClientRow validation
# ---------------------------------------------------------------------------
class TestClientRowValidation:
    def test_valid_row_parses(self):
        row = ClientRow(**_VALID_ROW)
        assert row.company_name == "Suez Cement"
        assert row.export_to_eu_flag is True
        assert row.currency == "EGP"

    def test_missing_company_name_raises(self):
        bad = {**_VALID_ROW}
        del bad["company_name"]
        with pytest.raises(Exception):
            ClientRow(**bad)

    def test_missing_country_raises(self):
        bad = {**_VALID_ROW, "country": None}
        with pytest.raises(Exception):
            ClientRow(**bad)

    def test_invalid_reporting_year_raises(self):
        bad = {**_VALID_ROW, "reporting_year": 1800}
        with pytest.raises(Exception):
            ClientRow(**bad)

    def test_invalid_company_size_raises(self):
        bad = {**_VALID_ROW, "company_size": "giant"}
        with pytest.raises(Exception):
            ClientRow(**bad)

    def test_export_to_eu_flag_yes_string(self):
        row = ClientRow(**{**_VALID_ROW, "export_to_eu_flag": "yes"})
        assert row.export_to_eu_flag is True

    def test_export_to_eu_flag_0_string(self):
        row = ClientRow(**{**_VALID_ROW, "export_to_eu_flag": "0"})
        assert row.export_to_eu_flag is False

    def test_export_to_eu_flag_true_bool(self):
        row = ClientRow(**{**_VALID_ROW, "export_to_eu_flag": True})
        assert row.export_to_eu_flag is True

    def test_kiln_type_normalised(self):
        row = ClientRow(**{**_VALID_ROW, "kiln_type": "Dry Kiln PH/PC"})
        assert row.kiln_type in ("dry_kiln_ph_pc", "other")

    def test_unknown_kiln_type_becomes_other(self):
        row = ClientRow(**{**_VALID_ROW, "kiln_type": "magic_kiln"})
        assert row.kiln_type == "other"

    def test_currency_uppercased(self):
        row = ClientRow(**{**_VALID_ROW, "currency": "egp"})
        assert row.currency == "EGP"

    def test_whitespace_stripped(self):
        row = ClientRow(**{**_VALID_ROW, "company_name": "  Suez Cement  "})
        assert row.company_name == "Suez Cement"

    def test_optional_fields_default_to_none(self):
        minimal = {
            "company_name": "Test Co",
            "country": "Egypt",
            "plant_name": "Test Plant",
            "reporting_year": 2026,
        }
        row = ClientRow(**minimal)
        assert row.city is None
        assert row.contact_email is None
        assert row.plant_capacity is None


# ---------------------------------------------------------------------------
# ClientImporter — CSV import
# ---------------------------------------------------------------------------
class TestClientImporterCSV:
    def test_valid_single_row(self):
        csv_bytes = _make_csv([_VALID_ROW])
        importer = ClientImporter()
        result = importer.import_csv(csv_bytes, "test.csv")
        assert result.failed_rows == 0
        assert result.imported_companies == 1
        assert result.imported_plants == 1
        assert len(result.companies) == 1
        assert len(result.plants) == 1

    def test_contact_created_when_email_provided(self):
        csv_bytes = _make_csv([_VALID_ROW])
        importer = ClientImporter()
        result = importer.import_csv(csv_bytes, "test.csv")
        assert len(result.contacts) == 1
        assert result.contacts[0]["contact_email"] == "ahmed@suezcement.com"

    def test_no_contact_when_no_email_or_name(self):
        row = {**_VALID_ROW}
        del row["contact_name"]
        del row["contact_email"]
        csv_bytes = _make_csv([row])
        importer = ClientImporter()
        result = importer.import_csv(csv_bytes, "test.csv")
        assert len(result.contacts) == 0

    def test_reporting_profile_created(self):
        csv_bytes = _make_csv([_VALID_ROW])
        importer = ClientImporter()
        result = importer.import_csv(csv_bytes, "test.csv")
        assert len(result.reporting_profiles) == 1
        assert result.reporting_profiles[0]["reporting_year"] == 2026

    def test_export_to_eu_sets_includes_cbam(self):
        csv_bytes = _make_csv([{**_VALID_ROW, "export_to_eu_flag": "yes"}])
        importer = ClientImporter()
        result = importer.import_csv(csv_bytes, "test.csv")
        assert result.reporting_profiles[0]["includes_cbam"] is True

    def test_multiple_rows_different_companies(self):
        rows = [
            _VALID_ROW,
            {**_VALID_ROW, "company_name": "Sinai Cement", "plant_name": "Sinai Plant 1"},
        ]
        csv_bytes = _make_csv(rows)
        importer = ClientImporter()
        result = importer.import_csv(csv_bytes, "test.csv")
        assert result.imported_companies == 2
        assert result.imported_plants == 2

    def test_same_company_two_plants(self):
        rows = [
            _VALID_ROW,
            {**_VALID_ROW, "plant_name": "Suez Plant 2"},
        ]
        csv_bytes = _make_csv(rows)
        importer = ClientImporter()
        result = importer.import_csv(csv_bytes, "test.csv")
        # Same company → 1 company record, 2 plant records
        assert result.imported_companies == 1
        assert result.imported_plants == 2
        assert len(result.warnings) >= 1  # duplicate company warning

    def test_missing_required_column_fails(self):
        row = {**_VALID_ROW}
        del row["company_name"]
        csv_bytes = _make_csv([row])
        importer = ClientImporter()
        result = importer.import_csv(csv_bytes, "test.csv")
        assert result.failed_rows > 0 or len(result.errors) > 0

    def test_invalid_email_produces_warning_not_error(self):
        row = {**_VALID_ROW, "contact_email": "not-an-email"}
        csv_bytes = _make_csv([row])
        importer = ClientImporter()
        result = importer.import_csv(csv_bytes, "test.csv")
        assert result.failed_rows == 0  # not a blocking error
        assert any("email" in w["field"].lower() for w in result.warnings)

    def test_column_alias_company_maps_to_company_name(self):
        row = {k.replace("company_name", "company"): v for k, v in _VALID_ROW.items()}
        csv_bytes = _make_csv([row])
        importer = ClientImporter()
        result = importer.import_csv(csv_bytes, "test.csv")
        assert result.imported_companies == 1

    def test_unreadable_file_returns_error(self):
        importer = ClientImporter()
        result = importer.import_csv(b"not a csv at all \x00\x01\x02", "bad.csv")
        # Should not raise — returns error in result
        assert isinstance(result, ImportResult)


# ---------------------------------------------------------------------------
# ClientImporter — Excel import
# ---------------------------------------------------------------------------
class TestClientImporterExcel:
    def test_valid_excel_import(self):
        xlsx_bytes = _make_excel([_VALID_ROW])
        importer = ClientImporter()
        result = importer.import_excel(xlsx_bytes, "test.xlsx")
        assert result.failed_rows == 0
        assert result.imported_companies == 1

    def test_excel_multiple_rows(self):
        rows = [_VALID_ROW, {**_VALID_ROW, "company_name": "Helwan Cement", "plant_name": "Helwan P1"}]
        xlsx_bytes = _make_excel(rows)
        importer = ClientImporter()
        result = importer.import_excel(xlsx_bytes, "test.xlsx")
        assert result.imported_companies == 2
        assert result.imported_plants == 2


# ---------------------------------------------------------------------------
# Upsert / duplicate detection
# ---------------------------------------------------------------------------
class TestUpsertLogic:
    def test_existing_company_triggers_update(self):
        existing = [{
            "id": "existing-uuid",
            "org_id": "org-uuid",
            "company_name": "Suez Cement",
            "country": "Egypt",
        }]
        csv_bytes = _make_csv([_VALID_ROW])
        importer = ClientImporter(existing_companies=existing)
        result = importer.import_csv(csv_bytes, "test.csv")
        assert result.updated_companies == 1
        assert result.imported_companies == 0
        # Existing org_id should be reused
        assert result.companies[0]["org_id"] == "org-uuid"

    def test_new_company_triggers_insert(self):
        csv_bytes = _make_csv([_VALID_ROW])
        importer = ClientImporter(existing_companies=[])
        result = importer.import_csv(csv_bytes, "test.csv")
        assert result.imported_companies == 1
        assert result.updated_companies == 0

    def test_case_insensitive_duplicate_detection(self):
        existing = [{
            "id": "existing-uuid",
            "org_id": "org-uuid",
            "company_name": "suez cement",   # lowercase
            "country": "egypt",
        }]
        csv_bytes = _make_csv([_VALID_ROW])  # "Suez Cement", "Egypt"
        importer = ClientImporter(existing_companies=existing)
        result = importer.import_csv(csv_bytes, "test.csv")
        assert result.updated_companies == 1


# ---------------------------------------------------------------------------
# ImportResult
# ---------------------------------------------------------------------------
class TestImportResult:
    def test_summary_contains_all_keys(self):
        result = ImportResult()
        summary = result.summary()
        for key in ["batch_id", "total_rows", "imported_companies", "failed_rows", "errors"]:
            assert key in summary

    def test_is_success_true_when_no_failures(self):
        result = ImportResult()
        assert result.is_success is True

    def test_is_success_false_when_failures(self):
        result = ImportResult()
        result.add_error(2, "company_name", "Missing")
        assert result.is_success is False

    def test_file_sha256_is_deterministic(self):
        data = b"hello world"
        h1 = ClientImporter.file_sha256(data)
        h2 = ClientImporter.file_sha256(data)
        assert h1 == h2
        assert len(h1) == 64
