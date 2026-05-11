"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchTenKSections, fetchTenKAnalysis, TenKFiling, TenKSection } from "@/lib/api-client";
import { MarkdownDisplay } from "@/components/markdown-display";
import { FilingEmbed } from "@/components/filing-embed";
import { cn } from "@/lib/utils";

interface FilingsTenKProps {
  ticker: string;
}

interface SectionState {
  summary: string;
  loading: boolean;
  error: string | null;
}

const emptyState: SectionState = { summary: "", loading: false, error: null };

export function FilingsTenK({ ticker }: FilingsTenKProps) {
  const [filing, setFiling] = useState<TenKFiling | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>("");
  const [viewMode, setViewMode] = useState<"sections" | "full">("full");
  // Per-section LLM summary state
  const [summaries, setSummaries] = useState<Record<string, SectionState>>({});

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSummaries({});
    setActiveSection("");

    fetchTenKSections(ticker)
      .then((res) => {
        if (cancelled) return;
        setFiling(res);
        if (res.sections.length > 0) {
          setActiveSection(res.sections[0].section);
        }
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setError("Failed to load 10-K filing");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const currentSection: TenKSection | null = useMemo(() => {
    if (!filing) return null;
    return filing.sections.find((s) => s.section === activeSection) || filing.sections[0] || null;
  }, [filing, activeSection]);

  const summarize = async () => {
    if (!filing || !currentSection) return;
    const key = currentSection.section;
    setSummaries((prev) => ({ ...prev, [key]: { summary: "", loading: true, error: null } }));
    const res = await fetchTenKAnalysis({
      ticker,
      section: currentSection.section,
      section_title: currentSection.title,
      text: currentSection.text,
      period_end: filing.period_end,
    });
    if (res.summary) {
      setSummaries((prev) => ({ ...prev, [key]: { summary: res.summary!, loading: false, error: null } }));
    } else {
      setSummaries((prev) => ({
        ...prev,
        [key]: { summary: "", loading: false, error: res.error || "Failed to summarize" },
      }));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-500" />
      </div>
    );
  }
  if (error) return <div className="text-center p-8 text-red-400">{error}</div>;
  if (!filing || filing.sections.length === 0) {
    return <div className="text-center p-8 text-slate-400">No 10-K filing available for {ticker}</div>;
  }

  const summaryState = currentSection ? summaries[currentSection.section] || emptyState : emptyState;

  return (
    <div className="space-y-4">
      {/* Filing header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-900/40 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div>
            <span className="text-slate-500 text-xs">Period ending </span>
            <span className="text-slate-200">{filing.period_end || "—"}</span>
          </div>
          <div>
            <span className="text-slate-500 text-xs">Filed </span>
            <span className="text-slate-200">{filing.filing_date || "—"}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* View-mode toggle */}
          <div className="inline-flex rounded-md border border-white/10 overflow-hidden">
            <button
              onClick={() => setViewMode("sections")}
              className={cn(
                "px-3 py-1 text-xs transition-colors",
                viewMode === "sections"
                  ? "bg-orange-500/20 text-orange-300"
                  : "bg-slate-900 text-slate-400 hover:text-white"
              )}
            >
              Sections
            </button>
            <button
              onClick={() => setViewMode("full")}
              className={cn(
                "px-3 py-1 text-xs transition-colors border-l border-white/10",
                viewMode === "full"
                  ? "bg-orange-500/20 text-orange-300"
                  : "bg-slate-900 text-slate-400 hover:text-white"
              )}
            >
              Full Filing
            </button>
          </div>
        </div>
      </div>

      {/* Full filing embed */}
      {viewMode === "full" && (
        <div className="rounded-lg border border-white/10 overflow-hidden h-[85vh]">
          <FilingEmbed
            cik={filing.cik}
            accession={filing.accession_number}
            fallbackUrl={filing.filing_url}
            title={`${ticker} 10-K — ${filing.period_end}`}
            className="h-full"
          />
        </div>
      )}

      {/* Section selector */}
      {viewMode === "sections" && (
      <div className="flex flex-wrap gap-2">
        {filing.sections.map((s) => (
          <button
            key={s.section}
            onClick={() => setActiveSection(s.section)}
            className={cn(
              "px-3 py-1.5 text-xs rounded-md border transition-colors",
              activeSection === s.section
                ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
                : "bg-slate-900 text-slate-400 border-white/10 hover:text-white hover:border-white/20"
            )}
          >
            {s.title}
          </button>
        ))}
      </div>
      )}

      {/* Section panel */}
      {viewMode === "sections" && currentSection && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-medium text-white">{currentSection.title}</h3>
            <button
              onClick={summarize}
              disabled={summaryState.loading}
              className={cn(
                "px-3 py-1.5 text-xs rounded-md border transition-colors",
                "bg-gradient-to-r from-orange-900/30 to-amber-900/30 border-orange-500/30 text-orange-300",
                "hover:from-orange-900/50 hover:to-amber-900/50 hover:border-orange-500/50",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {summaryState.loading
                ? "✨ Summarizing…"
                : summaryState.summary
                ? "✨ Re-summarize"
                : "✨ Summarize with AI"}
            </button>
          </div>

          {/* AI summary panel */}
          {(summaryState.loading || summaryState.summary || summaryState.error) && (
            <div className="p-4 bg-gradient-to-r from-orange-900/30 to-amber-900/30 rounded-lg border border-orange-500/20">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-orange-400 text-lg">✨</span>
                <span className="text-sm font-medium text-orange-300">
                  AI summary — {currentSection.title}
                </span>
              </div>
              {summaryState.loading ? (
                <p className="text-sm text-gray-400 italic flex items-center gap-2">
                  <span className="animate-spin">⏳</span> Reading {Math.round(currentSection.text.length / 1000)}k chars of {currentSection.title.toLowerCase()}…
                </p>
              ) : summaryState.error ? (
                <p className="text-sm text-red-300">{summaryState.error}</p>
              ) : (
                <MarkdownDisplay content={summaryState.summary} className="text-sm text-gray-300" />
              )}
            </div>
          )}

          {/* Raw section text */}
          <div className="rounded-lg border border-white/10 bg-slate-900/30">
            <div className="max-h-[60vh] overflow-y-auto p-4">
              <pre className="whitespace-pre-wrap text-sm text-slate-300 leading-relaxed font-sans">
                {currentSection.text}
              </pre>
            </div>
            <div className="border-t border-white/5 px-4 py-2 text-[10px] text-slate-500">
              {currentSection.text.length.toLocaleString()} characters · scroll inside this panel
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
