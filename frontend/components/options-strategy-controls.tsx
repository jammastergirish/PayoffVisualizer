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
  const [strategy, setStrategy] = useState<
    "none" | "protective-put" | "bear-put" | "covered-call" | 
    "collar" | "iron-condor" | "bull-call-spread" | "straddle-strangle" | "cash-secured-put"
  >("none");
  
  // Strategy Parameters
  const [expiryIndex, setExpiryIndex] = useState(0);
  
  // Param: Protective Put / Bear Put
  const [protectionWidth, setProtectionWidth] = useState(10); 
  
  // Param: Covered Call / Collar / Cash Put / Iron Condor (Short Delta)
  const [targetDelta, setTargetDelta] = useState(0.30);
  
  // Param: Iron Condor (Wing Width) / Straddle (Width) / Spreads (Width)
  const [strategyWidth, setStrategyWidth] = useState(10); // Generic "width" param %

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

  // Helper to find strike by delta
  const findStrikeByDelta = (strikes: number[], chainSide: Record<number, OptionQuote>, targetD: number) => {
    let bestStrike = 0;
    let minDiff = 1;
    
    strikes.forEach(s => {
      const quote = chainSide[s];
      if (quote && quote.delta !== null) {
        // Use absolute delta for comparison
        const diff = Math.abs(Math.abs(quote.delta) - Math.abs(targetD));
        if (diff < minDiff) {
          minDiff = diff;
          bestStrike = s;
        }
      }
    });
    return bestStrike;
  };
  
  // Helper to find closest strike to price
  const findClosestStrike = (strikes: number[], price: number) => {
    if (!strikes.length) return 0;
    return [...strikes].sort((a, b) => Math.abs(a - price) - Math.abs(b - price))[0];
  };

  // Effect to recalculate legs when params change
  useEffect(() => {
    if (!optionsChain || !selectedExpiry || !currentPrice) return;
    
    if (strategy === "none") return;

    const legs: OptionLeg[] = [];
    const chainCalls = optionsChain.calls[selectedExpiry] || {};
    const chainPuts = optionsChain.puts[selectedExpiry] || {};
    const strikes = optionsChain.strikes;

    // Common Helpers
    const buyLeg = (s: number, r: "C"|"P", q: number = contractQty) => s && legs.push({ symbol: ticker, expiry: selectedExpiry, strike: s, right: r, action: "BUY", quantity: q });
    const sellLeg = (s: number, r: "C"|"P", q: number = contractQty) => s && legs.push({ symbol: ticker, expiry: selectedExpiry, strike: s, right: r, action: "SELL", quantity: q });


    if (strategy === "protective-put") {
      // Buy 1 Put just below current price
      const candidateStrikes = strikes.filter(s => s <= currentPrice).sort((a, b) => b - a);
      const strike = candidateStrikes[0] || strikes[0];
      buyLeg(strike, "P");

    } else if (strategy === "bear-put") {
      // Long Put ATM, Short Put OTM
      const candidateStrikes = strikes.filter(s => s <= currentPrice).sort((a, b) => b - a);
      const longStrike = candidateStrikes[0] || strikes[0];
      
      const targetShortPrice = currentPrice * (1 - protectionWidth / 100);
      const shortStrike = [...strikes].sort((a, b) => Math.abs(a - targetShortPrice) - Math.abs(b - targetShortPrice))[0];
      
      if (longStrike && shortStrike && longStrike !== shortStrike) {
        buyLeg(longStrike, "P");
        sellLeg(shortStrike, "P");
      }

    } else if (strategy === "covered-call") {
      // Sell Call @ Delta
      const strike = findStrikeByDelta(strikes, chainCalls, targetDelta);
      const fallbackStrike = strikes.find(s => s > currentPrice) || strikes[strikes.length-1];
      sellLeg(strike || fallbackStrike, "C");

    } else if (strategy === "cash-secured-put") {
        // Sell Put @ Probability (Delta)
        const putDelta = 1 - targetDelta; 
        const strike = findStrikeByDelta(strikes, chainPuts, putDelta);
        const fallbackStrike = strikes.find(s => s < currentPrice) || strikes[0];
        sellLeg(strike || fallbackStrike, "P");
    
    } else if (strategy === "collar") {
        // Buy Put (ATM/OTM), Sell Call (OTM)
        // Put: standard protective (ATM)
        const putStrikes = strikes.filter(s => s <= currentPrice).sort((a, b) => b - a);
        const putStrike = putStrikes[0] || strikes[0];
        buyLeg(putStrike, "P");
        
        // Call: Sell @ Delta (Upside Cap)
        const callStrike = findStrikeByDelta(strikes, chainCalls, targetDelta);
        const fallbackCall = strikes.find(s => s > currentPrice) || strikes[strikes.length-1];
        sellLeg(callStrike || fallbackCall, "C");

    } else if (strategy === "bull-call-spread") {
        // Buy Call ATM, Sell Call OTM
        // Buy ATM
        const atmStrike = findClosestStrike(strikes, currentPrice);
        buyLeg(atmStrike, "C");
        
        // Sell OTM (Width % higher)
        const targetSell = atmStrike * (1 + strategyWidth / 100);
        const sellStrike = findClosestStrike(strikes, targetSell);
        if (sellStrike !== atmStrike) {
            sellLeg(sellStrike, "C");
        }

    } else if (strategy === "straddle-strangle") {
        // Buy Call + Buy Put
        // Center: Closest to price
        // Width: % away from center. 0 = Straddle
        const center = currentPrice;
        const callTarget = center * (1 + strategyWidth / 100);
        const putTarget = center * (1 - strategyWidth / 100);
        
        const callStrike = findClosestStrike(strikes, callTarget);
        const putStrike = findClosestStrike(strikes, putTarget);
        
        buyLeg(callStrike, "C", 1); 
        buyLeg(putStrike, "P", 1);

    } else if (strategy === "iron-condor") {
        // Sell wings (Short Strangle), Buy further wings (Long Strangle)
        const shortDelta = targetDelta; // e.g. 0.20
        const wingDistPct = strategyWidth / 100; // e.g. 10%
        
        // Call Side
        const shortCallStrike = findStrikeByDelta(strikes, chainCalls, shortDelta);
        const longCallTarget = shortCallStrike * (1 + wingDistPct);
        const longCallStrike = findClosestStrike(strikes, longCallTarget);
        
        // Put Side
        const shortPutStrike = findStrikeByDelta(strikes, chainPuts, shortDelta);
        const longPutTarget = shortPutStrike * (1 - wingDistPct);
        const longPutStrike = findClosestStrike(strikes, longPutTarget);
        
        if (shortCallStrike && longCallStrike && shortPutStrike && longPutStrike) {
             sellLeg(shortPutStrike, "P", 1);
             buyLeg(longPutStrike, "P", 1);
             sellLeg(shortCallStrike, "C", 1);
             buyLeg(longCallStrike, "C", 1);
        }
    }

    onUpdateLegs(legs);

  }, [strategy, expiryIndex, protectionWidth, targetDelta, strategyWidth, optionsChain, selectedExpiry, currentPrice, ticker, contractQty, onUpdateLegs]);


  if (!optionsChain) return null;

  return (
    <Card className="bg-slate-900 border-white/10 mb-4">
      <CardContent className="pt-4">
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-orange-400 uppercase tracking-wider">Strategy Presets</h3>
                <span className="text-xs text-gray-400">
                    {["protective-put", "bear-put", "covered-call", "collar"].includes(strategy) 
                        ? `Hedging: ${stockQty} shares (${contractQty} contracts)`
                        : `Speculative: 1 Contract`
                    }
                </span>
            </div>

            <Tabs value={strategy} onValueChange={(v: any) => setStrategy(v)} className="w-full">
                <TabsList className="bg-slate-950 border border-white/10 w-full justify-start overflow-x-auto h-auto flex-wrap gap-y-1">
                    <TabsTrigger value="none">Custom</TabsTrigger>
                    <TabsTrigger value="protective-put">Prot Put</TabsTrigger>
                    <TabsTrigger value="bear-put">Bear Put</TabsTrigger>
                    <TabsTrigger value="covered-call">Cov Call</TabsTrigger>
                    <TabsTrigger value="collar">Collar</TabsTrigger>
                    <TabsTrigger value="cash-secured-put">Cash Put</TabsTrigger>
                    <TabsTrigger value="bull-call-spread">Bull Spread</TabsTrigger>
                    <TabsTrigger value="iron-condor">Iron Condor</TabsTrigger>
                    <TabsTrigger value="straddle-strangle">Straddle</TabsTrigger>
                </TabsList>
            </Tabs>

            <div className={`grid gap-6 py-2 transition-opacity duration-200 ${strategy === 'none' ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                {/* Expiration Slider - Hide on None */}
                {strategy !== 'none' && (
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
                )}

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
                
                {strategy === "bull-call-spread" && (
                     <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>Spread Width</Label>
                            <span className="text-xs text-green-400 font-mono">{strategyWidth}%</span>
                        </div>
                        <Slider 
                            value={[strategyWidth]} 
                            min={1} 
                            max={30} 
                            step={1} 
                            onValueChange={([v]) => setStrategyWidth(v)} 
                        />
                        <p className="text-[10px] text-gray-500">
                            Buy Call @ ATM, Sell Call {strategyWidth}% higher.
                        </p>
                    </div>
                )}

                {strategy === "straddle-strangle" && (
                     <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>Strangle Width (0% = Straddle)</Label>
                            <span className="text-xs text-blue-400 font-mono">+/- {strategyWidth}%</span>
                        </div>
                        <Slider 
                            value={[strategyWidth]} 
                            min={0} 
                            max={20} 
                            step={1} 
                            onValueChange={([v]) => setStrategyWidth(v)} 
                        />
                        <p className="text-[10px] text-gray-500">
                            Buy Call & Put {strategyWidth > 0 ? `${strategyWidth}% OTM` : 'ATM'}.
                        </p>
                    </div>
                )}

                {(strategy === "covered-call" || strategy === "collar") && (
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>Call Target Delta (Upside Cap)</Label>
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
                
                {strategy === "cash-secured-put" && (
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>Probability of Profit</Label>
                            <span className="text-xs text-green-400 font-mono">{(targetDelta * 100).toFixed(0)}%</span>
                        </div>
                         <Slider 
                            value={[targetDelta]} 
                            min={0.50} 
                            max={0.95} 
                            step={0.05} 
                            onValueChange={([v]) => setTargetDelta(v)} 
                        />
                        <div className="flex justify-between text-[10px] text-gray-500">
                            <span>More Aggressive</span>
                            <span>More Conservative</span>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1">
                            Sells a Put with {((1 - targetDelta) * 100).toFixed(0)} Delta.
                        </p>
                    </div>
                )}
                
                {strategy === "iron-condor" && (
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <Label>Short Delta</Label>
                                <span className="text-xs text-red-400 font-mono">{targetDelta.toFixed(2)}</span>
                            </div>
                            <Slider 
                                value={[targetDelta]} 
                                min={0.05} 
                                max={0.40} 
                                step={0.05} 
                                onValueChange={([v]) => setTargetDelta(v)} 
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <Label>Wing Width</Label>
                                <span className="text-xs text-blue-400 font-mono">{strategyWidth}%</span>
                            </div>
                            <Slider 
                                value={[strategyWidth]} 
                                min={1} 
                                max={20} 
                                step={1} 
                                onValueChange={([v]) => setStrategyWidth(v)} 
                            />
                        </div>
                        <p className="col-span-2 text-[10px] text-gray-500">
                            Sell {targetDelta} Delta Strangle, Buy wings {strategyWidth}% further out.
                        </p>
                    </div>
                )}

            </div>
        </div>
      </CardContent>
    </Card>
  );
}
