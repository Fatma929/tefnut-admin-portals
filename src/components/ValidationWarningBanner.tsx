/**
 * ValidationWarningBanner
 * Renders inline warning banners for engine validation_warnings[].
 * For UNIT_MISMATCH_SUSPECTED warnings with meta.suspected_scale,
 * it shows an "Auto-Correct" button that calls onAutoCorrect with the
 * suggested corrected value so the parent form can update the field.
 */
import { AlertTriangle, CheckCircle2, X, Zap } from "lucide-react";
import { useState } from "react";
import type { ValidationDetail } from "@/lib/engine-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  warnings: ValidationDetail[];
  /** Called when user accepts an auto-correct suggestion: (field, correctedValue) */
  onAutoCorrect?: (field: string, correctedValue: number) => void;
}

export function ValidationWarningBanner({ warnings, onAutoCorrect }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = warnings.filter((w) => !dismissed.has(w.field + w.error_code));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {visible.map((w) => {
        const isUnitMismatch = w.error_code === "UNIT_MISMATCH_SUSPECTED";
        const meta = w.meta as {
          suspected_scale?: number;
          submitted_value?: number;
          suggested_corrected_value?: number;
        };
        const hasSuggestion =
          isUnitMismatch &&
          meta.suspected_scale != null &&
          meta.suggested_corrected_value != null;

        const key = w.field + w.error_code;

        return (
          <div
            key={key}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-4 py-3",
              isUnitMismatch
                ? "border-warning/40 bg-warning/8"
                : "border-destructive/30 bg-destructive/8",
            )}
          >
            <AlertTriangle
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                isUnitMismatch ? "text-warning-foreground" : "text-destructive",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{w.message}</p>
              {hasSuggestion && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Did you mean{" "}
                  <strong>
                    {meta.suggested_corrected_value!.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </strong>{" "}
                  instead of{" "}
                  <strong>
                    {meta.submitted_value!.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </strong>
                  ? (÷ {meta.suspected_scale?.toLocaleString()})
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{w.suggested_fix}</p>
              {hasSuggestion && onAutoCorrect && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 gap-1.5 border-warning/40 text-warning-foreground hover:bg-warning/10"
                  onClick={() => {
                    onAutoCorrect(w.field, meta.suggested_corrected_value!);
                    setDismissed((prev) => new Set(prev).add(key));
                  }}
                >
                  <Zap className="h-3 w-3" />
                  Auto-Correct to{" "}
                  {meta.suggested_corrected_value!.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </Button>
              )}
            </div>
            <button
              onClick={() => setDismissed((prev) => new Set(prev).add(key))}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss warning"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Small inline success indicator shown when all warnings are resolved.
 */
export function ValidationClearBadge() {
  return (
    <div className="flex items-center gap-1.5 text-xs text-success">
      <CheckCircle2 className="h-3.5 w-3.5" />
      All validation checks passed
    </div>
  );
}
