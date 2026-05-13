"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchBigInvestors,
  BigInvestorHolder,
  BigInvestorsResponse,
  HolderChange,
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
import { FilerHoldingsModal } from "@/components/filer-holdings-modal";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface BigInvestorsProps {
  ticker: string;
}

const fmtNum = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(n).toLocaleString();

const fmtMoney = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

const changeClasses: Record<HolderChange, string> = {
  new: "bg-green-500/20 text-green-300 border-green-500/40",
  added: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  trimmed: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  held: "bg-slate-700/40 text-slate-300 border-slate-600/40",
  unknown: "bg-slate-700/40 text-slate-400 border-slate-600/40",
};

const changeLabel: Record<HolderChange, string> = {
  new: "New",
  added: "Added",
  trimmed: "Trimmed",
  held: "Held",
  unknown: "—",
};

type SortKey = "change" | "market_value" | "shares" | "delta" | "filer";
type SortDir = "asc" | "desc";

// Rank for sorting by "change" — bullish actions first.
const changeRank: Record<HolderChange, number> = {
  new: 0,
  added: 1,
  held: 2,
  trimmed: 3,
  unknown: 4,
};

export function BigInvestors({ ticker }: BigInvestorsProps) {
  const [data, setData] = useState<BigInvestorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("change");
  const [sortDir, setSortDir] = useState<SortDir>("asc"); // "asc" of changeRank = New first
  const [openHolder, setOpenHolder] = useState<BigInvestorHolder | null>(null);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBigInvestors(ticker)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setError("Failed to load institutional holders");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const sorted = useMemo<BigInvestorHolder[]>(() => {
    if (!data) return [];
    const rows = [...data.holders];
    const dir = sortDir === "asc" ? 1 : -1;
    const getVal = (h: BigInvestorHolder): number | string => {
      switch (sortKey) {
        case "change": return changeRank[h.change];
        case "market_value": return h.market_value ?? -Infinity;
        case "shares": return h.shares ?? -Infinity;
        case "delta": return h.delta_shares ?? -Infinity;
        case "filer": return (h.filer_name || "").toLowerCase();
      }
    };
    rows.sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // Tiebreak by market value desc, regardless of primary direction
      return (b.market_value ?? 0) - (a.market_value ?? 0);
    });
    return rows;
  }, [data, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Sensible default direction per column
      setSortDir(
        key === "change" || key === "filer" ? "asc" : "desc"
      );
    }
  };

  const totals = useMemo(() => {
    if (!data) return { mv: 0, shares: 0 };
    let mv = 0;
    let shares = 0;
    for (const h of data.holders) {
      mv += h.market_value || 0;
      shares += h.shares || 0;
    }
    return { mv, shares };
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-500" />
      </div>
    );
  }
  if (error) return <div className="text-center p-8 text-red-400">{error}</div>;
  if (!data || data.holders.length === 0) {
    return (
      <div className="text-center p-8 text-slate-400 space-y-2">
        <div>
          No 13F institutional holders found for {ticker}
          {data?.match_term ? ` (match: "${data.match_term}")` : ""}.
        </div>
        <div className="text-xs text-slate-500">
          The 13F cache may be empty or this ticker may not match any holdings yet.
          Run{" "}
          <code className="px-1 rounded bg-slate-800 text-slate-300">
            uv run python -m backend.scripts.ingest_13f --quarters 2
          </code>{" "}
          to backfill.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-900/40 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div>
            <span className="text-slate-500 text-xs">Period </span>
            <span className="text-slate-200">{data.latest_period || "—"}</span>
            {data.prev_period && (
              <span className="text-slate-500 text-xs ml-2">vs {data.prev_period}</span>
            )}
          </div>
          <div>
            <span className="text-slate-500 text-xs">Match </span>
            <span className="text-slate-200 font-mono text-xs">{data.match_term}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <div>
            <span className="text-slate-500">Filers </span>
            <span className="text-slate-200">{data.holders_count}</span>
          </div>
          <div>
            <span className="text-slate-500">Total $ </span>
            <span className="text-slate-200">{fmtMoney(totals.mv)}</span>
          </div>
          <div>
            <span className="text-slate-500">Total sh </span>
            <span className="text-slate-200">{fmtNum(totals.shares)}</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-white/10 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <SortableHead label="Filer" col="filer" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableHead label="Market value" col="market_value" align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableHead label="Shares" col="shares" align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableHead label="Δ shares" col="delta" align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableHead label="Change" col="change" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <TableHead className="text-slate-400">Discretion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((h, idx) => (
              <TableRow
                key={`${h.accession_number}-${h.cusip}-${idx}`}
                onClick={() => setOpenHolder(h)}
                className="border-white/5 cursor-pointer hover:bg-white/5"
              >
                <TableCell>
                  <div className="text-white hover:text-orange-300">{h.filer_name}</div>
                  <div className="text-xs text-slate-500 font-mono">CIK {h.filer_cik}</div>
                </TableCell>
                <TableCell className="text-right text-slate-200">{fmtMoney(h.market_value)}</TableCell>
                <TableCell className="text-right text-slate-200">{fmtNum(h.shares)}</TableCell>
                <TableCell className="text-right">
                  {h.delta_shares == null ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    <span className={cn(h.delta_shares > 0 ? "text-green-300" : h.delta_shares < 0 ? "text-red-300" : "text-slate-400")}>
                      {h.delta_shares > 0 ? "+" : ""}{fmtNum(h.delta_shares)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn("text-[10px]", changeClasses[h.change])}>
                    {changeLabel[h.change]}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-slate-400">{h.investment_discretion || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <FilerHoldingsModal filer={openHolder} onClose={() => setOpenHolder(null)} />
    </div>
  );
}

function SortableHead({
  label,
  col,
  align = "left",
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortKey;
  align?: "left" | "right";
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (col: SortKey) => void;
}) {
  const active = sortKey === col;
  const Icon = sortDir === "asc" ? ChevronUp : ChevronDown;
  return (
    <TableHead className={cn("text-slate-400", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-white transition-colors",
          align === "right" && "flex-row-reverse"
        )}
      >
        <span className={cn(active && "text-white")}>{label}</span>
        <Icon className={cn("h-3 w-3", active ? "opacity-100" : "opacity-30")} />
      </button>
    </TableHead>
  );
}
