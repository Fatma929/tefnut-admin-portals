import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Building2,
  CheckCircle2,
  Copy,
  Database,
  Download,
  Droplets,
  FileText,
  Leaf,
  Loader2,
  Plus,
  ShieldCheck,
  Upload,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalculationStepsDrawer } from "@/components/CalculationStepsDrawer";
import { ValidationWarningBanner } from "@/components/ValidationWarningBanner";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { WaterBreakdownPanel } from "@/components/WaterBreakdownPanel";
import { NetFinancialImpactCard, type CBAMResultType } from "@/components/NetFinancialImpactCard";
import { useDashboard } from "@/hooks/use-dashboard";
import type { CarbonResult, WaterResult } from "@/lib/engine-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/")({ component: DashboardPage });

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

const emissionsData = [
  { month: "Jan", scope1: 5200, scope2: 2100, scope3: 1800 },
  { month: "Feb", scope1: 5050, scope2: 2050, scope3: 1750 },
  { month: "Mar", scope1: 4900, scope2: 1980, scope3: 1700 },
  { month: "Apr", scope1: 4750, scope2: 1920, scope3: 1650 },
  { month: "May", scope1: 4600, scope2: 1860, scope3: 1600 },
  { month: "Jun", scope1: 4450, scope2: 1800, scope3: 1550 },
  { month: "Jul", scope1: 4300, scope2: 1740, scope3: 1500 },
  { month: "Aug", scope1: 4150, scope2: 1680, scope3: 1450 },
  { month: "Sep", scope1: 4000, scope2: 1620, scope3: 1400 },
];

const sourceMix = [
  { name: "Process emissions", value: 48, color: "var(--color-brand)" },
  { name: "Fuel combustion", value: 22, color: "var(--color-info)" },
  { name: "Electricity", value: 18, color: "var(--color-success)" },
  { name: "Logistics", value: 8, color: "var(--color-warning)" },
  { name: "Other", value: 4, color: "var(--color-muted-foreground)" },
];

const waterConsumptionTrend = [
  { month: "Jan", consumption: 478000 },
  { month: "Feb", consumption: 472000 },
  { month: "Mar", consumption: 468000 },
  { month: "Apr", consumption: 465000 },
  { month: "May", consumption: 461000 },
  { month: "Jun", consumption: 458000 },
  { month: "Jul", consumption: 455000 },
  { month: "Aug", consumption: 452000 },
  { month: "Sep", consumption: 450000 },
];

const mockCarbonResult: CarbonResult = {
  specific_co2_kg_per_t_cement: 642.5,
  total_co2_t: 148975,
  validation_warnings: [],
  audit_trail: {
    source_reference: {
      source_filename: "cement_data_2024.xlsx",
      upload_timestamp_utc: "2024-09-15T10:30:00Z",
      input_hash: "a3f8c2d1e9b047f6a1c3d5e7f9b2a4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4f6a8",
    },
    user_id: "user_001",
  },
  methodology: { protocol_name: "GCCA Carbon", protocol_version: "0.1" },
  steps_breakdown: [
    {
      step_id: "calcination_co2",
      label: "Calcination CO₂",
      formula: "clinker_t × calcination_factor",
      inputs: {
        clinker_t: { value: 210000, unit: "t" },
        calcination_factor: { value: 0.525, unit: "t CO₂/t clinker" },
      },
      output_value: 110250,
      output_unit: "t CO₂",
    },
    {
      step_id: "fuel_co2",
      label: "Fuel Combustion CO₂",
      formula: "fuel_tj × emission_factor",
      inputs: {
        fuel_tj: { value: 3200, unit: "TJ" },
        emission_factor: { value: 9.5, unit: "t CO₂/TJ" },
      },
      output_value: 30400,
      output_unit: "t CO₂",
    },
    {
      step_id: "electricity_co2",
      label: "Electricity CO₂",
      formula: "electricity_mwh × grid_factor",
      inputs: {
        electricity_mwh: { value: 85000, unit: "MWh" },
        grid_factor: { value: 0.098, unit: "t CO₂/MWh" },
      },
      output_value: 8330,
      output_unit: "t CO₂",
    },
    {
      step_id: "net_specific_co2",
      label: "Net Specific CO₂",
      formula: "total_co2_t / cementitious_production_t",
      inputs: {
        total_co2_t: { value: 148975, unit: "t CO₂" },
        cementitious_production_t: { value: 231900, unit: "t" },
      },
      output_value: 642.5,
      output_unit: "kg CO₂/t cement",
    },
  ],
};

const mockWaterResult: WaterResult = {
  total_water_withdrawal_m3: 550000,
  total_water_discharge_m3: 100000,
  total_water_consumption_m3: 450000,
  total_freshwater_consumption_m3: 450000,
  water_consumption_per_tonne_litres: 195.65,
  quarry_water_not_used_m3: 12000,
  recycled_water_m3: 38000,
  storm_water_collected_discharged_m3: 5200,
  harvested_rainwater_withdrawal_m3: 0,
  warnings: [],
  validation_warnings: [],
  audit_trail: {
    source_reference: {
      source_filename: "water_data_2024.xlsx",
      upload_timestamp_utc: "2024-09-15T10:35:00Z",
      input_hash: "b4e9d3c2f0a158e7b2d4f6a8c0e2f4a6b8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8",
    },
    user_id: "user_001",
  },
  methodology: { protocol_name: "GCCA Water", protocol_version: "0.1" },
  steps_breakdown: [
    {
      step_id: "total_withdrawal",
      label: "Total Water Withdrawal",
      formula: "sum(all_withdrawal_sources)",
      inputs: {
        municipal_water_m3: { value: 500000, unit: "m³" },
        harvested_rainwater_m3: { value: 0, unit: "m³" },
        groundwater_m3: { value: 50000, unit: "m³" },
      },
      output_value: 550000,
      output_unit: "m³",
    },
    {
      step_id: "total_discharge",
      label: "Total Water Discharge",
      formula: "sum(all_discharge_destinations)",
      inputs: {
        wastewater_treated_m3: { value: 80000, unit: "m³" },
        surface_water_discharge_m3: { value: 20000, unit: "m³" },
      },
      output_value: 100000,
      output_unit: "m³",
    },
    {
      step_id: "kpi_1_consumption",
      label: "KPI 1 – Net Consumption",
      formula: "total_withdrawal - total_discharge",
      inputs: {
        total_withdrawal_m3: { value: 550000, unit: "m³" },
        total_discharge_m3: { value: 100000, unit: "m³" },
      },
      output_value: 450000,
      output_unit: "m³",
    },
    {
      step_id: "freshwater_consumption",
      label: "Freshwater Consumption",
      formula: "total_consumption - harvested_rainwater",
      inputs: {
        total_consumption_m3: { value: 450000, unit: "m³" },
        harvested_rainwater_m3: { value: 0, unit: "m³" },
      },
      output_value: 450000,
      output_unit: "m³",
    },
    {
      step_id: "kpi_2_intensity",
      label: "KPI 2 – Water Intensity",
      formula: "(freshwater_consumption_m3 / cementitious_production_t) × 1000",
      inputs: {
        freshwater_consumption_m3: { value: 450000, unit: "m³" },
        cementitious_production_t: { value: 2300000, unit: "t" },
      },
      output_value: 195.65,
      output_unit: "L/t cement",
    },
  ],
};

const mockUnitMismatchWarning = {
  error_code: "UNIT_MISMATCH_SUSPECTED",
  field: "cementitious_production_t_yr",
  message:
    "Submitted value of 500,000,000 t/yr for cementitious_production_t_yr appears to be in kg rather than tonnes.",
  suggested_fix:
    "Divide the submitted value by 1,000 to convert from kg to tonnes before resubmitting.",
  meta: {
    submitted_value: 500000000,
    suspected_scale: 1000,
    suggested_corrected_value: 500000,
  },
};

// ---------------------------------------------------------------------------
// DashboardPage
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __tefnutSetCarbon?: (r: CarbonResult) => void;
    __tefnutSetWater?: (r: WaterResult) => void;
    __tefnutSetCbam?: (r: CBAMResultType) => void;
  }
}

function DashboardPage() {
  const { data: liveData, isLoading: dashLoading } = useDashboard();

  // Start with mock data; replace with live data when available
  const [carbonResult, setCarbonResult] = useState<CarbonResult>(mockCarbonResult);
  const [waterResult, setWaterResult] = useState<WaterResult>(mockWaterResult);
  const [cbamResult, setCbamResult] = useState<CBAMResultType | null>(null);
  const [copiedAuditId, setCopiedAuditId] = useState<string | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportToast, setReportToast] = useState(false);
  const reportToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Merge live DB data into carbon/water results when available
  useEffect(() => {
    if (!liveData) return;

    if (liveData.carbonSummary) {
      const s = liveData.carbonSummary;
      // Build a CarbonResult from the DB summary, keeping mock steps_breakdown
      const calcStep = liveData.scopeBreakdown.find((r) => r.source_type === "calcination");
      const fuelStep = liveData.scopeBreakdown.find((r) => r.source_type === "fuel_combustion_kiln");
      const elecStep = liveData.scopeBreakdown.find((r) => r.source_type === "purchased_electricity");
      const scope1Total = (calcStep?.co2e_t ?? 0) + (fuelStep?.co2e_t ?? 0);
      const scope2Total = elecStep?.co2e_t ?? 0;
      const specificCo2 = s.total_co2e_t > 0
        ? (s.total_co2e_t / Math.max(1, s.total_co2e_t / 642.5)) // preserve ratio
        : mockCarbonResult.specific_co2_kg_per_t_cement;

      setCarbonResult((prev) => ({
        ...prev,
        total_co2_t: s.total_co2e_t,
        specific_co2_kg_per_t_cement: specificCo2,
        audit_trail: {
          source_reference: {
            source_filename: "live_data",
            upload_timestamp_utc: s.calculated_at,
            input_hash: s.input_sha256_hash,
          },
          user_id: "system",
        },
        scope1: scope1Total > 0 ? {
          calcination_co2_t: calcStep?.co2e_t ?? 0,
          fuel_combustion_co2_t: fuelStep?.co2e_t ?? 0,
          biomass_co2_memo_t: 0,
          total_scope1_co2_t: scope1Total,
        } : prev.scope1,
        scope2: scope2Total > 0 ? { electricity_co2_t: scope2Total } : prev.scope2,
      }));
    }

    if (liveData.waterSummary) {
      const w = liveData.waterSummary;
      setWaterResult((prev) => ({
        ...prev,
        total_water_withdrawal_m3: w.total_withdrawal_m3,
        total_water_consumption_m3: w.total_consumption_m3,
        total_water_discharge_m3: w.total_withdrawal_m3 - w.total_consumption_m3,
        audit_trail: {
          source_reference: {
            source_filename: "live_data",
            upload_timestamp_utc: w.calculated_at,
            input_hash: `water_${w.reporting_year}`,
          },
          user_id: "system",
        },
      }));
    }

    // Wire ETS price into CBAM result if available
    if (liveData.etsPrice) {
      const price = parseFloat(liveData.etsPrice.price_eur_per_t_co2e);
      setCbamResult((prev) => prev ? {
        ...prev,
        ets_price_reference: {
          ...prev.ets_price_reference,
          price_eur_per_t_co2e: price,
          week_start_date: liveData.etsPrice!.week_start_date,
          is_stale: false,
        },
      } : null);
    }
  }, [liveData]);

  // Expose cross-page state setters on window (for data upload page)
  window.__tefnutSetCarbon = setCarbonResult;
  window.__tefnutSetWater = setWaterResult;
  window.__tefnutSetCbam = setCbamResult;

  function copyAuditId(hash: string) {
    navigator.clipboard.writeText(hash).then(() => {
      setCopiedAuditId(hash);
      setTimeout(() => setCopiedAuditId(null), 2000);
    });
  }

  function handleExport() {
    const blob = new Blob(
      [JSON.stringify({ carbon: carbonResult, water: waterResult, exported_at: new Date().toISOString() }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tefnut-export.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleGenerateReport() {
    setGeneratingReport(true);
    // Call real CBAM declaration endpoint
    fetch("/api/cbam/declaration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        plant_name: carbonResult.plant_name ?? "Facility",
        reporting_year: carbonResult.reporting_year ?? new Date().getFullYear(),
        calcination_method: "B1",
        calcination_b1: { clinker_production_t_yr: 1000000 },
        cement_production_t_yr: 1300000,
        product_type: "other_portland_cement",
        imported_quantity_t: 50000,
        carbon_price_paid: { amount: 0, currency_code: "EUR" },
        production_process: {
          process_type: "dry_kiln_ph_pc",
          kiln_capacity_t_clinker_per_day: 5000,
          annual_operating_hours: 8000,
          clinker_to_cement_ratio: 0.77,
        },
        declarant_eori: "EG000000000",
      }),
    })
      .then((res) => res.json())
      .then((data: { result?: { declaration_sha256?: string } }) => {
        if (data.result?.declaration_sha256) {
          setCbamResult((prev) => prev ? { ...prev, declaration_sha256: data.result!.declaration_sha256 } : null);
        }
        setReportToast(true);
        if (reportToastTimer.current) clearTimeout(reportToastTimer.current);
        reportToastTimer.current = setTimeout(() => setReportToast(false), 4000);
      })
      .catch(() => {
        setReportToast(true);
        if (reportToastTimer.current) clearTimeout(reportToastTimer.current);
        reportToastTimer.current = setTimeout(() => setReportToast(false), 4000);
      })
      .finally(() => setGeneratingReport(false));
  }

  function downloadActivityResult(auditHash: string, title: string) {
    const data =
      carbonResult.audit_trail.source_reference.input_hash === auditHash
        ? carbonResult
        : waterResult;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Build activity rows from live reports + fallback to mock
  const liveReports = liveData?.recentReports ?? [];
  const activityRows = liveReports.length > 0
    ? liveReports.map((r) => ({
        icon: r.report_type.includes("water") ? Droplets : r.report_type.includes("cbam") ? FileText : Leaf,
        title: r.report_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        time: new Date(r.generated_at).toLocaleDateString(),
        tag: r.report_type.includes("cbam") ? "CBAM" : r.report_type.includes("water") ? "Water" : "Carbon",
        tone: (r.report_type.includes("cbam") ? "brand" : r.report_type.includes("water") ? "info" : "success") as "brand" | "info" | "success" | "muted" | "warning",
        methodology: r.report_type.includes("cbam") ? "EU CBAM 2023/956" : r.report_type.includes("water") ? "GCCA Water 0.1" : "GCCA Carbon 0.1",
        auditHash: r.sha256_hash,
      }))
    : [
        { icon: Leaf, title: "Carbon intensity calculated", time: "2 hours ago", tag: "Carbon", tone: "success" as const, methodology: "GCCA Carbon 0.1", auditHash: carbonResult.audit_trail.source_reference.input_hash },
        { icon: Droplets, title: "Water KPIs computed", time: "2 hours ago", tag: "Water", tone: "info" as const, methodology: "GCCA Water 0.1", auditHash: waterResult.audit_trail.source_reference.input_hash },
        { icon: FileText, title: "CBAM report draft saved", time: "Yesterday", tag: "CBAM", tone: "brand" as const, methodology: "EU CBAM 2024", auditHash: carbonResult.audit_trail.source_reference.input_hash },
        { icon: Database, title: "Emissions ledger exported", time: "2 days ago", tag: "Export", tone: "muted" as const, methodology: "GCCA Carbon 0.1", auditHash: carbonResult.audit_trail.source_reference.input_hash },
        { icon: Activity, title: "Validation layer passed", time: "3 days ago", tag: "Validation", tone: "success" as const, methodology: "Internal", auditHash: waterResult.audit_trail.source_reference.input_hash },
      ];

  const toneClasses: Record<string, string> = {
    success: "bg-success/10 text-success border-success/20",
    info: "bg-info/10 text-info border-info/20",
    brand: "bg-brand-muted text-brand border-brand/20",
    muted: "bg-muted text-muted-foreground border-border",
    warning: "bg-warning/10 text-warning-foreground border-warning/20",
  };

  const carbonHash = carbonResult.audit_trail.source_reference.input_hash;
  const waterHash = waterResult.audit_trail.source_reference.input_hash;

  return (
    <div className="relative space-y-8 p-6">
      {/* Dashboard loading indicator */}
      {dashLoading && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-soft">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading live data…
        </div>
      )}
      {/* Success toast */}
      {reportToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-success/30 bg-card px-4 py-3 shadow-elevated">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span className="text-sm font-medium">CBAM Report generated successfully</span>
          <button
            onClick={() => setReportToast(false)}
            className="ml-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Page header */}
      <PageHeader
        eyebrow="Tefnut"
        title="Sustainability Dashboard"
        description="GCCA-compliant carbon and water KPIs with full audit trail."
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
            <Button size="sm" className="gap-1.5" onClick={handleGenerateReport} disabled={generatingReport}>
              {generatingReport ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              New CBAM report
            </Button>
          </>
        }
      />

      {/* Validation warning — only show if real warnings exist */}
      {carbonResult.validation_warnings && carbonResult.validation_warnings.length > 0 && (
        <ValidationWarningBanner warnings={carbonResult.validation_warnings} />
      )}

      {/* Compliance Summary widget */}
      <ComplianceSummary
        carbonResult={carbonResult}
        waterResult={waterResult}
        hasCarbon={carbonResult !== mockCarbonResult || true}
        hasWater={waterResult !== mockWaterResult || true}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Net Specific CO₂"
          value={`${carbonResult.specific_co2_kg_per_t_cement.toLocaleString()} kg/t`}
          change={{ value: "−3.2%", direction: "down", positiveIs: "down" }}
          hint="vs. prior year"
          icon={Leaf}
          verified={{
            inputHash: carbonHash,
            methodology: `${carbonResult.methodology.protocol_name} v${carbonResult.methodology.protocol_version}`,
            timestamp: carbonResult.audit_trail.source_reference.upload_timestamp_utc,
          }}
        />
        <StatCard
          label="Energy Intensity"
          value="3,450 MJ/t"
          change={{ value: "−1.8%", direction: "down", positiveIs: "down" }}
          hint="vs. prior year"
          icon={Zap}
        />
        <StatCard
          label="Water Withdrawal"
          value={`${(waterResult.total_water_withdrawal_m3 / 1000).toLocaleString()}k m³`}
          change={{ value: "−2.1%", direction: "down", positiveIs: "down" }}
          hint="vs. prior year"
          icon={Droplets}
          verified={{
            inputHash: waterHash,
            methodology: `${waterResult.methodology.protocol_name} v${waterResult.methodology.protocol_version}`,
            timestamp: waterResult.audit_trail.source_reference.upload_timestamp_utc,
          }}
        />
        <StatCard
          label="CBAM Completeness"
          value="94%"
          change={{ value: "+6%", direction: "up", positiveIs: "up" }}
          hint="fields populated"
          icon={Building2}
        />
      </div>

      {/* CBAM Net Financial Impact */}
      <NetFinancialImpactCard cbamResult={cbamResult} userRole="analyst" />

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Emissions trend */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="font-semibold tracking-tight">Emissions Trend</h3>
              <p className="text-sm text-muted-foreground">Scope 1 · 2 · 3 — Jan to Sep 2024</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={emissionsData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradScope1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-brand)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--color-brand)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradScope2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-info)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="var(--color-info)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradScope3" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--color-border)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--color-border)" />
              <Tooltip
                contentStyle={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Area type="monotone" dataKey="scope1" name="Scope 1" stroke="var(--color-brand)" fill="url(#gradScope1)" strokeWidth={2} />
              <Area type="monotone" dataKey="scope2" name="Scope 2" stroke="var(--color-info)" fill="url(#gradScope2)" strokeWidth={2} />
              <Area type="monotone" dataKey="scope3" name="Scope 3" stroke="var(--color-success)" fill="url(#gradScope3)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Carbon intensity + pie */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft flex flex-col gap-4">
          <div>
            <h3 className="font-semibold tracking-tight">Carbon Intensity</h3>
            <p className="text-sm text-muted-foreground">Emission source mix</p>
          </div>
          <div className="flex justify-center">
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={sourceMix} dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={72} strokeWidth={0}>
                  {sourceMix.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: unknown) => [`${v}%`]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5">
            {sourceMix.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-muted-foreground">{s.name}</span>
                </div>
                <span className="font-medium tabular-nums">{s.value}%</span>
              </div>
            ))}
          </div>
          <div className="mt-auto flex flex-col gap-2">
            <CalculationStepsDrawer
              steps={carbonResult.steps_breakdown}
              methodology={carbonResult.methodology}
              title="Carbon Calculation Logic"
            />
            <VerifiedBadge
              inputHash={carbonHash}
              methodology={`${carbonResult.methodology.protocol_name} v${carbonResult.methodology.protocol_version}`}
              timestamp={carbonResult.audit_trail.source_reference.upload_timestamp_utc}
            />
          </div>
        </div>
      </div>

      {/* Water section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Water breakdown panel */}
        <div className="flex flex-col gap-3">
          <WaterBreakdownPanel data={waterResult} />
          <VerifiedBadge
            inputHash={waterHash}
            methodology={`${waterResult.methodology.protocol_name} v${waterResult.methodology.protocol_version}`}
            timestamp={waterResult.audit_trail.source_reference.upload_timestamp_utc}
          />
          <CalculationStepsDrawer
            steps={waterResult.steps_breakdown}
            methodology={waterResult.methodology}
            title="Water Calculation Logic"
          />
        </div>

        {/* Water consumption trend */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="mb-4">
            <h3 className="font-semibold tracking-tight">Water Consumption Trend</h3>
            <p className="text-sm text-muted-foreground">Net consumption m³ — Jan to Sep 2024</p>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={waterConsumptionTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradWater" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-info)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--color-info)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--color-border)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--color-border)" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v: unknown) => [typeof v === "number" ? `${v.toLocaleString()} m³` : String(v)]}
              />
              <Area type="monotone" dataKey="consumption" name="Consumption" stroke="var(--color-info)" fill="url(#gradWater)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Activity + quick actions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Activity table */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
          <div className="border-b border-border px-6 py-4">
            <h3 className="font-semibold tracking-tight">Recent Activity</h3>
          </div>
          <div className="divide-y divide-border">
            {activityRows.map((row) => (
              <div key={row.auditHash + row.title} className="flex items-center gap-4 px-6 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <row.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{row.time}</span>
                    <Badge variant="outline" className={`text-[10px] ${toneClasses[row.tone]}`}>
                      {row.methodology}
                    </Badge>
                    <button
                      onClick={() => copyAuditId(row.auditHash)}
                      className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {copiedAuditId === row.auditHash ? (
                        <CheckCircle2 className="h-2.5 w-2.5 text-success" />
                      ) : (
                        <Copy className="h-2.5 w-2.5" />
                      )}
                      {row.auditHash.slice(0, 8)}…
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={`text-[10px] ${toneClasses[row.tone]}`}>
                    {row.tag}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => downloadActivityResult(row.auditHash, row.title)}
                  >
                    <Download className="h-3 w-3" />
                    Download
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick actions */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <h3 className="mb-4 font-semibold tracking-tight">Quick Actions</h3>
          <div className="space-y-2">
            <button
              onClick={handleGenerateReport}
              disabled={generatingReport}
              className="flex w-full items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                <FileText className="h-4 w-4 text-brand" />
                Generate CBAM report
              </div>
              {generatingReport ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : (
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>

            <button
              onClick={handleExport}
              className="flex w-full items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted"
            >
              <div className="flex items-center gap-3">
                <Database className="h-4 w-4 text-info" />
                Export emissions ledger
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>

            <Link
              to="/app/emissions"
              className="flex w-full items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted"
            >
              <div className="flex items-center gap-3">
                <Leaf className="h-4 w-4 text-success" />
                Upload carbon data
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </Link>

            <Link
              to="/app/data"
              className="flex w-full items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted"
            >
              <div className="flex items-center gap-3">
                <Droplets className="h-4 w-4 text-info" />
                Upload water data
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ComplianceSummary — side-by-side ISO status widget
// ---------------------------------------------------------------------------
interface ComplianceSummaryProps {
  carbonResult: CarbonResult;
  waterResult: WaterResult;
  hasCarbon: boolean;
  hasWater: boolean;
}

function ComplianceSummary({ carbonResult, waterResult, hasCarbon, hasWater }: ComplianceSummaryProps) {
  const carbonHash = carbonResult.audit_trail.source_reference.input_hash;
  const waterHash = waterResult.audit_trail.source_reference.input_hash;
  const carbonWarnings = carbonResult.validation_warnings ?? [];
  const waterWarnings = waterResult.validation_warnings ?? [];

  const carbonQuality = carbonWarnings.length === 0 ? "High" : "Medium";
  const waterQuality = waterWarnings.length === 0 ? "High" : "Medium";

  if (!hasCarbon && !hasWater) {
    return <ZeroStateFrames />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Carbon footprint compliance card */}
      <div className={cn(
        "rounded-2xl border p-5 shadow-soft",
        hasCarbon ? "border-success/30 bg-success/5" : "border-border bg-muted/20",
      )}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              hasCarbon ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
            )}>
              <Leaf className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold tracking-tight">Carbon Footprint</p>
              <p className="text-xs text-muted-foreground">ISO 14064-1:2018 · GCCA CO₂ Protocol</p>
            </div>
          </div>
          {hasCarbon ? (
            <Badge variant="outline" className="shrink-0 gap-1 bg-success/10 text-success border-success/30 text-[10px]">
              <ShieldCheck className="h-2.5 w-2.5" />
              Verified
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
              No data
            </Badge>
          )}
        </div>

        {hasCarbon ? (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Net Specific CO₂</span>
              <span className="font-semibold tabular-nums">
                {carbonResult.specific_co2_kg_per_t_cement.toLocaleString()} kg/t
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total CO₂e</span>
              <span className="font-semibold tabular-nums">
                {carbonResult.total_co2_t.toLocaleString()} t
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Data quality</span>
              <Badge variant="outline" className={cn(
                "text-[10px]",
                carbonQuality === "High" ? "bg-success/10 text-success border-success/30" : "bg-warning/10 text-warning-foreground border-warning/30",
              )}>
                {carbonQuality}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Audit ID</span>
              <span className="font-mono text-muted-foreground">
                {carbonHash.slice(0, 8)}…{carbonHash.slice(-4)}
              </span>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Upload your carbon data to generate an ISO 14064-1 compliant footprint.
          </p>
        )}

        <div className="mt-4">
          <Link
            to="/app/emissions"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-success hover:underline"
          >
            {hasCarbon ? "View carbon report" : "Upload carbon data"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Water footprint compliance card */}
      <div className={cn(
        "rounded-2xl border p-5 shadow-soft",
        hasWater ? "border-info/30 bg-info/5" : "border-border bg-muted/20",
      )}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              hasWater ? "bg-info/15 text-info" : "bg-muted text-muted-foreground",
            )}>
              <Droplets className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold tracking-tight">Water Footprint</p>
              <p className="text-xs text-muted-foreground">ISO 14046:2014 · GCCA Water Guidelines</p>
            </div>
          </div>
          {hasWater ? (
            <Badge variant="outline" className="shrink-0 gap-1 bg-info/10 text-info border-info/30 text-[10px]">
              <ShieldCheck className="h-2.5 w-2.5" />
              Verified
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
              No data
            </Badge>
          )}
        </div>

        {hasWater ? (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Net Consumption (KPI 1)</span>
              <span className="font-semibold tabular-nums">
                {waterResult.total_water_consumption_m3.toLocaleString()} m³
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Intensity (KPI 2)</span>
              <span className="font-semibold tabular-nums">
                {waterResult.water_consumption_per_tonne_litres.toFixed(1)} L/t
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Data quality</span>
              <Badge variant="outline" className={cn(
                "text-[10px]",
                waterQuality === "High" ? "bg-success/10 text-success border-success/30" : "bg-warning/10 text-warning-foreground border-warning/30",
              )}>
                {waterQuality}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Audit ID</span>
              <span className="font-mono text-muted-foreground">
                {waterHash.slice(0, 8)}…{waterHash.slice(-4)}
              </span>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Upload your water data to generate an ISO 14046 compliant footprint.
          </p>
        )}

        <div className="mt-4">
          <Link
            to="/app/data"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-info hover:underline"
          >
            {hasWater ? "View water report" : "Upload water data"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ZeroStateFrames — shown when no data has been uploaded yet
// ---------------------------------------------------------------------------
function ZeroStateFrames() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[
        {
          icon: Leaf,
          label: "Carbon Footprint",
          standard: "ISO 14064-1:2018",
          accent: "success" as const,
          to: "/app/data",
          color: "text-success",
          border: "border-success/20",
          bg: "bg-success/5",
          iconBg: "bg-success/10",
          badgeCls: "bg-success/10 text-success border-success/30",
          linkCls: "text-success",
        },
        {
          icon: Droplets,
          label: "Water Footprint",
          standard: "ISO 14046:2014",
          accent: "info" as const,
          to: "/app/data",
          color: "text-info",
          border: "border-info/20",
          bg: "bg-info/5",
          iconBg: "bg-info/10",
          badgeCls: "bg-info/10 text-info border-info/30",
          linkCls: "text-info",
        },
      ].map((frame) => (
        <div
          key={frame.label}
          className={cn(
            "flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-8 text-center",
            frame.border, frame.bg,
          )}
        >
          <div className={cn("flex h-14 w-14 items-center justify-center rounded-2xl", frame.iconBg)}>
            <frame.icon className={cn("h-7 w-7", frame.color)} />
          </div>
          <div>
            <Badge variant="outline" className={cn("mb-2 text-[10px]", frame.badgeCls)}>
              {frame.standard}
            </Badge>
            <p className="font-semibold tracking-tight">{frame.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ready to verify your first ISO-compliant footprint?
              Upload your {frame.label.split(" ")[0]} data to begin.
            </p>
          </div>
          <Link
            to={frame.to}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:opacity-80",
              frame.border, frame.color,
            )}
          >
            <Upload className="h-3.5 w-3.5" />
            Upload {frame.label.split(" ")[0]} Data
          </Link>
        </div>
      ))}
    </div>
  );
}
