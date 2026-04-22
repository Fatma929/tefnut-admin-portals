/**
 * CalculationStepsDrawer
 * Side drawer showing the engine's explainable_steps as a numbered stepper.
 * Each step is expandable to reveal its inputs and computed result.
 */
import { BookOpen, CheckCircle2, ChevronRight, FlaskConical } from "lucide-react";
import { useState } from "react";
import type { CalculationStep, MethodologyTag } from "@/lib/engine-types";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  steps: CalculationStep[];
  methodology: MethodologyTag;
  title?: string;
}

export function CalculationStepsDrawer({ steps, methodology, title = "Calculation Logic" }: Props) {
  const [expanded, setExpanded] = useState<string | null>(steps[0]?.step_id ?? null);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <BookOpen className="h-3.5 w-3.5" />
          View Calculation Logic
        </Button>
      </SheetTrigger>

      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-muted text-brand">
              <FlaskConical className="h-4 w-4" />
            </div>
            <div>
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription className="flex items-center gap-1.5 mt-0.5">
                <Badge variant="outline" className="text-[10px] bg-brand-muted text-brand border-brand/20">
                  {methodology.protocol_name} v{methodology.protocol_version}
                </Badge>
                <span className="text-xs text-muted-foreground">GCCA compliant</span>
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Stepper */}
        <div className="mt-5 space-y-0">
          {steps.map((step, idx) => {
            const isLast = idx === steps.length - 1;
            const isOpen = expanded === step.step_id;

            return (
              <div key={step.step_id} className="flex gap-3">
                {/* Left rail: number bubble + connector line */}
                <div className="flex flex-col items-center">
                  <button
                    onClick={() => setExpanded(isOpen ? null : step.step_id)}
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                      isOpen
                        ? "bg-brand text-brand-foreground"
                        : "bg-brand-muted text-brand hover:bg-brand hover:text-brand-foreground",
                    )}
                  >
                    {isOpen ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                  </button>
                  {!isLast && (
                    <div className="mt-1 w-px flex-1 bg-border" style={{ minHeight: 16 }} />
                  )}
                </div>

                {/* Right content */}
                <div className={cn("min-w-0 flex-1 pb-4", isLast && "pb-2")}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : step.step_id)}
                    className="flex w-full items-start justify-between gap-2 text-left"
                  >
                    <div className="min-w-0">
                      <p className={cn(
                        "text-sm font-medium transition-colors",
                        isOpen ? "text-brand" : "text-foreground",
                      )}>
                        {step.label}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {step.formula}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                      <span className="tabular-nums text-sm font-semibold text-foreground">
                        {step.output_value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                      <span className="text-xs text-muted-foreground">{step.output_unit}</span>
                      <ChevronRight className={cn(
                        "h-3.5 w-3.5 text-muted-foreground transition-transform",
                        isOpen && "rotate-90",
                      )} />
                    </div>
                  </button>

                  {isOpen && (
                    <div className="mt-3 rounded-xl border border-border bg-muted/30 overflow-hidden">
                      <div className="px-4 py-3">
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Inputs
                        </p>
                        <div className="space-y-2">
                          {Object.entries(step.inputs).map(([key, val]) => (
                            <div key={key} className="flex items-center justify-between text-xs">
                              <span className="font-mono text-muted-foreground">{key}</span>
                              <span className="font-semibold tabular-nums">
                                {val.value.toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
                                <span className="font-normal text-muted-foreground">{val.unit}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between border-t border-border bg-brand-muted px-4 py-2.5">
                        <span className="text-xs font-semibold text-brand">Result</span>
                        <span className="tabular-nums text-sm font-bold text-brand">
                          {step.output_value.toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
                          <span className="text-xs font-normal">{step.output_unit}</span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
