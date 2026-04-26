"""
Tefnut CBAM Compliance Engine
EU Carbon Border Adjustment Mechanism — Regulation 2023/956

Wraps the existing CarbonEngine to compute Specific Embedded Emissions (SEE),
apply Carbon Price Paid credits, map CN codes, and generate SHA-256-verified
CBAM declarations.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import date, datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from carbon_engine.carbon_engine import PlantInput, CarbonEngine
from carbon_engine.validation import ValidationResult, ValidationCode

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CBAM Pre-obligation year constant
# ---------------------------------------------------------------------------
CBAM_PRE_OBLIGATION_YEAR = 2026

# ---------------------------------------------------------------------------
# CN Code Map — cement products under heading 2523
# ---------------------------------------------------------------------------
CN_CODE_MAP: dict[str, tuple[str, str]] = {
    "cement_clinker":        ("2523 10", "Cement clinker"),
    "white_cement":          ("2523 21", "White Portland cement"),
    "other_portland_cement": ("2523 29", "Other Portland cement"),
    "aluminous_cement":      ("2523 30", "Aluminous cement"),
    "other_hydraulic_cement":("2523 90", "Other hydraulic cements"),
}

N2O_PFC_COMPLIANCE_WARNING = (
    "Non-CO2 GHGs (N2O, PFCs) are negligible for this installation type as per "
    "GCCA Cement CO2 and Energy Protocol v3.1. Values set to zero."
)

CBAM_STANDARDS_CITED = [
    "EU Regulation 2023/956",
    "CBAM Implementing Regulation 2023/1773",
    "GCCA Cement CO2 and Energy Protocol v3.1",
]


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class KilnProcessType(str, Enum):
    DRY_KILN = "dry_kiln"
    WET_KILN = "wet_kiln"
    SEMI_DRY_KILN = "semi_dry_kiln"
    DRY_KILN_PH_PC = "dry_kiln_ph_pc"


# ---------------------------------------------------------------------------
# Input Models
# ---------------------------------------------------------------------------
class ProductionProcess(BaseModel):
    process_type: KilnProcessType
    kiln_capacity_t_clinker_per_day: float = Field(..., gt=0)
    annual_operating_hours: float = Field(..., ge=1, le=8760)
    clinker_to_cement_ratio: float = Field(..., ge=0.0, le=1.0)


class CarbonPricePaid(BaseModel):
    amount: float = Field(..., ge=0.0)
    currency_code: str = Field(..., min_length=3, max_length=3)  # ISO 4217


class CBAMInput(PlantInput):
    """Extends PlantInput with CBAM-specific fields. No manual certificate price."""
    product_type: str
    imported_quantity_t: float = Field(..., gt=0)
    carbon_price_paid: CarbonPricePaid
    transaction_date: Optional[str] = None   # ISO-8601 date; None → use latest ECB rate
    installation_latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    installation_longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)
    production_process: ProductionProcess
    declarant_eori: str
    # Override base field — CBAM obligation starts 2026, but allow earlier with warning
    reporting_year: int = Field(..., ge=2000, le=2100)


# ---------------------------------------------------------------------------
# Output Models
# ---------------------------------------------------------------------------
class SEEBreakdown(BaseModel):
    direct_emissions_t: float
    indirect_emissions_t: float
    total_embedded_co2e_t: float
    specific_embedded_emissions_t_per_t: float  # rounded to 6 d.p.


class DirectEmissions(BaseModel):
    calcination_co2_t: float
    fuel_combustion_co2_t: float
    total_direct_co2_t: float
    regulatory_classification: str = "Article 19 - Direct"


class IndirectEmissions(BaseModel):
    electricity_co2_t: float
    total_indirect_co2_t: float
    regulatory_classification: str = "Article 19 - Indirect"


class CarbonPriceCredit(BaseModel):
    original_amount: float
    original_currency: str
    exchange_rate_eur: float
    rate_date: str
    carbon_price_paid_eur_per_t_co2e: float
    imported_quantity_t: float
    credit_amount_eur: float
    net_cbam_obligation_certificates: float  # floored at 0.0


class ETSPriceReference(BaseModel):
    price_eur_per_t_co2e: float
    week_start_date: str
    source_url: str
    is_stale: bool  # True if > 14 days old


class CNClassification(BaseModel):
    cn_code: str
    product_type: str
    cn_description: str
    cbam_in_scope: bool


class InstallationMetadata(BaseModel):
    installation_name: str
    latitude: Optional[float]
    longitude: Optional[float]
    country: str = ""
    production_process: ProductionProcess
    reporting_period: str


class CBAMResult(BaseModel):
    see_breakdown: SEEBreakdown
    direct_emissions: DirectEmissions
    indirect_emissions: IndirectEmissions
    carbon_price_credit: CarbonPriceCredit
    ets_price_reference: ETSPriceReference
    cn_classification: CNClassification
    installation_metadata: InstallationMetadata
    declaration_sha256: str = ""
    compliance_warnings: list[str] = Field(default_factory=list)
    validation_warnings: list[dict] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# CBAM Engine
# ---------------------------------------------------------------------------
class CBAMEngine:
    """
    CBAM-compliant calculation engine for cement plants.
    Wraps CarbonEngine and adds SEE, certificate obligation, CN code mapping,
    and declaration generation per EU Regulation 2023/956.
    """

    def __init__(self, cbam_input: CBAMInput, db=None) -> None:
        self.cbam_input = cbam_input
        self.db = db
        self._compliance_warnings: list[str] = []
        self._validation_warnings: list[dict] = []

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------
    def validate_input(self) -> ValidationResult:
        result = ValidationResult()

        # Pre-obligation year warning (non-blocking)
        if self.cbam_input.reporting_year < CBAM_PRE_OBLIGATION_YEAR:
            result.add_warning(
                ValidationCode.MISSING_COLUMN,
                "reporting_year",
                f"CBAM_PRE_OBLIGATION_YEAR: reporting_year={self.cbam_input.reporting_year} is before "
                f"the CBAM obligation start year ({CBAM_PRE_OBLIGATION_YEAR}). "
                "Calculation will proceed but this declaration has no legal effect.",
                suggested_fix=f"Use reporting_year >= {CBAM_PRE_OBLIGATION_YEAR} for legally binding declarations.",
                meta={"code": "CBAM_PRE_OBLIGATION_YEAR", "reporting_year": self.cbam_input.reporting_year},
            )

        # Validate product type
        if self.cbam_input.product_type not in CN_CODE_MAP:
            result.add_error(
                ValidationCode.INVALID_CATEGORY,
                "product_type",
                f"CBAM_UNKNOWN_PRODUCT_TYPE: '{self.cbam_input.product_type}' is not a recognised CBAM product type.",
                suggested_fix=f"Use one of: {list(CN_CODE_MAP.keys())}",
                meta={"code": "CBAM_UNKNOWN_PRODUCT_TYPE", "supported_types": list(CN_CODE_MAP.keys())},
            )

        return result

    # ------------------------------------------------------------------
    # ETS Price
    # ------------------------------------------------------------------
    def _fetch_ets_price(self) -> ETSPriceReference:
        """Fetch most recent ETS price from DB or raise CBAM_NO_ETS_PRICE."""
        if self.db is None:
            raise ValueError("CBAM_NO_ETS_PRICE")

        try:
            row = self.db.queryOne(
                "SELECT * FROM cbam_ets_price_history ORDER BY week_start_date DESC LIMIT 1"
            )
        except Exception:
            raise ValueError("CBAM_NO_ETS_PRICE")

        if row is None:
            raise ValueError("CBAM_NO_ETS_PRICE")

        week_start = row["week_start_date"]
        if isinstance(week_start, str):
            week_date = date.fromisoformat(week_start)
        else:
            week_date = week_start

        days_old = (date.today() - week_date).days
        is_stale = days_old > 14

        return ETSPriceReference(
            price_eur_per_t_co2e=float(row["price_eur_per_t_co2e"]),
            week_start_date=str(week_start),
            source_url=row["source_url"],
            is_stale=is_stale,
        )

    # ------------------------------------------------------------------
    # SEE Calculation
    # ------------------------------------------------------------------
    def _calculate_see(self, scope1_total: float, scope2_total: float, production_t: float) -> SEEBreakdown:
        if production_t <= 0:
            raise ValueError("CBAM_ZERO_PRODUCTION")
        total = scope1_total + scope2_total
        see = round(total / production_t, 6)
        return SEEBreakdown(
            direct_emissions_t=scope1_total,
            indirect_emissions_t=scope2_total,
            total_embedded_co2e_t=total,
            specific_embedded_emissions_t_per_t=see,
        )

    # ------------------------------------------------------------------
    # Certificate Obligation
    # ------------------------------------------------------------------
    def _calculate_certificate_obligation(
        self,
        see: float,
        qty: float,
        ets_price: float,
        credit_eur: float,
    ) -> tuple[float, float, float]:
        """Returns (gross_obligation, credit_certificates, net_obligation)."""
        gross_obligation = see * qty * ets_price
        credit_certificates = (credit_eur * qty) / ets_price if ets_price > 0 else 0.0
        net_obligation = gross_obligation - credit_certificates
        if net_obligation < 0.0:
            self._compliance_warnings.append(
                "CBAM_CREDIT_EXCEEDS_OBLIGATION: Carbon price credit exceeds gross CBAM obligation. "
                "Net obligation clamped to 0.0."
            )
            net_obligation = 0.0
        return gross_obligation, credit_certificates, net_obligation

    # ------------------------------------------------------------------
    # CN Code Resolution
    # ------------------------------------------------------------------
    def _resolve_cn_code(self, product_type: str) -> CNClassification:
        if product_type not in CN_CODE_MAP:
            raise ValueError(
                f"CBAM_UNKNOWN_PRODUCT_TYPE: '{product_type}' not in CN_CODE_MAP. "
                f"Supported: {list(CN_CODE_MAP.keys())}"
            )
        cn_code, cn_description = CN_CODE_MAP[product_type]
        heading = cn_code.replace(" ", "")[:4]
        if heading != "2523":
            raise ValueError(f"CBAM_OUT_OF_SCOPE: CN code {cn_code} is not under heading 2523")
        return CNClassification(
            cn_code=cn_code,
            product_type=product_type,
            cn_description=cn_description,
            cbam_in_scope=True,
        )

    # ------------------------------------------------------------------
    # Direct / Indirect Emissions
    # ------------------------------------------------------------------
    def _build_direct_indirect_emissions(
        self, calcination_co2_t: float, fuel_combustion_co2_t: float,
        total_scope1_co2_t: float, electricity_co2_t: float,
    ) -> tuple[DirectEmissions, IndirectEmissions]:
        if abs(calcination_co2_t + fuel_combustion_co2_t - total_scope1_co2_t) > 0.01:
            raise ValueError("Direct emissions components do not sum to total_direct_co2_t")
        direct = DirectEmissions(
            calcination_co2_t=calcination_co2_t,
            fuel_combustion_co2_t=fuel_combustion_co2_t,
            total_direct_co2_t=total_scope1_co2_t,
        )
        indirect = IndirectEmissions(
            electricity_co2_t=electricity_co2_t,
            total_indirect_co2_t=electricity_co2_t,
        )
        return direct, indirect

    # ------------------------------------------------------------------
    # Full Pipeline
    # ------------------------------------------------------------------
    def calculate(self) -> CBAMResult:
        self._compliance_warnings = []
        self._validation_warnings = []

        # 1. Validate
        val_result = self.validate_input()
        if val_result.is_blocked:
            raise ValueError(f"Validation failed: {[e.error_code for e in val_result.errors]}")
        for w in val_result.warnings:
            self._validation_warnings.append(w.model_dump())

        # 2. Fetch ETS price
        ets_ref = self._fetch_ets_price()

        # 3. Currency conversion (EUR passthrough for EUR, else use CurrencyConversionLayer)
        cpp = self.cbam_input.carbon_price_paid
        if cpp.currency_code.upper() == "EUR":
            rate_to_eur = 1.0
            rate_date = self.cbam_input.transaction_date or str(date.today())
        else:
            from cbam_engine.currency_conversion import CurrencyConversionLayer
            converter = CurrencyConversionLayer()
            rate_to_eur, rate_date = converter.get_rate_to_eur(
                cpp.currency_code, self.cbam_input.transaction_date, self.db
            )

        carbon_price_paid_eur = cpp.amount * rate_to_eur

        # 4. Run Carbon Engine
        carbon_engine = CarbonEngine(self.cbam_input)
        calc = carbon_engine.calculate()

        scope1_total = calc.scope1.total_scope1_co2_t
        scope2_total = calc.scope2.electricity_co2_t
        production_t = self.cbam_input.cement_production_t_yr

        # 5. SEE
        see_breakdown = self._calculate_see(scope1_total, scope2_total, production_t)
        see = see_breakdown.specific_embedded_emissions_t_per_t

        # 6. Certificate obligation
        qty = self.cbam_input.imported_quantity_t
        gross_obl, credit_certs, net_obl = self._calculate_certificate_obligation(
            see, qty, ets_ref.price_eur_per_t_co2e, carbon_price_paid_eur
        )

        credit_amount_eur = credit_certs * ets_ref.price_eur_per_t_co2e

        carbon_price_credit = CarbonPriceCredit(
            original_amount=cpp.amount,
            original_currency=cpp.currency_code,
            exchange_rate_eur=rate_to_eur,
            rate_date=rate_date,
            carbon_price_paid_eur_per_t_co2e=carbon_price_paid_eur,
            imported_quantity_t=qty,
            credit_amount_eur=credit_amount_eur,
            net_cbam_obligation_certificates=net_obl,
        )

        # 7. CN code
        cn_classification = self._resolve_cn_code(self.cbam_input.product_type)

        # 8. Direct / Indirect
        direct_em, indirect_em = self._build_direct_indirect_emissions(
            calc.scope1.calcination_co2_t,
            calc.scope1.fuel_combustion_co2_t,
            calc.scope1.total_scope1_co2_t,
            calc.scope2.electricity_co2_t,
        )

        # 9. Installation metadata
        installation_metadata = InstallationMetadata(
            installation_name=self.cbam_input.plant_name,
            latitude=self.cbam_input.installation_latitude,
            longitude=self.cbam_input.installation_longitude,
            production_process=self.cbam_input.production_process,
            reporting_period=str(self.cbam_input.reporting_year),
        )

        # 10. N2O / PFC compliance warning
        self._compliance_warnings.append(N2O_PFC_COMPLIANCE_WARNING)

        return CBAMResult(
            see_breakdown=see_breakdown,
            direct_emissions=direct_em,
            indirect_emissions=indirect_em,
            carbon_price_credit=carbon_price_credit,
            ets_price_reference=ets_ref,
            cn_classification=cn_classification,
            installation_metadata=installation_metadata,
            compliance_warnings=list(self._compliance_warnings),
            validation_warnings=list(self._validation_warnings),
        )

    # ------------------------------------------------------------------
    # Declaration Generation
    # ------------------------------------------------------------------
    def generate_declaration(self) -> tuple[dict, CBAMResult]:
        result = self.calculate()

        declaration: dict = {
            "template_version": "EU_CBAM_TRANSITIONAL_2024",
            "declaration_metadata": {
                "reporting_period": str(self.cbam_input.reporting_year),
                "submission_date": str(date.today()),
                "declarant_eori": self.cbam_input.declarant_eori,
            },
            "installation_metadata": result.installation_metadata.model_dump(),
            "cn_classification": result.cn_classification.model_dump(),
            "see_breakdown": result.see_breakdown.model_dump(),
            "direct_emissions": result.direct_emissions.model_dump(),
            "indirect_emissions": result.indirect_emissions.model_dump(),
            "carbon_price_credit": result.carbon_price_credit.model_dump(),
            "covered_gases": ["CO2", "N2O", "PFCs"],
            "compliance_warnings": result.compliance_warnings,
            "standards_cited": CBAM_STANDARDS_CITED,
        }

        sha256 = hashlib.sha256(
            json.dumps(declaration, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).hexdigest()

        result.declaration_sha256 = sha256
        return declaration, result
