"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchFunds, FundSummary, FundsResponse } from "@/lib/api-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FilerHoldingsModal, FilerRef } from "@/components/filer-holdings-modal";
import { cn } from "@/lib/utils";

const fmtNum = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(n).toLocaleString();

const fmtMoney = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000_000_000) return `$${(n / 1_000_000_000_000).toFixed(2)}T`;
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

const DEBOUNCE_MS = 300;

export function BigFunds() {
  const [data, setData] = useState<FundsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [openFund, setOpenFund] = useState<FilerRef | null>(null);

  // Debounce search input → backend query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFunds({ search: debouncedSearch || undefined, limit: 2000 })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setError("Failed to load funds");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  const totals = useMemo(() => {
    if (!data) return { mv: 0, positions: 0 };
    let mv = 0;
    let positions = 0;
    for (const f of data.funds) {
      mv += f.total_market_value || 0;
      positions += f.positions || 0;
    }
    return { mv, positions };
  }, [data]);

  const handleClick = (f: FundSummary) => {
    setOpenFund({
      accession_number: f.accession_number,
      filer_cik: f.filer_cik,
      filer_name: f.filer_name || f.filer_cik,
      filing_date: f.filing_date,
    });
  };

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-900/40 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div>
            <span className="text-slate-500 text-xs">Period </span>
            <span className="text-slate-200">{data?.period || "—"}</span>
          </div>
          <div>
            <span className="text-slate-500 text-xs">Filers in cache </span>
            <span className="text-slate-200">{data?.total_filers ?? 0}</span>
          </div>
          {data && data.funds.length > 0 && (
            <>
              <div>
                <span className="text-slate-500 text-xs">Top {data.funds.length} total $ </span>
                <span className="text-slate-200">{fmtMoney(totals.mv)}</span>
              </div>
              <div>
                <span className="text-slate-500 text-xs">Total positions </span>
                <span className="text-slate-200">{fmtNum(totals.positions)}</span>
              </div>
            </>
          )}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search filers (name or CIK)…"
          className="px-2 py-1 text-xs rounded-md bg-slate-900 border border-white/10 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500/40 w-72"
        />
      </div>

      {/* Table */}
      {error ? (
        <div className="text-center p-8 text-red-400">{error}</div>
      ) : loading && !data ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-500" />
        </div>
      ) : !data || data.funds.length === 0 ? (
        <div className="text-center p-8 text-slate-400">
          {debouncedSearch
            ? `No filers match "${debouncedSearch}".`
            : "No 13F filers in the cache yet. Run the ingest script first."}
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-slate-400">Filer</TableHead>
                <TableHead className="text-slate-400 text-right">Reported value</TableHead>
                <TableHead className="text-slate-400 text-right">Positions</TableHead>
                <TableHead className="text-slate-400">Filed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.funds.map((f, idx) => (
                <TableRow
                  key={`${f.accession_number}-${idx}`}
                  onClick={() => handleClick(f)}
                  className="border-white/5 cursor-pointer hover:bg-white/5"
                >
                  <TableCell>
                    <div className="text-white hover:text-purple-300">
                      {f.filer_name || f.filer_cik}
                    </div>
                    <div className="text-xs text-slate-500 font-mono">CIK {f.filer_cik}</div>
                  </TableCell>
                  <TableCell className="text-right text-slate-200">{fmtMoney(f.total_market_value)}</TableCell>
                  <TableCell className="text-right text-slate-200">{fmtNum(f.positions)}</TableCell>
                  <TableCell className="text-xs text-slate-400">{f.filing_date || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FilerHoldingsModal filer={openFund} onClose={() => setOpenFund(null)} />
    </div>
  );
}
