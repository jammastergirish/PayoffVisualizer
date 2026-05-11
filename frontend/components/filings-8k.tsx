"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchEightKFilings,
  fetchEightKAnalysis,
  Filing8k,
  Filing8kCategory,
} from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MarkdownDisplay } from "@/components/markdown-display";
import { cn } from "@/lib/utils";

const CATEGORY_CLASSES: Record<Filing8kCategory, string> = {
  earnings: "bg-green-500/20 text-green-300 border-green-500/40",
  m_and_a: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  leadership: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  agreement: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  distress: "bg-red-500/20 text-red-300 border-red-500/40",
  securities: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  governance: "bg-slate-600/30 text-slate-300 border-slate-500/40",
  regfd: "bg-slate-700/40 text-slate-400 border-slate-600/40",
  other: "bg-slate-700/40 text-slate-400 border-slate-600/40",
};

const CATEGORY_LABEL: Record<Filing8kCategory, string> = {
  earnings: "Earnings",
  m_and_a: "M&A",
  leadership: "Leadership",
  agreement: "Material Agreement",
  distress: "Distress",
  securities: "Securities",
  governance: "Governance",
  regfd: "Reg FD",
  other: "Other",
};

const MATERIAL_CATEGORIES: Filing8kCategory[] = [
  "earnings",
  "m_and_a",
  "leadership",
  "agreement",
  "distress",
  "securities",
];

const PREVIEW_LENGTH = 240;
const FILING_TIMEOUT_MS = 30000;

interface FilingsEightKProps {
  ticker: string;
}

export function FilingsEightK({ ticker }: FilingsEightKProps) {
  const [filings, setFilings] = useState<Filing8k[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "material">("material");
  const [openFiling, setOpenFiling] = useState<Filing8k | null>(null);

  const [analysis, setAnalysis] = useState<string>("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisPrompt, setAnalysisPrompt] = useState<string>("");
  const [viewingPrompt, setViewingPrompt] = useState(false);
  const lastAnalysisFingerprint = useRef<string>("");

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAnalysis("");
    lastAnalysisFingerprint.current = "";

    fetchEightKFilings(ticker, 25)
      .then((res) => {
        if (!cancelled) setFilings(res.filings || []);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setError("Failed to load 8-K filings");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  // Mirror the news tab: kick off LLM analysis once filings load
  useEffect(() => {
    if (!ticker || filings.length === 0) return;
    const top = filings.slice(0, 10);
    const fingerprint = `${ticker}:${top.map((f) => f.accession_number).join("|")}`;
    if (fingerprint === lastAnalysisFingerprint.current) return;
    lastAnalysisFingerprint.current = fingerprint;

    let cancelled = false;
    setAnalysis("");
    setAnalysisLoading(true);

    const payload = top.map((f) => ({
      filing_date: f.filing_date,
      items: f.items.map((i) => ({ code: i.code, title: i.title })),
      items_text: f.items_text,
    }));

    // Mirror the server-side prompt so the user can see what's being sent.
    const filingsStr = top
      .map((f, i) => {
        const itemStr =
          f.items.map((it) => `Item ${it.code} (${it.title})`).join(", ") || "Unspecified";
        const body = (f.items_text || "").trim();
        const truncated = body.length > 1500 ? body.slice(0, 1500) + "…" : body;
        return `${i + 1}. ${f.filing_date} — ${itemStr}\n${truncated}`;
      })
      .join("\n\n");
    const displayPrompt = `[system]\nYou are Matt Levine providing brief, actionable insights on how SEC 8-K disclosures affect individual stocks. Be witty, direct, and call out which items are mundane Reg FD vs genuinely material.\n\n[user]\nBased on these recent 8-K filings for ${ticker.toUpperCase()}, what's the material signal and likely price impact? Highlight earnings, M&A, leadership changes, and material agreements; downweight Reg FD housekeeping. Give a summary in 150 words—and brief advice.\n\nFilings:\n${filingsStr}`;
    setAnalysisPrompt(displayPrompt);

    const timer = setTimeout(() => {
      // belt-and-suspenders against a hung analysis (fetch already aborts at 30s)
    }, FILING_TIMEOUT_MS);

    fetchEightKAnalysis(payload, ticker)
      .then((res) => {
        if (cancelled) return;
        if (res.summary) setAnalysis(res.summary);
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        if (!cancelled) setAnalysisLoading(false);
        clearTimeout(timer);
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ticker, filings]);

  const visible = useMemo(() => {
    if (filter === "all") return filings;
    return filings.filter((f) =>
      f.categories.some((c) => MATERIAL_CATEGORIES.includes(c))
    );
  }, [filings, filter]);

  const counts = useMemo(() => {
    const all = filings.length;
    const material = filings.filter((f) =>
      f.categories.some((c) => MATERIAL_CATEGORIES.includes(c))
    ).length;
    return { all, material };
  }, [filings]);

  const preview = (text: string | null) => {
    if (!text) return "";
    const trimmed = text.trim();
    if (trimmed.length <= PREVIEW_LENGTH) return trimmed;
    return trimmed.slice(0, PREVIEW_LENGTH) + "…";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-500" />
      </div>
    );
  }
  if (error) return <div className="text-center p-8 text-red-400">{error}</div>;
  if (filings.length === 0) {
    return <div className="text-center p-8 text-slate-400">No 8-K filings available for {ticker}</div>;
  }

  return (
    <div className="space-y-4">
      {/* AI Analysis banner — mirrors the News tab */}
      {(analysisLoading || analysis) && (
        <div className="p-4 bg-gradient-to-r from-orange-900/30 to-amber-900/30 rounded-lg border border-orange-500/20">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-orange-400 text-lg">✨</span>
              <span className="text-sm font-medium text-orange-300">8-K Analysis</span>
            </div>
            {analysisPrompt && !analysisLoading && (
              <button
                onClick={() => setViewingPrompt(true)}
                className="text-xs text-orange-400/70 hover:text-orange-300 underline"
              >
                View prompt
              </button>
            )}
          </div>
          {analysisLoading ? (
            <p className="text-sm text-gray-400 italic flex items-center gap-2">
              <span className="animate-spin">⏳</span> Analyzing recent filings for {ticker}...
            </p>
          ) : (
            <MarkdownDisplay content={analysis} className="text-sm text-gray-300" />
          )}
        </div>
      )}

      {/* Filter chips */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter("material")}
          className={cn(
            "px-3 py-1 text-xs rounded-md border transition-colors",
            filter === "material"
              ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
              : "bg-slate-900 text-slate-400 border-white/10 hover:text-white hover:border-white/20"
          )}
        >
          Material ({counts.material})
        </button>
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "px-3 py-1 text-xs rounded-md border transition-colors",
            filter === "all"
              ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
              : "bg-slate-900 text-slate-400 border-white/10 hover:text-white hover:border-white/20"
          )}
        >
          All ({counts.all})
        </button>
      </div>

      {/* Filings cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visible.map((f) => {
          const isAmend = f.form_type === "8-K/A";
          const hasMaterial = f.categories.some((c) => MATERIAL_CATEGORIES.includes(c));
          return (
            <div
              key={f.accession_number}
              onClick={() => setOpenFiling(f)}
              className={cn(
                "bg-slate-800/50 rounded-lg border border-white/5 hover:border-orange-500/40 overflow-hidden cursor-pointer group transition-all duration-200 hover:bg-slate-800/80",
                !hasMaterial && "opacity-70"
              )}
            >
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {f.filing_url ? (
                      <a
                        href={f.filing_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-slate-300 hover:text-orange-300 hover:underline"
                      >
                        {f.filing_date}
                      </a>
                    ) : (
                      <span className="text-xs text-slate-300">{f.filing_date}</span>
                    )}
                    {isAmend && (
                      <Badge
                        variant="outline"
                        className="bg-slate-700/40 text-slate-300 border-slate-600/40 text-[10px]"
                      >
                        Amend
                      </Badge>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">{f.form_type}</span>
                </div>

                {f.items.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {f.items.map((it) => (
                      <Badge
                        key={it.code}
                        variant="outline"
                        className={cn("text-[10px]", CATEGORY_CLASSES[it.category])}
                      >
                        {it.code} · {it.title}
                      </Badge>
                    ))}
                  </div>
                )}

                <p className="text-sm text-slate-400 leading-snug whitespace-pre-line line-clamp-4">
                  {preview(f.items_text)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Prompt viewer modal */}
      <Dialog open={viewingPrompt} onOpenChange={(open) => !open && setViewingPrompt(false)}>
        <DialogContent className="max-w-3xl w-[92vw] h-[65vh] max-h-[65vh] overflow-hidden flex flex-col bg-slate-950 border-white/10 text-white">
          <DialogHeader className="flex-shrink-0 border-b border-white/10 pb-4">
            <DialogTitle className="text-lg font-medium text-white">8-K Analysis Prompt</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto py-4 px-1">
            <pre className="whitespace-pre-wrap text-xs text-slate-300 leading-relaxed font-mono">
              {analysisPrompt}
            </pre>
          </div>
        </DialogContent>
      </Dialog>

      {/* Full text modal */}
      <Dialog open={openFiling !== null} onOpenChange={(open) => !open && setOpenFiling(null)}>
        <DialogContent className="max-w-3xl w-[92vw] h-[65vh] max-h-[65vh] overflow-hidden flex flex-col bg-slate-950 border-white/10 text-white">
          <DialogHeader className="flex-shrink-0 border-b border-white/10 pb-4">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono px-2 py-1 rounded bg-orange-500/20 text-orange-400 uppercase">
                {openFiling?.form_type || "8-K"}
              </span>
              <span className="text-xs text-slate-400">{openFiling?.filing_date}</span>
              {openFiling?.filing_url && (
                <a
                  href={openFiling.filing_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-orange-400 hover:text-orange-300 hover:underline ml-2"
                >
                  View on SEC →
                </a>
              )}
            </div>
            <DialogTitle className="text-lg font-medium text-white leading-tight pr-8">
              {openFiling?.items.map((i) => i.title).join(" · ") || "Form 8-K"}
            </DialogTitle>
            {openFiling && openFiling.items.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {openFiling.items.map((it) => (
                  <Badge
                    key={it.code}
                    variant="outline"
                    className={cn("text-[10px]", CATEGORY_CLASSES[it.category])}
                  >
                    {it.code} · {CATEGORY_LABEL[it.category]}
                  </Badge>
                ))}
              </div>
            )}
          </DialogHeader>
          <div className="flex-1 overflow-y-auto py-4 px-1">
            <pre className="whitespace-pre-wrap text-sm text-slate-300 leading-relaxed font-sans">
              {openFiling?.items_text || "No text available"}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
