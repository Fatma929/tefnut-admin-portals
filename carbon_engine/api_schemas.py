
"""
Tefnut Enterprise API Schemas — Pydantic V2
Covers all input/output models for the enterprise data architecture.

These schemas are the API contract layer — they map to the tables in
migration 0004_enterprise_schema.sql and are used by all API routes.
"""
from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Shared Enums
# ---------------------------------------------------------------------------
class KilnType(str, Enum):
    DRY_KILN = "dry_kiln"
    WET_KILN = "wet_kiln"
    SEMI_DRY_KILN = "semi_dry_kiln"
    DRY_KILN_PH_PC = "dry_kiln_ph_pc"
    VERTICAL_SHAFT_KILN = "vertical_shaft_kiln"
    OTHER = "other"


class PeriodType(str, Enum):
    ANNUAL = "annual"
    QUARTERLY = "quarterly"
    MONTHLY = "monthly"


class RunStatus(str, Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    SUPERSEDED = "superseded"


class TransportMode(str, Enum):
    ROAD = "road"
    RAIL = "rail"
    SEA = "sea"
    AIR = "air"
    PIPELINE = "pipeline"
    OTHER = "other"


class DataQuality(str, Enum):
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


class ReportingStandard(str, Enum):
    GHG_PROTOCOL = "GHG Protocol"
    ISO_14064 = "ISO 14064-1"
    GCCA = "GCCA"
    EU_CBAM = "EU CBAM"
    CDP = "CDP"
    GRI = "GRI"


# ---------------------------------------------------------------------------
# Part A — Company Level Input
# ---------------------------------------------------------------------------
class CompanyInput(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=255)
    industry: str = Field("cement", description="Primary industry sector")
    country: str = Field(..., min_length=2, max_length=100)
    currency: str = Field("USD", min_length=3, max_length=3, description="ISO 4217 currency code")
    reporting_standard: ReportingStandard = ReportingStandard.GCCA
    fiscal_year_start: int = Field(1, ge=1, le=12, description="Month number (1=Jan)")
    eori_number: Optional[str] = Field(None, description="EU CBAM EORI identifier")
    base_year: int = Field(..., ge=1990, le=2100, description="ISO 14064-1 base year")


# ---------------------------------------------------------------------------
# Part B — Plant Level Input
# ---------------------------------------------------------------------------
class PlantLevelInput(BaseModel):
    plant_name: str = Field(..., min_length=1, max_length=255)
    country: str = Field(..., min_length=2, max_length=100)
    latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)
    plant_type: str = Field("cement_plant")
    kiln_type: Optional[KilnType] = None
    production_lines: Optional[int] = Field(None, ge=1, le=50)
    clinker_capacity_t_yr: Optional[float] = Field(None, gt=0)
    cement_capacity_t_yr: Optional[float] = Field(None, gt=0)
    commissioning_year: Optional[int] = Field(None, ge=1900, le=2100)


# ---------------------------------------------------------------------------
# Part C — Production Inputs
# ---------------------------------------------------------------------------
class ProductionInputs(BaseModel):
    clinker_production_t: Optional[float] = Field(None, ge=0)
    cement_production_t: float = Field(..., gt=0)
    raw_meal_t: Optional[float] = Field(None, ge=0)
    clinker_ratio: Optional[float] = Field(None, ge=0.0, le=1.0)
    operating_days: Optional[int] = Field(None, ge=1, le=366)
    calcination_method: str = Field("B1", pattern="^(B1|A1|B2)$")
    calcination_ef_kg_per_t: float = Field(525.0, gt=0, description="kg CO2/t clinker")


# ---------------------------------------------------------------------------
# Part D — Fuel Inputs
# ---------------------------------------------------------------------------
class FuelInput(BaseModel):
    fuel_type: str
    is_kiln_fuel: bool = True
    consumption_t: float = Field(..., ge=0)
    lhv_gj_per_t: float = Field(..., gt=0)
    ef_kg_co2_per_gj: Optional[float] = Field(None, ge=0, description="None → use GCCA default")
    ef_source: Optional[str] = None
    biogenic_fraction: float = Field(0.0, ge=0.0, le=1.0)
    supplier_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Part E — Electricity Inputs
# ---------------------------------------------------------------------------
class ElectricityInputs(BaseModel):
    purchased_mwh: float = Field(0.0, ge=0)
    on_site_generated_mwh: float = Field(0.0, ge=0)
    renewable_mwh: float = Field(0.0, ge=0)
    grid_ef_kg_co2_per_mwh: float = Field(..., gt=0)
    grid_ef_source: str = Field("national_grid")

    @model_validator(mode="after")
    def renewable_le_purchased(self) -> "ElectricityInputs":
        if self.renewable_mwh > self.purchased_mwh + self.on_site_generated_mwh:
            raise ValueError("renewable_mwh cannot exceed total electricity")
        return self


# ---------------------------------------------------------------------------
# Part F — Logistics Inputs
# ---------------------------------------------------------------------------
class LogisticsInput(BaseModel):
    description: str
    direction: str = Field("outbound", pattern="^(inbound|outbound)$")
    transport_mode: TransportMode = TransportMode.ROAD
    freight_t_km: float = Field(..., ge=0)
    ef_kg_co2_per_t_km: float = Field(0.062, ge=0)


# ---------------------------------------------------------------------------
# Part G — Water Inputs
# ---------------------------------------------------------------------------
class WaterInputs(BaseModel):
    withdrawal_m3: float = Field(0.0, ge=0)
    discharge_m3: float = Field(0.0, ge=0)
    recycled_m3: float = Field(0.0, ge=0)
    harvested_rain_m3: float = Field(0.0, ge=0)
    water_source: Optional[str] = None
    discharge_destination: Optional[str] = None
    water_stress_index: Optional[float] = Field(None, ge=0, le=5)


# ---------------------------------------------------------------------------
# Part H — Compliance Inputs (CBAM)
# ---------------------------------------------------------------------------
class CBAMComplianceInput(BaseModel):
    product_type: str = Field("other_portland_cement")
    hs_codes: list[str] = Field(default_factory=list, description="e.g. ['2523 29']")
    export_destinations: list[str] = Field(default_factory=list, description="EU country codes")
    imported_quantity_t: Optional[float] = Field(None, gt=0)
    carbon_price_paid_amount: float = Field(0.0, ge=0)
    carbon_price_paid_currency: str = Field("EUR", min_length=3, max_length=3)
    declarant_eori: Optional[str] = None
    reporting_period: Optional[str] = None


# ---------------------------------------------------------------------------
# MASTER: CreateInputRequest  (all groups combined)
# ---------------------------------------------------------------------------
class CreateInputRequest(BaseModel):
    """Full structured input for a single plant/period calculation."""
    # Context
    facility_id: UUID
    period_id: UUID
    version_no: int = Field(1, ge=1)

    # Input groups
    production: ProductionInputs
    fuels: list[FuelInput] = Field(default_factory=list)
    electricity: Optional[ElectricityInputs] = None
    logistics: list[LogisticsInput] = Field(default_factory=list)
    water: Optional[WaterInputs] = None
    cbam: Optional[CBAMComplianceInput] = None

    # Metadata
    data_quality_score: DataQuality = DataQuality.MEDIUM
    notes: Optional[str] = None


class UpdateInputRequest(BaseModel):
    """Partial update — only provided fields are changed."""
    production: Optional[ProductionInputs] = None
    fuels: Optional[list[FuelInput]] = None
    electricity: Optional[ElectricityInputs] = None
    logistics: Optional[list[LogisticsInput]] = None
    water: Optional[WaterInputs] = None
    cbam: Optional[CBAMComplianceInput] = None
    data_quality_score: Optional[DataQuality] = None
    notes: Optional[str] = None


class RunCalculationRequest(BaseModel):
    """Trigger a calculation run for an existing plant_input."""
    plant_input_id: UUID
    engine_version: str = Field("GCCA Carbon v3.1")
    prefer_ef_library: bool = Field(False, description="Use IPCC EF library over GCCA default")
    ef_library_region: Optional[str] = None
    ef_library_technology: Optional[str] = None
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Output Schemas
# ---------------------------------------------------------------------------

class EmissionsSummary(BaseModel):
    scope1_total_t: float
    scope2_total_t: float
    scope3_total_t: float
    total_co2e_t: float
    biomass_co2_memo_t: float = 0.0


class ScopeDetail(BaseModel):
    calcination_co2_t: float
    kiln_fuel_co2_t: float
    non_kiln_fuel_co2_t: float
    electricity_co2_t: float
    transport_co2_t: float


class IntensityKPIs(BaseModel):
    kg_co2_per_t_cement: Optional[float]
    kg_co2_per_t_clinker: Optional[float]
    gj_per_t_clinker: Optional[float]
    m3_water_per_t_product: Optional[float]


class BenchmarkComparison(BaseModel):
    metric: str
    current_value: float
    vs_last_year: Optional[float] = None
    vs_last_year_pct: Optional[float] = None
    vs_portfolio_avg: Optional[float] = None
    vs_reference_factor: Optional[float] = None
    unit: str


class AlertItem(BaseModel):
    code: str
    severity: str   # "error" | "warning" | "info"
    field: Optional[str]
    message: str
    suggested_fix: Optional[str] = None


class ComplianceOutput(BaseModel):
    cbam_see_t_per_t: Optional[float]
    cbam_certificate_obligation: Optional[float]
    cbam_net_payable_eur: Optional[float]
    data_completeness_pct: float
    submission_ready: bool


class ChartPayload(BaseModel):
    source_mix: list[dict[str, Any]]
    yearly_trend: list[dict[str, Any]] = Field(default_factory=list)
    scope_breakdown: list[dict[str, Any]] = Field(default_factory=list)
    plant_comparison: list[dict[str, Any]] = Field(default_factory=list)


class FactorAuditOutput(BaseModel):
    selected_source: str
    selected_value_kg_per_t: float
    gcca_default_kg_per_t: float
    library_value_kg_per_t: Optional[float]
    why_selected: str


class CalculationResponse(BaseModel):
    """Full structured response from a calculation run."""
    run_id: UUID
    facility_id: UUID
    period_label: str
    version_no: int
    status: RunStatus

    # Output groups
    emissions: EmissionsSummary
    scope_detail: ScopeDetail
    intensity_kpis: IntensityKPIs
    benchmarks: list[BenchmarkComparison] = Field(default_factory=list)
    alerts: list[AlertItem] = Field(default_factory=list)
    compliance: ComplianceOutput
    charts: ChartPayload

    # Transparency
    factor_audit: Optional[FactorAuditOutput] = None
    input_sha256: str
    calculated_at: str
    engine_version: str


class ReportResponse(BaseModel):
    """Response for a generated report."""
    report_id: UUID
    facility_id: UUID
    report_type: str
    period_label: str
    title: str
    status: str
    sha256_hash: str
    storage_key: Optional[str]
    standards_cited: list[str]
    generated_at: str
    download_url: Optional[str] = None


class DashboardKPIResponse(BaseModel):
    """Denormalised dashboard response (from mv_dashboard_kpis)."""
    org_id: UUID
    facility_id: UUID
    facility_name: str
    year: int
    period_label: str
    run_status: RunStatus
    total_co2e_t: float
    kg_co2_per_t_cement: Optional[float]
    kg_co2_per_t_clinker: Optional[float]
    gj_per_t_clinker: Optional[float]
    water_consumption_m3: Optional[float]
    cbam_see_t_per_t: Optional[float]
    cbam_net_payable_eur: Optional[float]
    data_quality_score: DataQuality
    data_completeness_pct: float
    yoy_change_pct: Optional[float]
    source_mix: list[dict[str, Any]]
    calculated_at: str
