/**
 * NetFinancialImpactCard
 *
 * Displays the three CBAM financial line items derived from a CBAMResult:
 *   1. Gross EU Obligation (EUR)
 *   2. Domestic Credit (EUR)
 *   3. Net Payable (EUR)
 *
 * Role-gated: viewer role sees redacted values.
 * Shows ETS price and week_start_date as a footnote.
 */
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { formatEUR } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CBAMResult TypeScript interface — mirrors the Python CBAMResult Pydantic model
// ---------------------------------------------------------------------------
export interface CBAMResultType {
  see_breakdown: {
    direct_emissions_t: number;
    indirect_emissions_t: number;
    total_embedded_co2e_t: number;
    specific_embedded_emissions_t_per_t: number;
  };
  carbon_price_credit: {
    net_cbam_obligation_certificates: number;
    credit_amount_eur: number;
    imported_quantity_t: number;
    original_amount: number;
    original_currency: string;
    exchange_rate_eur: number;
    rate_date: string;
    carbon_price_paid_eur_per_t_co2e: number;
  };
  ets_price_reference: {
    price_eur_per_t_co2e: number;
    week_start_date: string;
    source_url: string;
    is_stale: boolean;
  };
  compliance_warnings: string[];
  direct_emissions?: {
    calcination_co2_t: number;
    fuel_combustion_co2_t: number;
    total_direct_co2_t: number;
    regulatory_classification: string;
  };
  indirect_emissions?: {
    electricity_co2_t: number;
    total_indirect_co2_t: number;
    regulatory_classification: string;
  };
  declaration_sha256?: string;
  validation_warnings?: unknown[];
}

interface Props {
  cbamResult: CBAMResultType | null;
  userRole: string;
}

export function NetFinancialImpactCard({ cbamResult, userRole }: Props) {
  const isViewer = userRole === "viewer";

  if (!cbamResult) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h3 className="font-semibold tracking-tight">Net Financial Impact</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Run a CBAM calculation to see your financial exposure.
        </p>
      </div>
    );
  }

  const { see_breakdown, carbon_price_credit, ets_price_reference } = cbamResult;
  const etsPrice = ets_price_reference.price_eur_per_t_co2e;
  const importedQty = carbon_price_credit.imported_quantity_t;

  const grossObligation =
    see_breakdown.specific_embedded_emissions_t_per_t * importedQty * etsPrice;
  const domesticCredit = carbon_price_credit.credit_amount_eur;
  const netPayable =
    carbon_price_credit.net_cbam_obligation_certificates * etsPrice;

  const lineItems = [
    { label: "Gross EU Obligation", value: grossObligation },
    { label: "Domestic Credit", value: domesticCredit },
    { label: "Net Payable", value: netPayable },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <h3 className="font-semibold tracking-tight">Net Financial Impact</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">
        EU CBAM certificate obligation — EU Regulation 2023/956
      </p>

      {isViewer ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-sm text-muted-foreground">
            Contact your compliance lead for financial details.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 divide-y divide-border rounded-xl border border-border overflow-hidden">
            {lineItems.map(({ label, value }) => (
              <div
                key={label}
                className="flex items-center justify-between px-4 py-3"
              >
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="font-mono text-sm font-medium tabular-nums">
                  {formatEUR(value)}
                </span>
              </div>
            ))}
          </div>

          {netPayable === 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-success/30 bg-success/8 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              <p className="text-sm font-medium text-success">
                Full credit applied — no net CBAM payment required
              </p>
            </div>
          )}

          {ets_price_reference.is_stale && (
            <p className="mt-2 text-xs text-warning">
              ⚠ ETS price data may be stale (last updated {ets_price_reference.week_start_date})
            </p>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            ETS reference price: {formatEUR(etsPrice)}/t CO₂e · week of{" "}
            {ets_price_reference.week_start_date}
          </p>
        </>
      )}
    </div>
  );
}
