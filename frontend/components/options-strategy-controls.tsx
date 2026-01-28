"use client";

import { useState, useEffect, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Position } from "@/lib/payoff-utils";
import { OptionsChain, OptionLeg, OptionQuote } from "@/lib/api-client";
import { formatExpiry } from "@/lib/options-utils";

interface OptionsStrategyControlsProps {
  ticker: string;
  currentPrice: number;
  positions: Position[];
  optionsChain: OptionsChain | null;
  onUpdateLegs: (legs: OptionLeg[]) => void;
}

export function OptionsStrategyControls({
  ticker,
  currentPrice,
  positions,
  optionsChain,
  onUpdateLegs
}: OptionsStrategyControlsProps) {
  const [strategy, setStrategy] = useState<"none" | "protective-put" | "bear-put" | "covered-call">("none");
  
  // Strategy Parameters
  const [expiryIndex, setExpiryIndex] = useState(0);
  const [protectionWidth, setProtectionWidth] = useState(10); // % below for bear put
  const [targetDelta, setTargetDelta] = useState(0.30); // for covered call
  
  // Reset expiry index when chain changes
  useEffect(() => {
    setExpiryIndex(0);
  }, [optionsChain?.symbol]);

  // Calculations
  const stockQty = useMemo(() => {
    const pos = positions.find(p => p.ticker === ticker && p.position_type === 'stock');
    return pos ? Math.abs(pos.qty) : 0;
  }, [positions, ticker]);

  const contractQty = Math.max(1, Math.floor(stockQty / 100));

  // Determine available expirations
  const expirations = optionsChain?.expirations || [];
  const selectedExpiry = expirations[expiryIndex] || "";

  // Effect to recalculate legs when params change
  useEffect(() => {
    if (!optionsChain || !selectedExpiry || !currentPrice) return;
    
    // If strategy is "none", we don't automatically generate legs.
    // However, we might want to CLEAR legs if the user explicitly clicked "None"?
    // Or just do nothing? 
    // Usually "None" implies "Manual Mode", so we shouldn't overwrite manual selections.
    // BUT the prompt says "strategy builder is not 'on', so nothing is selected".
    // This implies that on load (which defaults to none), nothing should be selected.
    
    if (strategy === "none") {
        // Do not touch legs to allow manual selection.
        // OR: Should we clear legs? 
        // If I switch from "Covered Call" to "None", I probably expect legs to clear?
        // Let's assume switching to "None" clears the STRATEGY's influence, but keeps manual edits.
        // Actually, the simplest interpretation is: don't call onUpdateLegs().
        return;
    }

    const legs: OptionLeg[] = [];
    const chainCalls = optionsChain.calls[selectedExpiry] || {};
    const chainPuts = optionsChain.puts[selectedExpiry] || {};
    const strikes = optionsChain.strikes;

    if (strategy === "protective-put") {
      // ... same logic ...
      const candidateStrikes = strikes.filter(s => s <= currentPrice).sort((a, b) => b - a);
      const strike = candidateStrikes[0] || strikes[0];
      
      if (strike) {
         legs.push({
           symbol: ticker,
           expiry: selectedExpiry,
           strike,
           right: "P",
           action: "BUY",
           quantity: contractQty
         });
      }
    } else if (strategy === "bear-put") {
      // ... same logic ...
      const candidateStrikes = strikes.filter(s => s <= currentPrice).sort((a, b) => b - a);
      const longStrike = candidateStrikes[0] || strikes[0];
      
      const targetShortPrice = currentPrice * (1 - protectionWidth / 100);
      const shortStrike = [...strikes].sort((a, b) => Math.abs(a - targetShortPrice) - Math.abs(b - targetShortPrice))[0];

      if (longStrike && shortStrike && longStrike !== shortStrike) {
         legs.push({
           symbol: ticker,
           expiry: selectedExpiry,
           strike: longStrike,
           right: "P",
           action: "BUY",
           quantity: contractQty
         });
         legs.push({
           symbol: ticker,
           expiry: selectedExpiry,
           strike: shortStrike,
           right: "P",
           action: "SELL",
           quantity: contractQty
         });
      }

    } else if (strategy === "covered-call") {
      // ... same logic ...
      let bestStrike = 0;
      let minDeltaDiff = 1;

      strikes.forEach(s => {
        const quote = chainCalls[s];
        if (quote && quote.delta !== null) {
          const diff = Math.abs(Math.abs(quote.delta) - targetDelta);
          if (diff < minDeltaDiff) {
            minDeltaDiff = diff;
            bestStrike = s;
          }
        }
      });
      
      if (bestStrike === 0) {
         bestStrike = strikes.find(s => s > currentPrice) || strikes[strikes.length - 1];
      }

      if (bestStrike) {
        legs.push({
          symbol: ticker,
          expiry: selectedExpiry,
          strike: bestStrike,
          right: "C",
          action: "SELL",
          quantity: contractQty
        });
      }
    }

    onUpdateLegs(legs);

  }, [strategy, expiryIndex, protectionWidth, targetDelta, optionsChain, selectedExpiry, currentPrice, ticker, contractQty, onUpdateLegs]);


  if (!optionsChain) return null;

  return (
    <Card className="bg-slate-900 border-white/10 mb-4">
      <CardContent className="pt-4">
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-orange-400 uppercase tracking-wider">Strategy Presets</h3>
                <span className="text-xs text-gray-400">
                    Stock Owned: {stockQty} ({contractQty} contracts)
                </span>
            </div>

            <Tabs value={strategy} onValueChange={(v: any) => setStrategy(v)} className="w-full">
                <TabsList className="bg-slate-950 border border-white/10 w-full justify-start overflow-x-auto">
                    <TabsTrigger value="none">Custom / Off</TabsTrigger>
                    <TabsTrigger value="protective-put">Protective Put</TabsTrigger>
                    <TabsTrigger value="bear-put">Partial Protection</TabsTrigger>
                    <TabsTrigger value="covered-call">Covered Call</TabsTrigger>
                </TabsList>
            </Tabs>

            <div className="grid gap-6 py-2">
                {/* Expiry Slider */}
                <div className="space-y-2">
                    <div className="flex justify-between">
                        <Label>Expiration</Label>
                        <span className="text-xs text-blue-400 font-mono">
                            {selectedExpiry ? formatExpiry(selectedExpiry) : "Select Expiry"}
                        </span>
                    </div>
                    {expirations.length > 0 && (
                        <Slider 
                            value={[expiryIndex]} 
                            min={0} 
                            max={expirations.length - 1} 
                            step={1} 
                            onValueChange={([v]) => setExpiryIndex(v)}
                            className="bg-white/10 rounded-full"
                        />
                    )}
                </div>

                {/* Strategy Specific Controls */}
                {strategy === "bear-put" && (
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>Protection Width</Label>
                            <span className="text-xs text-orange-400 font-mono">{protectionWidth}%</span>
                        </div>
                        <Slider 
                            value={[protectionWidth]} 
                            min={1} 
                            max={50} 
                            step={1} 
                            onValueChange={([v]) => setProtectionWidth(v)} 
                        />
                        <p className="text-[10px] text-gray-500">
                            Buy Put @ ATM, Sell Put @ {protectionWidth}% below.
                        </p>
                    </div>
                )}

                {strategy === "covered-call" && (
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>Target Delta</Label>
                            <span className="text-xs text-green-400 font-mono">{targetDelta.toFixed(2)}</span>
                        </div>
                         <Slider 
                            value={[targetDelta]} 
                            min={0.05} 
                            max={0.95} 
                            step={0.05} 
                            onValueChange={([v]) => setTargetDelta(v)} 
                        />
                         <p className="text-[10px] text-gray-500">
                            Sell Call with approx {targetDelta} Delta.
                        </p>
                    </div>
                )}
            </div>
        </div>
      </CardContent>
    </Card>
  );
}
