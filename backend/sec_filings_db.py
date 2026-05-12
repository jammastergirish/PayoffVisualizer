"""SQLite-backed cache for SEC 13F holdings (and friends).

Tables:
  sec_filings_13f   — one row per 13F filing (accession_number PK)
  sec_holdings_13f  — one row per (filing, holding); period denormalized for fast lookups
  cik_meta         — CIK → display name (lazily populated from data.sec.gov)

Run order:
  1. `ingest_13f.py` populates filings + holdings from Massive.
  2. `get_holders_with_delta(...)` joins for the UI.
"""

from __future__ import annotations

import sqlite3
from typing import Optional

from .local_db import register_migration, get_conn

# ---------- migrations ----------

register_migration(
    1,
    "13f_initial",
    """
    CREATE TABLE IF NOT EXISTS sec_filings_13f (
        accession_number TEXT PRIMARY KEY,
        filer_cik       TEXT NOT NULL,
        filing_date     TEXT NOT NULL,
        period          TEXT NOT NULL,
        form_type       TEXT,
        filing_url      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_13f_filings_filer_period
        ON sec_filings_13f(filer_cik, period);
    CREATE INDEX IF NOT EXISTS idx_13f_filings_period
        ON sec_filings_13f(period);

    CREATE TABLE IF NOT EXISTS sec_holdings_13f (
        id                       INTEGER PRIMARY KEY AUTOINCREMENT,
        accession_number         TEXT NOT NULL,
        filer_cik                TEXT NOT NULL,
        period                   TEXT NOT NULL,
        cusip                    TEXT,
        issuer_name              TEXT,
        market_value             INTEGER,
        shares                   INTEGER,
        shares_type              TEXT,
        put_call                 TEXT,
        investment_discretion    TEXT,
        title_of_class           TEXT,
        voting_sole              INTEGER,
        voting_shared            INTEGER,
        voting_none              INTEGER,
        FOREIGN KEY (accession_number) REFERENCES sec_filings_13f(accession_number)
    );
    CREATE INDEX IF NOT EXISTS idx_13f_holdings_issuer_period
        ON sec_holdings_13f(issuer_name, period);
    CREATE INDEX IF NOT EXISTS idx_13f_holdings_cusip_period
        ON sec_holdings_13f(cusip, period);
    CREATE INDEX IF NOT EXISTS idx_13f_holdings_filer_period
        ON sec_holdings_13f(filer_cik, period);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_13f_holdings_filing_cusip_class_putcall
        ON sec_holdings_13f(accession_number, cusip, title_of_class, put_call);
    """,
)

register_migration(
    2,
    "cik_meta",
    """
    CREATE TABLE IF NOT EXISTS cik_meta (
        cik             TEXT PRIMARY KEY,
        name            TEXT,
        last_refreshed  TEXT
    );
    """,
)

register_migration(
    3,
    "ticker_cusip",
    """
    CREATE TABLE IF NOT EXISTS ticker_cusip (
        ticker                  TEXT PRIMARY KEY,
        cusip                   TEXT NOT NULL,
        company_name            TEXT,
        resolved_via            TEXT,  -- 'verified' | 'heuristic' | 'manual'
        aggregated_market_value INTEGER,
        resolved_at             TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ticker_cusip_cusip ON ticker_cusip(cusip);
    """,
)


# ---------- helpers ----------

def upsert_filings_and_holdings(rows: list[dict]) -> tuple[int, int]:
    """Upsert a batch of Massive 13F rows.

    Massive returns one row per (filing, holding). We split into the two
    tables and dedupe filings by accession_number.
    """
    if not rows:
        return (0, 0)

    filings: dict[str, dict] = {}
    holdings: list[tuple] = []
    for r in rows:
        acc = r.get("accession_number")
        if not acc:
            continue
        if acc not in filings:
            filings[acc] = {
                "accession_number": acc,
                "filer_cik": r.get("filer_cik") or "",
                "filing_date": r.get("filing_date") or "",
                "period": r.get("period") or "",
                "form_type": r.get("form_type"),
                "filing_url": r.get("filing_url"),
            }
        holdings.append((
            acc,
            r.get("filer_cik") or "",
            r.get("period") or "",
            r.get("cusip"),
            (r.get("issuer_name") or "").upper(),
            r.get("market_value"),
            r.get("shares_or_principal_amount"),
            r.get("shares_or_principal_type"),
            (r.get("put_call") or None),
            r.get("investment_discretion"),
            r.get("title_of_class"),
            r.get("voting_authority_sole"),
            r.get("voting_authority_shared"),
            r.get("voting_authority_none"),
        ))

    conn = get_conn()
    try:
        conn.executemany(
            """
            INSERT INTO sec_filings_13f
                (accession_number, filer_cik, filing_date, period, form_type, filing_url)
            VALUES (:accession_number, :filer_cik, :filing_date, :period, :form_type, :filing_url)
            ON CONFLICT(accession_number) DO UPDATE SET
                filer_cik = excluded.filer_cik,
                filing_date = excluded.filing_date,
                period = excluded.period,
                form_type = excluded.form_type,
                filing_url = excluded.filing_url
            """,
            list(filings.values()),
        )
        conn.executemany(
            """
            INSERT INTO sec_holdings_13f
                (accession_number, filer_cik, period, cusip, issuer_name,
                 market_value, shares, shares_type, put_call,
                 investment_discretion, title_of_class,
                 voting_sole, voting_shared, voting_none)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(accession_number, cusip, title_of_class, put_call) DO UPDATE SET
                market_value = excluded.market_value,
                shares = excluded.shares,
                voting_sole = excluded.voting_sole,
                voting_shared = excluded.voting_shared,
                voting_none = excluded.voting_none
            """,
            holdings,
        )
        conn.commit()
    finally:
        conn.close()
    return (len(filings), len(holdings))


def get_two_latest_periods() -> list[str]:
    """Return the two most-recent quarter-end dates that we have data for."""
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT period FROM sec_filings_13f GROUP BY period ORDER BY period DESC LIMIT 2"
        ).fetchall()
    finally:
        conn.close()
    return [r["period"] for r in rows]


def upsert_cik_name(cik: str, name: str) -> None:
    if not cik or not name:
        return
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO cik_meta (cik, name, last_refreshed)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(cik) DO UPDATE SET name = excluded.name, last_refreshed = excluded.last_refreshed
            """,
            (cik, name),
        )
        conn.commit()
    finally:
        conn.close()


def get_cik_names(ciks: list[str]) -> dict[str, str]:
    if not ciks:
        return {}
    placeholders = ",".join("?" * len(ciks))
    conn = get_conn()
    try:
        rows = conn.execute(
            f"SELECT cik, name FROM cik_meta WHERE cik IN ({placeholders})", ciks
        ).fetchall()
    finally:
        conn.close()
    return {r["cik"]: r["name"] for r in rows}


def get_cached_cusip(ticker: str) -> Optional[dict]:
    """Return the cached CUSIP row for a ticker, if any."""
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT ticker, cusip, company_name, resolved_via, aggregated_market_value, resolved_at "
            "FROM ticker_cusip WHERE ticker = ?",
            (ticker.upper(),),
        ).fetchone()
    finally:
        conn.close()
    return dict(row) if row else None


def upsert_ticker_cusip(ticker: str, cusip: str, company_name: Optional[str],
                       resolved_via: str, aggregated_market_value: Optional[int]) -> None:
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO ticker_cusip (ticker, cusip, company_name, resolved_via, aggregated_market_value, resolved_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(ticker) DO UPDATE SET
                cusip                   = excluded.cusip,
                company_name            = excluded.company_name,
                resolved_via            = excluded.resolved_via,
                aggregated_market_value = excluded.aggregated_market_value,
                resolved_at             = excluded.resolved_at
            """,
            (ticker.upper(), cusip, company_name, resolved_via, aggregated_market_value),
        )
        conn.commit()
    finally:
        conn.close()


def get_cusip_candidates(name_pattern: str, latest_period: Optional[str] = None, limit: int = 10) -> list[dict]:
    """Return candidate CUSIPs whose holdings' issuer_name matches `name_pattern`,
    ranked by aggregated market value (latest period). Returns dicts with
    cusip, sample_issuer_name, total_market_value, filer_count.
    """
    if latest_period is None:
        periods = get_two_latest_periods()
        if not periods:
            return []
        latest_period = periods[0]

    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT
                cusip,
                MAX(issuer_name) AS sample_issuer_name,
                SUM(market_value) AS total_market_value,
                COUNT(DISTINCT filer_cik) AS filer_count
            FROM sec_holdings_13f
            WHERE period = ?
              AND issuer_name LIKE ?
              AND (put_call IS NULL OR put_call = '')
              AND cusip IS NOT NULL
            GROUP BY cusip
            ORDER BY total_market_value DESC NULLS LAST
            LIMIT ?
            """,
            (latest_period, name_pattern, limit),
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


def get_holders_by_cusip_with_delta(
    cusip: str,
    latest_period: Optional[str] = None,
    prev_period: Optional[str] = None,
) -> list[dict]:
    """Return holders for a specific CUSIP in the latest period with prev-quarter delta."""
    if latest_period is None:
        periods = get_two_latest_periods()
        if not periods:
            return []
        latest_period = periods[0]
        if prev_period is None and len(periods) > 1:
            prev_period = periods[1]

    sql = """
        WITH latest AS (
            SELECT h.filer_cik, h.cusip, h.issuer_name, h.market_value, h.shares,
                   h.put_call, h.title_of_class, h.investment_discretion,
                   h.voting_sole, h.voting_shared, h.voting_none,
                   h.accession_number,
                   f.filing_date, f.filing_url
            FROM sec_holdings_13f h
            JOIN sec_filings_13f f USING(accession_number)
            WHERE h.period = ?
              AND h.cusip = ?
              AND (h.put_call IS NULL OR h.put_call = '')
        ),
        prev AS (
            SELECT filer_cik, cusip, title_of_class, put_call,
                   SUM(shares) AS shares,
                   SUM(market_value) AS market_value
            FROM sec_holdings_13f
            WHERE period = ?
              AND cusip = ?
              AND (put_call IS NULL OR put_call = '')
            GROUP BY filer_cik, cusip, title_of_class, put_call
        )
        SELECT
            l.filer_cik, l.cusip, l.issuer_name, l.market_value, l.shares,
            l.put_call, l.title_of_class, l.investment_discretion,
            l.voting_sole, l.voting_shared, l.voting_none,
            l.filing_date, l.filing_url, l.accession_number,
            p.shares       AS prev_shares,
            p.market_value AS prev_market_value
        FROM latest l
        LEFT JOIN prev p
            ON p.filer_cik = l.filer_cik
           AND IFNULL(p.cusip,'') = IFNULL(l.cusip,'')
           AND IFNULL(p.title_of_class,'') = IFNULL(l.title_of_class,'')
        ORDER BY l.market_value DESC NULLS LAST
    """
    conn = get_conn()
    try:
        rows = conn.execute(sql, (latest_period, cusip, prev_period or "", cusip)).fetchall()
    finally:
        conn.close()

    out: list[dict] = []
    for r in rows:
        d = dict(r)
        latest_shares = d.get("shares") or 0
        prev_shares = d.get("prev_shares") or 0
        if prev_period is None or prev_shares == 0:
            d["change"] = "new" if prev_shares == 0 and prev_period else "unknown"
        elif latest_shares > prev_shares:
            d["change"] = "added"
        elif latest_shares < prev_shares:
            d["change"] = "trimmed"
        else:
            d["change"] = "held"
        d["delta_shares"] = (latest_shares - prev_shares) if (latest_shares and prev_shares) else None
        out.append(d)
    return out


def get_holders_with_delta(
    issuer_name_pattern: str,
    latest_period: Optional[str] = None,
    prev_period: Optional[str] = None,
) -> list[dict]:
    """Return holders matching the issuer name in the latest period (with delta
    vs the previous period when available).

    `issuer_name_pattern` is a LIKE expression (e.g. '%APPLE%'). The pattern
    is applied against the upper-cased issuer_name we stored.
    """
    if latest_period is None:
        periods = get_two_latest_periods()
        if not periods:
            return []
        latest_period = periods[0]
        if prev_period is None and len(periods) > 1:
            prev_period = periods[1]

    sql = """
        WITH latest AS (
            SELECT h.filer_cik, h.cusip, h.issuer_name, h.market_value, h.shares,
                   h.put_call, h.title_of_class, h.investment_discretion,
                   h.voting_sole, h.voting_shared, h.voting_none,
                   h.accession_number,
                   f.filing_date, f.filing_url
            FROM sec_holdings_13f h
            JOIN sec_filings_13f f USING(accession_number)
            WHERE h.period = ?
              AND h.issuer_name LIKE ?
              AND (h.put_call IS NULL OR h.put_call = '')
        ),
        prev AS (
            SELECT filer_cik, cusip, title_of_class, put_call,
                   SUM(shares) AS shares,
                   SUM(market_value) AS market_value
            FROM sec_holdings_13f
            WHERE period = ?
              AND issuer_name LIKE ?
              AND (put_call IS NULL OR put_call = '')
            GROUP BY filer_cik, cusip, title_of_class, put_call
        )
        SELECT
            l.filer_cik, l.cusip, l.issuer_name, l.market_value, l.shares,
            l.put_call, l.title_of_class, l.investment_discretion,
            l.voting_sole, l.voting_shared, l.voting_none,
            l.filing_date, l.filing_url, l.accession_number,
            p.shares       AS prev_shares,
            p.market_value AS prev_market_value
        FROM latest l
        LEFT JOIN prev p
            ON p.filer_cik = l.filer_cik
           AND IFNULL(p.cusip,'') = IFNULL(l.cusip,'')
           AND IFNULL(p.title_of_class,'') = IFNULL(l.title_of_class,'')
        ORDER BY l.market_value DESC NULLS LAST
    """
    conn = get_conn()
    try:
        rows = conn.execute(
            sql,
            (latest_period, issuer_name_pattern, prev_period or "", issuer_name_pattern),
        ).fetchall()
    finally:
        conn.close()

    out: list[dict] = []
    for r in rows:
        d = dict(r)
        latest_shares = d.get("shares") or 0
        prev_shares = d.get("prev_shares") or 0
        if prev_period is None or prev_shares == 0:
            if prev_shares == 0 and (prev_period is None or prev_period == ""):
                d["change"] = "unknown"
            else:
                d["change"] = "new"
        elif latest_shares > prev_shares:
            d["change"] = "added"
        elif latest_shares < prev_shares:
            d["change"] = "trimmed"
        else:
            d["change"] = "held"
        d["delta_shares"] = (latest_shares - prev_shares) if (latest_shares and prev_shares) else None
        out.append(d)
    return out
