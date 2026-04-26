/**
 * POST /api/cbam/calculate
 *
 * Accepts a CBAMInput JSON body, validates required fields, and returns a
 * mock CBAMResult matching the Python CBAMResult Pydantic model shape.
 *
 * TODO: Wire to Python cbam_engine via Lambda/subprocess
 */
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { resolveTenantContext } from "../../db/pg-client";

// ---------------------------------------------------------------------------
// Required fields for CBAMInput validation
// ---------------------------------------------------------------------------
const REQUIRED_FIELDS = [
  "product_type",
  "imported_quantity_t",
  "carbon_price_paid",
  "production_process",
  "declarant_eori",
  "reporting_year",
] as const;

// ---------------------------------------------------------------------------
// POST /api/cbam/calculate
// Body: CBAMInput JSON
// Returns: CBAMResult JSON
// ---------------------------------------------------------------------------
export const APIRoute = createAPIFileRoute("/api/cbam/calculate")({
  POST: async ({ request }) => {
    const { orgId } = resolveTenantContext(request);

    const body = await request.json() as Record<string, unknown>;

    // Validate required fields
    const missingFields = REQUIRED_FIELDS.filter((field) => !(field in body) || body[field] === null || body[field] === undefined);
    if (missingFields.length > 0) {
      return Response.json(
        {
          error: "Missing required fields",
          missing_fields: missingFields,
          required_fields: REQUIRED_FIELDS,
        },
        { status: 400 },
      );
    }

    // Validate carbon_price_paid sub-fields
    const carbonPricePaid = body.carbon_price_paid as Record<string, unknown> | null;
    if (!carbonPricePaid || typeof carbonPricePaid !== "object" || carbonPricePaid.amount === undefined || !carbonPricePaid.currency_code) {
      return Response.json(
        {
          error: "carbon_price_paid must include amount and currency_code",
        },
        { status: 400 },
      );
    }

    // Validate production_process sub-fields
    const productionProcess = body.production_process as Record<string, unknown> | null;
    if (!productionProcess || typeof productionProcess !== "object" || !productionProcess.process_type) {
      return Response.json(
        {
          error: "production_process must include process_type",
        },
        { status: 400 },
      );
    }

    const importedQty = body.imported_quantity_t as number;
    const etsPriceEur = 65.0; // Mock ETS price — TODO: read from cbam_ets_price_history
    const seeValue = 0.6; // Mock SEE — TODO: compute via CBAMEngine
    const grossObligation = seeValue * importedQty * etsPriceEur;
    const creditEur = (carbonPricePaid.amount as number) * importedQty;
    const netObligation = Math.max(0.0, grossObligation - creditEur / etsPriceEur);

    // TODO: Wire to Python cbam_engine via Lambda/subprocess
    const mockResult = {
      see_breakdown: {
        direct_emissions_t: importedQty * 0.5,
        indirect_emissions_t: importedQty * 0.1,
        total_embedded_co2e_t: importedQty * 0.6,
        specific_embedded_emissions_t_per_t: seeValue,
      },
      direct_emissions: {
        calcination_co2_t: importedQty * 0.5,
        fuel_combustion_co2_t: 0.0,
        total_direct_co2_t: importedQty * 0.5,
        regulatory_classification: "Article 19 - Direct",
      },
      indirect_emissions: {
        electricity_co2_t: importedQty * 0.1,
        total_indirect_co2_t: importedQty * 0.1,
        regulatory_classification: "Article 19 - Indirect",
      },
      carbon_price_credit: {
        original_amount: carbonPricePaid.amount as number,
        original_currency: carbonPricePaid.currency_code as string,
        exchange_rate_eur: 1.0,
        rate_date: new Date().toISOString().slice(0, 10),
        carbon_price_paid_eur_per_t_co2e: carbonPricePaid.amount as number,
        imported_quantity_t: importedQty,
        credit_amount_eur: creditEur,
        net_cbam_obligation_certificates: netObligation,
      },
      ets_price_reference: {
        price_eur_per_t_co2e: etsPriceEur,
        week_start_date: new Date().toISOString().slice(0, 10),
        source_url: "https://www.eex.com/en/market-data/environmental-markets/",
        is_stale: false,
      },
      cn_classification: {
        cn_code: "2523 29",
        product_type: body.product_type as string,
        cn_description: "Other Portland cement",
        cbam_in_scope: true,
      },
      installation_metadata: {
        installation_name: (body.facility_name as string | undefined) ?? "Unknown Facility",
        latitude: (body.installation_latitude as number | undefined) ?? 0.0,
        longitude: (body.installation_longitude as number | undefined) ?? 0.0,
        country: (body.country as string | undefined) ?? "Unknown",
        production_process: productionProcess,
        reporting_period: String(body.reporting_year),
      },
      declaration_sha256: "",
      compliance_warnings: [
        "Non-CO2 GHGs (N2O, PFCs) are negligible for cement under GCCA v3.1 and set to 0.0",
      ],
      validation_warnings: [],
      _org_id: orgId,
    };

    return Response.json(mockResult);
  },
});
