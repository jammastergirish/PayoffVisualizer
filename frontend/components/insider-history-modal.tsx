"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchInsiderHistory, InsiderTrade } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface InsiderHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  ownerCik: string | null;
  ownerName: string | null;
}

const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null
    ? "—"
    : n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

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

interface CompanyStats {
  ticker: string;
  issuerName: string;
  count: number;
  buys: number;
  sells: number;
  buyValue: number;
  sellValue: number;
}

export function InsiderHistoryModal({
  isOpen,
  onClose,
  ownerCik,
  ownerName,
}: InsiderHistoryModalProps) {
  const [trades, setTrades] = useState<InsiderTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !ownerCik) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTrades([]);
    fetchInsiderHistory(ownerCik, 200)
      .then((res) => {
        if (!cancelled) setTrades(res.trades || []);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setError("Failed to load insider history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, ownerCik]);

  const companyStats: CompanyStats[] = useMemo(() => {
    const map = new Map<string, CompanyStats>();
    for (const t of trades) {
      const ticker = (t.tickers && t.tickers[0]) || "?";
      const issuerName = t.issuer_name || ticker;
      let s = map.get(ticker);
      if (!s) {
        s = { ticker, issuerName, count: 0, buys: 0, sells: 0, buyValue: 0, sellValue: 0 };
        map.set(ticker, s);
      }
      s.count += 1;
      if (t.transaction_code === "P" && t.transaction_acquired_disposed === "A") {
        s.buys += 1;
        s.buyValue += t.transaction_value || 0;
      } else if (
        t.transaction_code === "S" ||
        (t.transaction_category === "discretionary" && t.transaction_acquired_disposed === "D")
      ) {
        s.sells += 1;
        s.sellValue += t.transaction_value || 0;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [trades]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl w-[92vw] h-[60vh] max-h-[60vh] overflow-hidden flex flex-col bg-slate-950 border-white/10 text-white">
        <DialogHeader className="flex-shrink-0 border-b border-white/10 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono px-2 py-1 rounded bg-purple-500/20 text-purple-400 uppercase">
              Insider Profile
            </span>
            {ownerCik && (
              <span className="text-xs font-mono text-slate-500">CIK {ownerCik}</span>
            )}
          </div>
          <DialogTitle className="text-lg font-medium text-white leading-tight pr-8">
            {ownerName || "Insider"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 px-1 space-y-4">
          {loading && (
            <div className="text-center p-8 text-slate-400">Loading insider history...</div>
          )}
          {error && <div className="text-center p-8 text-red-400">{error}</div>}
          {!loading && !error && trades.length === 0 && (
            <div className="text-center p-8 text-slate-400">No Form 4 history available</div>
          )}

          {!loading && !error && trades.length > 0 && (
            <>
              {/* Per-company summary */}
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">
                  Companies ({companyStats.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {companyStats.map((s) => (
                    <div
                      key={s.ticker}
                      className="rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-xs"
                    >
                      <div className="font-mono text-purple-300">{s.ticker}</div>
                      <div className="text-slate-400 text-[10px] mt-0.5 max-w-[200px] truncate">
                        {s.issuerName}
                      </div>
                      <div className="flex gap-2 mt-1">
                        <span className="text-slate-500">{s.count} tx</span>
                        {s.buys > 0 && (
                          <span className="text-green-300">{s.buys} buy · {fmtValue(s.buyValue)}</span>
                        )}
                        {s.sells > 0 && (
                          <span className="text-red-300">{s.sells} sell · {fmtValue(s.sellValue)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Full transactions table */}
              <div className="rounded-lg border border-white/10 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="text-slate-400">Filed</TableHead>
                      <TableHead className="text-slate-400">Company</TableHead>
                      <TableHead className="text-slate-400">Role</TableHead>
                      <TableHead className="text-slate-400">Transaction</TableHead>
                      <TableHead className="text-slate-400 text-right">Shares</TableHead>
                      <TableHead className="text-slate-400 text-right">Value</TableHead>
                      <TableHead className="text-slate-400">Flags</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trades.map((t, idx) => {
                      const ticker = (t.tickers && t.tickers[0]) || "—";
                      const isMechanical = t.transaction_category === "mechanical";
                      return (
                        <TableRow
                          key={`${t.accession_number}-${idx}`}
                          className={cn("border-white/5", isMechanical && "opacity-60")}
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
                          <TableCell>
                            <div className="font-mono text-purple-300">{ticker}</div>
                            <div className="text-xs text-slate-500 max-w-[180px] truncate">
                              {t.issuer_name}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-slate-400">
                            {t.officer_title || t.owner_roles.join(", ") || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={codeBadgeClasses(t)}>
                              {t.transaction_code} · {t.transaction_label}
                            </Badge>
                            <div className="text-xs text-slate-500 mt-1">{t.security_title}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <span
                              className={cn(
                                t.transaction_acquired_disposed === "A"
                                  ? "text-green-300"
                                  : "text-red-300"
                              )}
                            >
                              {t.transaction_acquired_disposed === "A" ? "+" : "−"}
                              {fmtNum(t.transaction_shares)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-slate-200">
                            {fmtValue(t.transaction_value)}
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
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
