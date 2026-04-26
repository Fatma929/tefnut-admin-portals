/**
 * CBAMDeclarationButton
 *
 * Triggers POST /api/cbam/declaration with the current CBAMInput state.
 * On success: downloads cbam_declaration_{facilityName}_{reportingYear}.json
 * and displays the declaration_sha256 in a copyable monospace badge.
 */
import { CheckCircle2, Copy, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  cbamInput: Record<string, unknown> | null;
  facilityName: string;
  reportingYear: number;
}

export function CBAMDeclarationButton({ cbamInput, facilityName, reportingYear }: Props) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [declarationHash, setDeclarationHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!cbamInput) return;

    setIsGenerating(true);
    setError(null);
    setDeclarationHash(null);

    try {
      const response = await fetch("/api/cbam/declaration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cbamInput),
      });

      if (!response.ok) {
        const errBody = await response.json() as { error?: string };
        throw new Error(errBody.error ?? `Request failed with status ${response.status}`);
      }

      const data = await response.json() as {
        declaration: Record<string, unknown>;
        result: { declaration_sha256: string };
        report_id: string;
      };

      // Trigger browser download
      const blob = new Blob([JSON.stringify(data.declaration, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cbam_declaration_${facilityName}_${reportingYear}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setDeclarationHash(data.result.declaration_sha256 || data.report_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsGenerating(false);
    }
  }

  function handleCopyHash() {
    if (!declarationHash) return;
    navigator.clipboard.writeText(declarationHash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const shortHash = declarationHash
    ? declarationHash.slice(0, 8) + "…" + declarationHash.slice(-4)
    : null;

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={handleClick}
        disabled={isGenerating || !cbamInput}
        className="gap-2"
        variant="default"
      >
        {isGenerating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileText className="h-4 w-4" />
        )}
        CBAM Declaration
      </Button>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {declarationHash && (
        <button
          onClick={handleCopyHash}
          className={cn(
            "inline-flex items-center gap-1.5 self-start rounded border border-border bg-muted px-2 py-1 font-mono text-[11px] transition-colors hover:bg-muted/80",
            copied ? "text-success" : "text-muted-foreground",
          )}
          title="Click to copy declaration SHA-256"
        >
          {copied ? (
            <CheckCircle2 className="h-3 w-3 text-success" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          <Badge
            variant="outline"
            className="border-0 bg-transparent p-0 font-mono text-[11px] font-normal"
          >
            {shortHash}
          </Badge>
        </button>
      )}
    </div>
  );
}
