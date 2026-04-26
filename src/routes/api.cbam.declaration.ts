/**
 * POST /api/cbam/declaration
 *
 * Accepts a CBAMInput JSON body and returns a CBAM declaration object,
 * a CBAMResult, and a report_id.
 *
 * Includes duplicate detection logic comment and mock implementation.
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
// POST /api/cbam/declaration
// Body: CBAMInput JSON
// Returns: { declaration: object, result: CBAMResult, report_id: string }
// ---------------------------------------------------------------------------
export const APIRoute = createAPIFileRoute("/api/cbam/declaration")({
  POST: async ({ request }) => {
    const { orgId } = resolveTenantContext(request);

    const body = await request.json() as Record<string, unknown>;

    // Validate required fields
    const missingFields = REQUIRED_FIELDS.filter(
      (field) => !(field in body) || body[field] === null || body[field] === undefined,
    );
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

    const carbonPricePaid = body.carbon_price_paid as Record<string, unknown>;
    const productionProcess = body.production_process as Record<string, unknown>;
    const importedQty = body.imported_quantity_t as number;
    const reportingYear = body.reporting_year as number;
    const declarantEori = body.declarant_eori as string;
    const facilityId = (body.facility_id as string | undefined) ?? "unknown-facility";

    const etsPriceEur = 65.0;
    const seeValue = 0.6;
    const grossObligation = seeValue * importedQty * etsPriceEur;
    const creditEur = (carbonPricePaid.amount as number) * importedQty;
    const netObligation = Math.max(0.0, grossObligation - creditEur / etsPriceEur);

    // TODO: Wire to Python cbam_engine.generate_declaration() via Lambda/subprocess

    const result = {
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
        reporting_period: String(reportingYear),
      },
      declaration_sha256: "",
      compliance_warnings: [
        "Non-CO2 GHGs (N2O, PFCs) are negligible for cement under GCCA v3.1 and set to 0.0",
      ],
      validation_warnings: [],
    };

    const declaration = {
      template_version: "EU_CBAM_TRANSITIONAL_2024",
      declaration_metadata: {
        reporting_period: String(reportingYear),
        submission_date: new Date().toISOString().slice(0, 10),
        declarant_eori: declarantEori,
      },
      installation_metadata: result.installation_metadata,
      cn_classification: result.cn_classification,
      see_breakdown: result.see_breakdown,
      direct_emissions: result.direct_emissions,
      indirect_emissions: result.indirect_emissions,
      carbon_price_credit: result.carbon_price_credit,
      covered_gases: ["CO2", "N2O", "PFCs"],
      compliance_warnings: result.compliance_warnings,
      standards_cited: [
        "EU Regulation 2023/956",
        "CBAM Implementing Regulation 2023/1773",
        "GCCA Cement CO2 and Energy Protocol v3.1",
      ],
    };

    // Duplicate detection logic:
    // TODO: Before inserting, query generated_reports for an existing row with the same
    // facility_id, reporting_year, and sha256_hash (report_type = 'cbam_annual').
    // If found, return the existing record with CBAM_DECLARATION_ALREADY_EXISTS warning.
    // SQL:
    //   SELECT id FROM generated_reports
    //   WHERE facility_id = $1 AND reporting_year = $2 AND sha256_hash = $3
    //     AND report_type = 'cbam_annual'
    //   LIMIT 1;

    // Mock report_id — TODO: insert GeneratedReport row and upload to S3
    const reportId = `cbam-${orgId}-${facilityId}-${reportingYear}-${Date.now()}`;

    // Attach sha256 to result
    result.declaration_sha256 = reportId;

    return Response.json({ declaration, result, report_id: reportId });
  },
});
