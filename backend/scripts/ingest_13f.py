"""Ingest SEC 13F filings from Massive into the local SQLite cache.

Usage (from repo root):
    uv run python -m backend.scripts.ingest_13f --quarters 2     # backfill latest two quarters
    uv run python -m backend.scripts.ingest_13f --since 2025-10-01   # incremental from date

The endpoint can only filter by filer_cik or filing_date, so we scan by
filing_date range and paginate via next_url.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date, datetime, timedelta
from typing import Iterator

import httpx

# Make sure local_db migrations are registered before any DB access
from backend import sec_filings_db  # noqa: F401
from backend.sec_filings_db import upsert_filings_and_holdings, upsert_cik_name, get_cik_names
from backend.config_loader import config_loader


_MASSIVE_BASE = "https://api.massive.com"
_PATH = "/stocks/filings/vX/13-F"

# Massive 13F quarter-end dates are quarter ends (Mar/Jun/Sep/Dec last day).
# A filing for period P is typically submitted within 45 days of P.
# So to cover a given period, we want filings filed from P to P+~60 days.


def _api_key() -> str:
    creds = config_loader.get_credentials("massive") or {}
    key = creds.get("api_key") or os.getenv("MASSIVE_API_KEY")
    if not key:
        sys.exit("MASSIVE_API_KEY not configured")
    return key


def _date_range_for_quarters(n_quarters: int) -> tuple[str, str]:
    """Latest N quarters' filing window. We grab filings from
    (oldest_quarter_end) through today.
    """
    today = date.today()
    # Walk back N quarter-ends from today.
    year, month = today.year, today.month
    quarter = (month - 1) // 3
    quarter_starts = []
    for _ in range(n_quarters + 1):
        # End of previous quarter
        if quarter == 0:
            quarter = 4
            year -= 1
        else:
            quarter -= 1
        end_month = quarter * 3
        # last day of end_month
        if end_month == 12:
            qend = date(year, 12, 31)
        else:
            qend = date(year, end_month + 1, 1) - timedelta(days=1)
        quarter_starts.append(qend)
    return (quarter_starts[-1].isoformat(), today.isoformat())


def _iter_pages(api_key: str, params: dict) -> Iterator[dict]:
    """Yield each response page (dict) from Massive, following next_url."""
    headers = {"Authorization": f"Bearer {api_key}", "Accept-Encoding": "gzip"}
    url = f"{_MASSIVE_BASE}{_PATH}"
    next_params = params
    with httpx.Client(timeout=30.0) as client:
        while True:
            resp = client.get(url, params=next_params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            yield data
            nxt = data.get("next_url")
            if not nxt:
                return
            # next_url is a fully-formed absolute URL; clear params (already encoded).
            url = nxt
            next_params = None
            # Be polite — small delay between page requests.
            time.sleep(0.2)


def ingest(filing_date_gte: str, filing_date_lte: str, page_limit: int = 1000, max_pages: int | None = None) -> dict:
    api_key = _api_key()
    params = {
        "filing_date.gte": filing_date_gte,
        "filing_date.lte": filing_date_lte,
        "limit": page_limit,
        "sort": "filing_date.asc",  # ascending so partial runs are resumable
    }
    print(f"[ingest_13f] window {filing_date_gte} → {filing_date_lte}, page limit {page_limit}")
    started = time.time()
    pages = 0
    total_rows = 0
    total_filings = 0
    total_holdings = 0
    unique_filers: set[str] = set()
    try:
        for page in _iter_pages(api_key, params):
            results = page.get("results") or []
            if not results:
                break
            pages += 1
            total_rows += len(results)
            f_inserted, h_inserted = upsert_filings_and_holdings(results)
            total_filings += f_inserted
            total_holdings += h_inserted
            for r in results:
                fc = r.get("filer_cik")
                if fc:
                    unique_filers.add(fc)
            if pages % 10 == 0 or pages == 1:
                print(f"  page {pages}: +{len(results)} rows (total {total_rows})")
            if max_pages and pages >= max_pages:
                print(f"  stopped at max_pages={max_pages}")
                break
    except KeyboardInterrupt:
        print("\n[ingest_13f] interrupted by user; partial data persisted.")

    elapsed = time.time() - started
    print(f"[ingest_13f] done: {pages} pages, {total_rows} rows, "
          f"{total_filings} unique filings, {total_holdings} holdings, "
          f"{len(unique_filers)} unique filers in {elapsed:.1f}s")

    return {
        "pages": pages,
        "rows": total_rows,
        "filings": total_filings,
        "holdings": total_holdings,
        "unique_filers": len(unique_filers),
        "elapsed_s": elapsed,
        "filer_ciks": list(unique_filers),
    }


def enrich_cik_names(ciks: list[str]) -> int:
    """Fetch display names for CIKs we don't have yet, via data.sec.gov."""
    known = get_cik_names(ciks)
    missing = [c for c in ciks if c not in known]
    if not missing:
        return 0
    ua = os.getenv("SEC_USER_AGENT") or "PayoffDiagrams (girish@girishgupta.com)"
    print(f"[ingest_13f] enriching {len(missing)} CIK names via data.sec.gov…")
    n = 0
    with httpx.Client(timeout=15.0, headers={"User-Agent": ua}) as client:
        for cik in missing:
            try:
                r = client.get(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json")
                r.raise_for_status()
                name = r.json().get("name")
                if name:
                    upsert_cik_name(cik, name)
                    n += 1
            except Exception as e:
                print(f"  WARN: CIK {cik}: {e}")
            time.sleep(0.12)  # SEC asks for ≤10 req/s
    return n


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quarters", type=int, default=2, help="Backfill the latest N quarters of filings")
    parser.add_argument("--since", type=str, default=None, help="Override start date (YYYY-MM-DD)")
    parser.add_argument("--until", type=str, default=None, help="Override end date (YYYY-MM-DD)")
    parser.add_argument("--max-pages", type=int, default=None, help="Stop after N pages (for testing)")
    parser.add_argument("--no-enrich-names", action="store_true", help="Skip data.sec.gov name lookup")
    parser.add_argument("--no-resolve-cusips", action="store_true", help="Skip CUSIP→ticker batch resolution")
    parser.add_argument("--cusip-limit", type=int, default=2000, help="Top-N uncached CUSIPs to resolve via Massive (default 2000)")
    args = parser.parse_args()

    if args.since:
        gte = args.since
        lte = args.until or date.today().isoformat()
    else:
        gte, lte = _date_range_for_quarters(args.quarters)
        if args.until:
            lte = args.until

    summary = ingest(gte, lte, max_pages=args.max_pages)
    if not args.no_enrich_names and summary["filer_ciks"]:
        added = enrich_cik_names(summary["filer_ciks"])
        print(f"[ingest_13f] resolved {added} new filer names")

    if not args.no_resolve_cusips:
        from backend.providers.massive import backfill_cusip_tickers
        backfill_cusip_tickers(limit=args.cusip_limit)


if __name__ == "__main__":
    main()
