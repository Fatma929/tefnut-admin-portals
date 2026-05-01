/**
 * useDashboard — fetches live summary data from /api/dashboard
 * Falls back to null values when DB is not connected (dev mode).
 */
import { useEffect, useState } from "react";

export interface DashboardSummary {
  carbonSummary: {
    total_co2e_t: number;
    reporting_year: number;
    input_sha256_hash: string;
    calculated_at: string;
    methodology_tag: string;
  } | null;
  scopeBreakdown: Array<{
    iso_category: number;
    source_type: string;
    co2e_t: number;
  }>;
  waterSummary: {
    total_withdrawal_m3: number;
    total_consumption_m3: number;
    reporting_year: number;
    calculated_at: string;
  } | null;
  recentReports: Array<{
    id: string;
    report_type: string;
    reporting_year: number;
    status: string;
    generated_at: string;
    sha256_hash: string;
  }>;
  etsPrice: {
    price_eur_per_t_co2e: string;
    week_start_date: string;
  } | null;
  _source?: string;
}

export function useDashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard", { credentials: "include" });
      if (res.status === 401) {
        window.location.replace("/auth/login");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as DashboardSummary;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return { data, isLoading, error, reload: load };
}
