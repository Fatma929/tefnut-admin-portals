
"""
Unit tests for EmissionFactorService.
Uses an in-memory mock DB — no real PostgreSQL required.
"""
from __future__ import annotations

import pytest
from carbon_engine.emission_factor_service import (
    EmissionFactorCreate,
    EmissionFactorService,
    EmissionFactorUpdate,
    FactorSearchParams,
    SelectedFactor,
)


# ---------------------------------------------------------------------------
# Mock DB
# ---------------------------------------------------------------------------
class MockDb:
    """In-memory mock that mimics TenantDb interface."""

    def __init__(self, rows: list[dict] | None = None) -> None:
        self._rows: list[dict] = rows or []
        self._inserted: list[dict] = []
        self._updated: list[dict] = []

    def queryOne(self, sql: str, params=None) -> dict | None:
        # Return first matching row based on simple heuristics
        if not self._rows:
            return None
        # For select_factor tests, return the first row
        return self._rows[0] if self._rows else None

    def queryMany(self, sql: str, params=None) -> list[dict]:
        return list(self._rows)

    def query(self, sql: str, params=None):
        if params:
            self._inserted.append({"sql": sql, "params": params})
        return None


def _make_factor_row(**overrides) -> dict:
    base = {
        "id": "aaaaaaaa-0000-0000-0000-000000000001",
        "org_id": None,
        "facility_id": None,
        "factor_code": "GCCA_COAL_ANTHRACITE",
        "category": "fuel",
        "subcategory": "coal_anthracite",
        "fuel_type": "coal_anthracite",
        "process_type": None,
        "geography": "Global",
        "source_name": "GCCA Table 4 v3.1",
        "source_type": "gcca_default",
        "source_file": None,
        "source_sheet": None,
        "reporting_year": 2021,
        "applicable_from": None,
        "applicable_to": None,
        "unit": "kgCO2/GJ",
        "value": 96.0,
        "value_min": None,
        "value_max": None,
        "confidence_score": None,
        "priority_rank": 4,
        "is_active": True,
        "notes": None,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# EmissionFactorCreate validation
# ---------------------------------------------------------------------------
class TestEmissionFactorCreate:
    def test_valid_fuel_factor(self):
        ef = EmissionFactorCreate(
            factor_code="TEST_DIESEL",
            category="fuel",
            subcategory="diesel_oil",
            fuel_type="diesel_oil",
            geography="EG",
            source_name="Test Source",
            unit="kgCO2/GJ",
            value=74.1,
            priority_rank=2,
        )
        assert ef.value == 74.1
        assert ef.priority_rank == 2

    def test_valid_electricity_factor(self):
        ef = EmissionFactorCreate(
            factor_code="ELEC_EG_2023",
            category="electricity",
            subcategory="grid_egypt",
            geography="EG",
            source_name="Egyptian Electricity Holding Company",
            unit="kgCO2/MWh",
            value=461.0,
            priority_rank=2,
        )
        assert ef.geography == "EG"

    def test_valid_cement_process_factor(self):
        ef = EmissionFactorCreate(
            factor_code="GCCA_CALCINATION",
            category="cement_process",
            subcategory="clinker",
            source_name="GCCA Method B1",
            unit="tCO2/t clinker",
            value=0.525,
            priority_rank=4,
        )
        assert ef.value == pytest.approx(0.525)

    def test_negative_value_rejected(self):
        with pytest.raises(Exception):
            EmissionFactorCreate(
                factor_code="BAD",
                category="fuel",
                subcategory="diesel",
                source_name="Test",
                unit="kgCO2/GJ",
                value=-1.0,
            )

    def test_confidence_score_out_of_range_rejected(self):
        with pytest.raises(Exception):
            EmissionFactorCreate(
                factor_code="BAD",
                category="fuel",
                subcategory="diesel",
                source_name="Test",
                unit="kgCO2/GJ",
                value=74.1,
                confidence_score=1.5,
            )

    def test_priority_rank_out_of_range_rejected(self):
        with pytest.raises(Exception):
            EmissionFactorCreate(
                factor_code="BAD",
                category="fuel",
                subcategory="diesel",
                source_name="Test",
                unit="kgCO2/GJ",
                value=74.1,
                priority_rank=5,
            )


# ---------------------------------------------------------------------------
# EmissionFactorService CRUD
# ---------------------------------------------------------------------------
class TestEmissionFactorServiceCRUD:
    def setup_method(self):
        self.db = MockDb()
        self.svc = EmissionFactorService(self.db, org_id="org-001")

    def test_create_inserts_row(self):
        data = EmissionFactorCreate(
            factor_code="TEST_COAL",
            category="fuel",
            subcategory="coal_anthracite",
            source_name="Test",
            unit="kgCO2/GJ",
            value=96.0,
        )
        new_id = self.svc.create(data)
        assert len(new_id) > 0
        assert len(self.db._inserted) == 1

    def test_deactivate_calls_update(self):
        result = self.svc.deactivate("some-uuid")
        assert result is True
        assert any("is_active = FALSE" in str(call["sql"]) for call in self.db._inserted)

    def test_update_partial(self):
        update = EmissionFactorUpdate(value=98.0, notes="Updated")
        result = self.svc.update("some-uuid", update)
        assert result is True

    def test_update_empty_returns_false(self):
        update = EmissionFactorUpdate()
        result = self.svc.update("some-uuid", update)
        assert result is False

    def test_list_factors_returns_rows(self):
        self.db._rows = [_make_factor_row(), _make_factor_row(factor_code="GCCA_DIESEL")]
        params = FactorSearchParams()
        rows = self.svc.list_factors(params)
        assert len(rows) == 2

    def test_list_factors_filtered_by_category(self):
        self.db._rows = [_make_factor_row()]
        params = FactorSearchParams(category="fuel")
        rows = self.svc.list_factors(params)
        assert len(rows) == 1


# ---------------------------------------------------------------------------
# Selection logic
# ---------------------------------------------------------------------------
class TestFactorSelection:
    def test_plant_supplied_takes_priority(self):
        db = MockDb(rows=[_make_factor_row()])
        svc = EmissionFactorService(db, org_id="org-001")
        result = svc.select_factor(
            category="fuel",
            subcategory="coal_anthracite",
            year=2026,
            plant_supplied_value=88.0,
            plant_supplied_unit="kgCO2/GJ",
        )
        assert result.priority_rank == 1
        assert result.value == pytest.approx(88.0)
        assert result.source_name == "plant_input"
        assert result.factor_id is None
        assert "Plant-supplied" in result.reason_selected

    def test_plant_supplied_zero_falls_through(self):
        db = MockDb(rows=[_make_factor_row()])
        svc = EmissionFactorService(db, org_id="org-001")
        result = svc.select_factor(
            category="fuel",
            subcategory="coal_anthracite",
            year=2026,
            plant_supplied_value=0.0,
        )
        # 0.0 is not > 0, so falls through to DB
        assert result.priority_rank > 1

    def test_global_default_returned_when_no_plant_value(self):
        db = MockDb(rows=[_make_factor_row()])
        svc = EmissionFactorService(db, org_id="org-001")
        result = svc.select_factor(
            category="fuel",
            subcategory="coal_anthracite",
            year=2026,
        )
        assert result.value == pytest.approx(96.0)
        assert result.factor_id is not None

    def test_no_factor_raises_value_error(self):
        db = MockDb(rows=[])
        svc = EmissionFactorService(db, org_id="org-001")
        with pytest.raises(ValueError, match="No emission factor found"):
            svc.select_factor(
                category="unknown_category",
                subcategory="unknown_subcategory",
                year=2026,
            )

    def test_selected_factor_has_reason(self):
        db = MockDb(rows=[_make_factor_row()])
        svc = EmissionFactorService(db, org_id="org-001")
        result = svc.select_factor("fuel", "coal_anthracite", 2026)
        assert result.reason_selected
        assert len(result.reason_selected) > 5

    def test_selected_factor_has_unit(self):
        db = MockDb(rows=[_make_factor_row()])
        svc = EmissionFactorService(db, org_id="org-001")
        result = svc.select_factor("fuel", "coal_anthracite", 2026)
        assert result.unit == "kgCO2/GJ"


# ---------------------------------------------------------------------------
# record_usage
# ---------------------------------------------------------------------------
class TestRecordUsage:
    def test_record_usage_inserts_row(self):
        db = MockDb()
        svc = EmissionFactorService(db, org_id="org-001")
        selected = SelectedFactor(
            factor_id="factor-uuid",
            factor_code="GCCA_COAL",
            value=96.0,
            unit="kgCO2/GJ",
            source_name="GCCA Table 4",
            priority_rank=4,
            reason_selected="Global default",
        )
        svc.record_usage("run-uuid", "coal_anthracite_ef", selected)
        assert len(db._inserted) == 1
        assert "calculation_factor_usage" in db._inserted[0]["sql"]

    def test_record_usage_stores_correct_values(self):
        db = MockDb()
        svc = EmissionFactorService(db, org_id="org-001")
        selected = SelectedFactor(
            factor_id="fid",
            factor_code="TEST",
            value=74.1,
            unit="kgCO2/GJ",
            source_name="Test",
            priority_rank=2,
            reason_selected="Geography-specific",
        )
        svc.record_usage("run-001", "diesel_ef", selected)
        params = db._inserted[0]["params"]
        assert 74.1 in params
        assert "Geography-specific" in params


# ---------------------------------------------------------------------------
# Import from CSV
# ---------------------------------------------------------------------------
class TestImportFromCSV:
    def test_valid_csv_import(self):
        db = MockDb()
        svc = EmissionFactorService(db, org_id="org-001")
        csv_content = (
            "factor_code,category,subcategory,unit,value,source_name,geography\n"
            "MY_COAL,fuel,coal_anthracite,kgCO2/GJ,96.0,My Source,EG\n"
            "MY_DIESEL,fuel,diesel_oil,kgCO2/GJ,74.1,My Source,EG\n"
        ).encode("utf-8")
        imported, failed, errors = svc.import_from_csv(csv_content, "test.csv")
        assert imported == 2
        assert failed == 0
        assert errors == []

    def test_csv_missing_required_column(self):
        db = MockDb()
        svc = EmissionFactorService(db, org_id="org-001")
        csv_content = "factor_code,category\nTEST,fuel\n".encode("utf-8")
        imported, failed, errors = svc.import_from_csv(csv_content, "bad.csv")
        assert imported == 0
        assert len(errors) > 0

    def test_csv_invalid_value_row_counted_as_failed(self):
        db = MockDb()
        svc = EmissionFactorService(db, org_id="org-001")
        csv_content = (
            "factor_code,category,subcategory,unit,value,source_name\n"
            "GOOD,fuel,coal,kgCO2/GJ,96.0,Source\n"
            "BAD,fuel,coal,kgCO2/GJ,not_a_number,Source\n"
        ).encode("utf-8")
        imported, failed, errors = svc.import_from_csv(csv_content, "mixed.csv")
        assert imported == 1
        assert failed == 1
        assert len(errors) == 1
