"use client";

import { useEffect, useState } from "react";
import { fetchSecFilingDoc, secProxyUrl } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface FilingEmbedProps {
  cik?: string | null;
  accession?: string | null;
  /** Optional direct URL to embed (skips resolver). Must be a sec.gov URL. */
  directUrl?: string | null;
  /** Fallback external link shown if embedding fails. */
  fallbackUrl?: string | null;
  className?: string;
  /** Iframe title for accessibility. */
  title?: string;
}

/**
 * Embeds a SEC EDGAR filing document inside an iframe.
 *
 * SEC sends X-Frame-Options: SAMEORIGIN, so we proxy the HTML through our
 * backend (/api/sec-proxy) which serves it same-origin with a <base href>
 * injected so images/CSS still load from sec.gov.
 *
 * Usage:
 *   <FilingEmbed cik="320193" accession="0000320193-25-000079" />
 *   <FilingEmbed directUrl="https://www.sec.gov/Archives/edgar/..." />
 */
export function FilingEmbed({
  cik,
  accession,
  directUrl,
  fallbackUrl,
  className,
  title = "SEC Filing",
}: FilingEmbedProps) {
  const [proxiedUrl, setProxiedUrl] = useState<string | null>(null);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProxiedUrl(null);
    setExternalUrl(null);

    const apply = (secUrl: string | null) => {
      if (cancelled) return;
      if (!secUrl) {
        setError("No document URL");
      } else {
        setExternalUrl(secUrl);
        setProxiedUrl(secProxyUrl(secUrl));
      }
      setLoading(false);
    };

    if (directUrl) {
      apply(directUrl);
      return;
    }
    if (!cik || !accession) {
      setLoading(false);
      setError("Missing CIK or accession");
      return;
    }
    fetchSecFilingDoc(cik, accession)
      .then((res) => {
        if (res.error || !res.url) {
          apply(null);
          if (!cancelled) setError(res.error || "Could not resolve primary document");
        } else {
          apply(res.url);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to resolve filing");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cik, accession, directUrl]);

  return (
    <div
      className={cn(
        "relative w-full bg-white rounded-md overflow-hidden",
        className
      )}
      // Belt-and-suspenders: even if the parent doesn't impose a height, the
      // iframe gets a usable size. Callers can override via className.
      style={{ minHeight: "70vh" }}
    >
      {/* Iframe fills the entire container */}
      {proxiedUrl && (
        <iframe
          key={proxiedUrl}
          src={proxiedUrl}
          title={title}
          className="absolute inset-0 w-full h-full border-0 bg-white"
          referrerPolicy="no-referrer"
        />
      )}

      {/* Toolbar overlay (top-right) */}
      {(externalUrl || fallbackUrl) && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-3 rounded-md bg-slate-900/90 px-3 py-1 text-xs border border-white/10 shadow">
          <a
            href={externalUrl || fallbackUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 hover:text-orange-300 hover:underline"
          >
            Open on SEC ↗
          </a>
        </div>
      )}

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm bg-slate-900/50">
          Loading filing…
        </div>
      )}

      {/* Error overlay */}
      {error && !loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400 text-sm bg-slate-900/50 p-4 text-center">
          <div>Could not embed filing: {error}</div>
          {(externalUrl || fallbackUrl) && (
            <a
              href={externalUrl || fallbackUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 hover:text-orange-300 hover:underline"
            >
              View on SEC ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
