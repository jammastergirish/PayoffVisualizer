"use client";

import { useEffect, useState } from "react";
import { fetchAnalystInsights, AnalystInsight } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MarkdownDisplay } from "@/components/markdown-display";



import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface AnalystInsightsProps {
  ticker: string;
}

export function InsightCard({ item }: { item: AnalystInsight }) {
  const [isOpen, setIsOpen] = useState(false);

  // Simple helper for rating badge color
  const getRatingColor = (rating: string) => {
    const r = rating?.toLowerCase() || "";
    if (r.includes("buy") || r.includes("outperform") || r.includes("overweight")) return "bg-green-500/20 text-green-400 border-green-500/30";
    if (r.includes("sell") || r.includes("underperform") || r.includes("underweight")) return "bg-red-500/20 text-red-400 border-red-500/30";
    return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  };

  return (
    <Card 
      className={cn(
        "bg-slate-950 border-white/10 text-white transition-all duration-200",
        "hover:border-white/20"
      )}
    >
      <CardHeader 
        className="pb-4 cursor-pointer select-none group" 
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <CardTitle className="text-lg font-medium flex items-center gap-2">
               <div className={cn(
                  "p-1 rounded-full bg-white/5 text-slate-400 transition-colors",
                  "group-hover:bg-white/10 group-hover:text-white"
               )}>
                  {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
               </div>
              {item.firm}
              <Badge variant="outline" className={getRatingColor(item.rating)}>
                {item.rating_action ? `${item.rating_action} ` : ""}{item.rating}
              </Badge>
            </CardTitle>
            <CardDescription className="text-slate-400 mt-1 pl-7">
              {item.date}
            </CardDescription>
          </div>
          {item.price_target && (
             <div className="text-right pl-4">
                <div className="text-sm text-slate-400">Target</div>
                <div className="text-xl font-bold text-orange-400">${item.price_target}</div>
             </div>
          )}
        </div>
      </CardHeader>
      
      {isOpen && (
        <CardContent className="text-sm text-slate-300 leading-relaxed pt-0 pl-11 animate-in fade-in slide-in-from-top-2 duration-200">
           <div className="pt-2 border-t border-white/5">
              <MarkdownDisplay content={item.insight} />
           </div>
        </CardContent>
      )}
    </Card>
  );
}

export function AnalystInsights({ ticker }: AnalystInsightsProps) {
  const [insights, setInsights] = useState<AnalystInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!ticker) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetchAnalystInsights(ticker);
        setInsights(res.insights || []);
      } catch (err) {
        console.error(err);
        setError("Failed to load analyst insights");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [ticker]);

  if (loading) {
    return <div className="text-center p-8 text-slate-400">Loading analyst insights...</div>;
  }

  if (error) {
    return <div className="text-center p-8 text-red-400">{error}</div>;
  }

  if (insights.length === 0) {
    return <div className="text-center p-8 text-slate-400">No analyst insights available for {ticker}</div>;
  }

  return (
    <div className="space-y-4">
      {insights.map((item, idx) => (
        <InsightCard key={`${item.date}-${idx}`} item={item} />
      ))}
    </div>
  );
}
