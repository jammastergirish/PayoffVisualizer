"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchInsiderTrades, InsiderTrade } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { InsiderHistoryModal } from "@/components/insider-history-modal";

interface InsiderTradesProps {
  ticker: string;
}

const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

const fmtMoney = (n: number | null | undefined) => (n == null ? "—" : `$${fmtNum(n, 2)}`);

const fmtValue = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

const codeBadgeClasses = (t: InsiderTrade) => {
  const isAcquire = t.transaction_acquired_disposed === "A";
  if (t.transaction_category === "discretionary") {
    return isAcquire
      ? "bg-green-500/20 text-green-300 border-green-500/40"
      : "bg-red-500/20 text-red-300 border-red-500/40";
  }
  return "bg-slate-700/40 text-slate-300 border-slate-600/40";
};

type FilterKey = "all" | "discretionary" | "purchases" | "sales";

export function InsiderTrades({ ticker }: InsiderTradesProps) {
  const [trades, setTrades] = useState<InsiderTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [historyTarget, setHistoryTarget] = useState<{ cik: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!ticker) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetchInsiderTrades(ticker, 100);
        if (!cancelled) setTrades(res.trades || []);
      } catch (e) {
        console.error(e);
        if (!cancelled) setError("Failed to load insider trades");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      if (filter === "all") return true;
      if (filter === "discretionary") return t.transaction_category === "discretionary";
      if (filter === "purchases")
        return t.transaction_code === "P" && t.transaction_acquired_disposed === "A";
      if (filter === "sales")
        return t.transaction_code === "S" || (t.transaction_category === "discretionary" && t.transaction_acquired_disposed === "D");
      return true;
    });
  }, [trades, filter]);

  const summary = useMemo(() => {
    let buys = 0,
      sells = 0,
      buyValue = 0,
      sellValue = 0;
    for (const t of trades) {
      if (t.transaction_code === "P" && t.transaction_acquired_disposed === "A") {
        buys += 1;
        buyValue += t.transaction_value || 0;
      } else if (
        t.transaction_code === "S" ||
        (t.transaction_category === "discretionary" && t.transaction_acquired_disposed === "D")
      ) {
        sells += 1;
        sellValue += t.transaction_value || 0;
      }
    }
    return { buys, sells, buyValue, sellValue };
  }, [trades]);

  if (loading) {
    return <div className="text-center p-8 text-slate-400">Loading insider trades...</div>;
  }
  if (error) {
    return <div className="text-center p-8 text-red-400">{error}</div>;
  }
  if (trades.length === 0) {
    return <div className="text-center p-8 text-slate-400">No Form 4 filings available for {ticker}</div>;
  }

  const filterButton = (key: FilterKey, label: string) => (
    <button
      key={key}
      onClick={() => setFilter(key)}
      className={cn(
        "px-3 py-1 text-xs rounded-md border transition-colors",
        filter === key
          ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
          : "bg-slate-900 text-slate-400 border-white/10 hover:text-white hover:border-white/20"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-slate-900/40 p-3 text-xs text-slate-400 leading-relaxed">
        Discretionary signals (highlighted) are open-market purchases (P) and sales (S). Mechanical
        rows — option grants (A), exercises (M), tax withholding (F), gifts (G), 10b5-1 plan sales —
        are dimmed because they are pre-planned or vesting-driven and not a fresh insider decision.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {filterButton("all", `All (${trades.length})`)}
          {filterButton("discretionary", "Discretionary")}
          {filterButton("purchases", `Buys (${summary.buys})`)}
          {filterButton("sales", `Sells (${summary.sells})`)}
        </div>
        <div className="flex gap-4 text-xs">
          <div>
            <span className="text-slate-500">Buy $: </span>
            <span className="text-green-300">{fmtValue(summary.buyValue)}</span>
          </div>
          <div>
            <span className="text-slate-500">Sell $: </span>
            <span className="text-red-300">{fmtValue(summary.sellValue)}</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="text-slate-400">Filed</TableHead>
              <TableHead className="text-slate-400">Insider</TableHead>
              <TableHead className="text-slate-400">Transaction</TableHead>
              <TableHead className="text-slate-400 text-right">Shares</TableHead>
              <TableHead className="text-slate-400 text-right">Price</TableHead>
              <TableHead className="text-slate-400 text-right">Value</TableHead>
              <TableHead className="text-slate-400 text-right">Held After</TableHead>
              <TableHead className="text-slate-400">Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((t, idx) => {
              const isMechanical = t.transaction_category === "mechanical";
              return (
                <TableRow
                  key={`${t.accession_number}-${idx}`}
                  className={cn(
                    "border-white/5",
                    isMechanical ? "opacity-60" : ""
                  )}
                >
                  <TableCell className="text-slate-300 text-xs">
                    {t.filing_url ? (
                      <a
                        href={t.filing_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open SEC filing"
                        className="hover:text-purple-300 hover:underline"
                      >
                        {t.filing_date}
                      </a>
                    ) : (
                      <div>{t.filing_date}</div>
                    )}
                    {t.transaction_date && t.transaction_date !== t.filing_date && (
                      <div className="text-slate-500">tx {t.transaction_date}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-white">
                    <div className="font-medium">
                      {t.owner_cik ? (
                        <button
                          type="button"
                          onClick={() =>
                            setHistoryTarget({ cik: t.owner_cik!, name: t.owner_name })
                          }
                          className="text-left hover:text-purple-300 hover:underline"
                          title="View all Form 4 activity by this insider"
                        >
                          {t.owner_name}
                        </button>
                      ) : (
                        t.owner_name
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      {t.officer_title || t.owner_roles.join(", ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={codeBadgeClasses(t)}>
                      {t.transaction_code} · {t.transaction_label}
                    </Badge>
                    <div className="text-xs text-slate-500 mt-1">{t.security_title}</div>
                  </TableCell>
                  <TableCell className="text-right text-slate-200">
                    <span
                      className={cn(
                        t.transaction_acquired_disposed === "A" ? "text-green-300" : "text-red-300"
                      )}
                    >
                      {t.transaction_acquired_disposed === "A" ? "+" : "−"}
                      {fmtNum(t.transaction_shares)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-slate-300">
                    {fmtMoney(t.transaction_price_per_share)}
                  </TableCell>
                  <TableCell className="text-right text-slate-200">
                    {fmtValue(t.transaction_value)}
                  </TableCell>
                  <TableCell className="text-right text-slate-400">
                    {fmtNum(t.shares_owned_following_transaction)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {t.aff_10b5_one && (
                        <Badge
                          variant="outline"
                          className="bg-amber-500/10 text-amber-300 border-amber-500/30 text-[10px]"
                        >
                          10b5-1
                        </Badge>
                      )}
                      {t.form_type === "4/A" && (
                        <Badge
                          variant="outline"
                          className="bg-slate-700/40 text-slate-300 border-slate-600/40 text-[10px]"
                        >
                          Amend
                        </Badge>
                      )}
                      {t.is_ten_percent_owner && (
                        <Badge
                          variant="outline"
                          className="bg-blue-500/10 text-blue-300 border-blue-500/30 text-[10px]"
                        >
                          10%
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <InsiderHistoryModal
        isOpen={historyTarget !== null}
        onClose={() => setHistoryTarget(null)}
        ownerCik={historyTarget?.cik || null}
        ownerName={historyTarget?.name || null}
      />
    </div>
  );
}
