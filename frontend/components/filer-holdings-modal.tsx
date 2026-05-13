"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetch13FHoldings,
  fetchSecFilingFiles,
  FilingWithHoldings,
  FilingHolding,
  SecFilingFile,
} from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilingEmbed } from "@/components/filing-embed";
import { cn } from "@/lib/utils";

const fmtNum = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(n).toLocaleString();

const fmtMoney = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

/** Minimal shape needed to open the modal. BigInvestorHolder satisfies this. */
export interface FilerRef {
  accession_number: string | null;
  filer_cik: string;
  filer_name: string;
  filing_date: string | null;
}

export function FilerHoldingsModal({
  filer,
  onClose,
}: {
  filer: FilerRef | null;
  onClose: () => void;
}) {
  const [filing, setFiling] = useState<FilingWithHoldings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secOpen, setSecOpen] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!filer?.accession_number) {
      setFiling(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFilter("");
    fetch13FHoldings(filer.accession_number)
      .then((res) => {
        if (cancelled) return;
        if (res.error) setError(res.error);
        else setFiling(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load holdings");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filer?.accession_number]);

  const filtered: FilingHolding[] = useMemo(() => {
    const rows = filing?.holdings || [];
    if (!filter.trim()) return rows;
    const q = filter.trim().toLowerCase();
    return rows.filter(
      (h) =>
        (h.issuer_name || "").toLowerCase().includes(q) ||
        (h.cusip || "").toLowerCase().includes(q) ||
        (h.ticker || "").toLowerCase().includes(q)
    );
  }, [filing, filter]);

  return (
    <>
      <Dialog open={filer !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          style={{ maxWidth: "75vw", width: "75vw", height: "75vh", maxHeight: "75vh" }}
          className="overflow-hidden flex flex-col bg-slate-950 border-white/10 text-white"
        >
          <DialogHeader className="flex-shrink-0 border-b border-white/10 pb-4">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono px-2 py-1 rounded bg-purple-500/20 text-purple-400 uppercase">
                13F
              </span>
              <span className="text-xs text-slate-400">{filer?.filing_date}</span>
              <span className="text-xs text-slate-500 font-mono">CIK {filer?.filer_cik}</span>
              {filing?.period && (
                <span className="text-xs text-slate-500">Period {filing.period}</span>
              )}
            </div>
            <DialogTitle className="text-lg font-medium text-white leading-tight pr-8">
              {filer?.filer_name}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-hidden flex flex-col py-3">
            {/* Toolbar */}
            <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-3 px-1 pb-3 border-b border-white/5">
              <div className="text-sm text-slate-300">
                {loading ? (
                  "Loading holdings…"
                ) : error ? (
                  <span className="text-red-400">{error}</span>
                ) : (
                  <>
                    <span className="text-white font-medium">{filing?.holdings_count ?? 0}</span>{" "}
                    <span className="text-slate-500">positions ·</span>{" "}
                    <span className="text-white font-medium">
                      {fmtMoney(filing?.total_market_value)}
                    </span>{" "}
                    <span className="text-slate-500">total</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Filter by ticker, issuer, or CUSIP…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="px-2 py-1 text-xs rounded-md bg-slate-900 border border-white/10 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-orange-500/40"
                />
                <button
                  onClick={() => setSecOpen(true)}
                  className="px-3 py-1 text-xs rounded-md border border-orange-500/30 text-orange-300 bg-orange-500/10 hover:bg-orange-500/20"
                >
                  View SEC docs ↗
                </button>
              </div>
            </div>

            {/* Holdings table */}
            <div className="flex-1 min-h-0 overflow-y-auto px-1">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
                </div>
              ) : !filing || filtered.length === 0 ? (
                <div className="text-center p-8 text-slate-400">
                  {filter ? "No holdings match the filter." : "No holdings available."}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10 hover:bg-transparent sticky top-0 bg-slate-950 z-10">
                      <TableHead className="text-slate-400">Ticker</TableHead>
                      <TableHead className="text-slate-400">Issuer</TableHead>
                      <TableHead className="text-slate-400 font-mono">CUSIP</TableHead>
                      <TableHead className="text-slate-400 text-right">Market value</TableHead>
                      <TableHead className="text-slate-400 text-right">Shares</TableHead>
                      <TableHead className="text-slate-400">Type</TableHead>
                      <TableHead className="text-slate-400">Discretion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((h, idx) => (
                      <TableRow key={`${h.cusip}-${h.title_of_class}-${h.put_call}-${idx}`} className="border-white/5">
                        <TableCell className="font-mono text-orange-300 text-xs">{h.ticker || "—"}</TableCell>
                        <TableCell className="text-white">{h.issuer_name}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-400">{h.cusip}</TableCell>
                        <TableCell className="text-right text-slate-200">{fmtMoney(h.market_value)}</TableCell>
                        <TableCell className="text-right text-slate-200">{fmtNum(h.shares)}</TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {h.put_call ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                h.put_call === "PUT"
                                  ? "bg-red-500/20 text-red-300 border-red-500/40"
                                  : "bg-blue-500/20 text-blue-300 border-blue-500/40"
                              )}
                            >
                              {h.put_call}
                            </Badge>
                          ) : (
                            <span>{h.title_of_class || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {h.investment_discretion || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SecDocsSubModal
        open={secOpen}
        onClose={() => setSecOpen(false)}
        cik={filer?.filer_cik || null}
        accession={filer?.accession_number || null}
        title={`${filer?.filer_name || "13F"} — ${filer?.filing_date || ""}`}
      />
    </>
  );
}

// ---------- SEC docs sub-modal ----------

function SecDocsSubModal({
  open,
  onClose,
  cik,
  accession,
  title,
}: {
  open: boolean;
  onClose: () => void;
  cik: string | null;
  accession: string | null;
  title: string;
}) {
  const [files, setFiles] = useState<SecFilingFile[]>([]);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !cik || !accession) {
      setFiles([]);
      setActiveUrl(null);
      return;
    }
    let cancelled = false;
    fetchSecFilingFiles(cik, accession)
      .then((res) => {
        if (cancelled) return;
        const docs = (res.files || []).filter((f) => f.rendered_url);
        setFiles(docs);
        const infoTable = docs.find((f) => f.label.includes("Information Table"));
        setActiveUrl((infoTable || docs[0])?.rendered_url || null);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, cik, accession]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        style={{ maxWidth: "85vw", width: "85vw", height: "75vh", maxHeight: "75vh" }}
        className="overflow-hidden flex flex-col bg-slate-950 border-white/10 text-white"
      >
        <DialogHeader className="flex-shrink-0 border-b border-white/10 pb-4">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-mono px-2 py-1 rounded bg-orange-500/20 text-orange-400 uppercase">
              SEC
            </span>
            <span className="text-xs text-slate-400">{accession}</span>
          </div>
          <DialogTitle className="text-lg font-medium text-white leading-tight pr-8">
            {title}
          </DialogTitle>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {files.map((f) => (
                <button
                  key={f.name}
                  onClick={() => setActiveUrl(f.rendered_url)}
                  className={cn(
                    "px-3 py-1 text-xs rounded-md border transition-colors",
                    activeUrl === f.rendered_url
                      ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
                      : "bg-slate-900 text-slate-400 border-white/10 hover:text-white hover:border-white/20"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </DialogHeader>
        <div className="flex-1 min-h-0 py-3 px-1">
          {activeUrl ? (
            <FilingEmbed
              directUrl={activeUrl}
              title={title}
              className="h-full"
            />
          ) : (
            <div className="flex items-center justify-center py-16 text-slate-500 text-sm">
              Loading filing documents…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
