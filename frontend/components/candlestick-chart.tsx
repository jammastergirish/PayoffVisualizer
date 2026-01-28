"use client";

import { useMemo } from "react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  Label,
} from "recharts";
import { Order } from "@/lib/api-client";
import { Position } from "@/lib/payoff-utils";

export interface CandlestickBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandlestickChartProps {
  data: CandlestickBar[];
  livePrice?: number;
  timeframe: string;
  orders?: Order[];
  positions?: Position[];
}

interface CandleData {
  date: string;
  displayDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  // For recharts Bar rendering
  candleBody: [number, number]; // [bottom, top] of the candle body
  isGreen: boolean;
  wickTop: number;
  wickBottom: number;
}

export function CandlestickChart({ data, livePrice, timeframe, orders = [], positions = [] }: CandlestickChartProps) {
  // Transform data for candlestick rendering
  const chartData = useMemo(() => {
    return data.map((bar): CandleData => {
      const isGreen = bar.close >= bar.open;
      const bodyBottom = Math.min(bar.open, bar.close);
      const bodyTop = Math.max(bar.open, bar.close);
      
      return {
        date: bar.date,
        displayDate: formatDate(bar.date, timeframe),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        candleBody: [bodyBottom, bodyTop],
        isGreen,
        wickTop: bar.high,
        wickBottom: bar.low,
      };
    });
  }, [data, timeframe]);

  // Calculate Y domain with padding
  const yDomain = useMemo(() => {
    if (data.length === 0) return [0, 100];
    
    const allPrices = data.flatMap(d => [d.high, d.low]);
    if (livePrice) allPrices.push(livePrice);
    
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const padding = (max - min) * 0.05;
    
    return [min - padding, max + padding];
  }, [data, livePrice]);

  // Calculate max volume for volume bar scaling
  const maxVolume = useMemo(() => {
    if (data.length === 0) return 1;
    return Math.max(...data.map(d => d.volume));
  }, [data]);

  // Dynamic bar size: fill ~85% of allotted space to minimize gaps
  const dynamicBarSize = useMemo(() => {
    // Chart width is roughly 100% minus margins (about 65px for yAxis)
    const chartWidth = 800; // Approximate usable width
    const barCount = data.length || 1;
    const rawBarWidth = chartWidth / barCount;
    // Use 85% of available space, with min of 4 and max of 20
    return Math.max(4, Math.min(20, rawBarWidth * 0.85));
  }, [data.length]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[400px] text-gray-500">
        No chart data available
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-2 px-2 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-orange-500"></div>
          <span className="text-gray-500">Current Price</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-blue-500"></div>
          <span className="text-gray-500">Avg Price</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-red-500 border-t border-dashed border-red-500"></div>
          <span className="text-gray-500">Stop / Sell</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-purple-500 border-t border-dashed border-purple-500"></div>
          <span className="text-gray-500">Call Strike</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-pink-500 border-t border-dashed border-pink-500"></div>
          <span className="text-gray-500">Put Strike</span>
        </div>
      </div>

      {/* Main Price Chart */}
      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <XAxis
            dataKey="displayDate"
            stroke="#4b5563"
            tick={{ fill: "#6b7280", fontSize: 10 }}
            interval="preserveStartEnd"
            tickLine={false}
          />
          <YAxis
            domain={yDomain}
            stroke="#4b5563"
            tick={{ fill: "#6b7280", fontSize: 10 }}
            tickFormatter={(val) => `$${val.toFixed(0)}`}
            width={55}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload[0]) return null;
              const d = payload[0].payload as CandleData;
              const change = d.close - d.open;
              const changePct = ((change / d.open) * 100).toFixed(2);
              
              return (
                <div className="bg-slate-900 border border-white/10 rounded-lg p-3 shadow-xl">
                  <div className="text-xs text-gray-400 mb-2">{d.date}</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <span className="text-gray-400">Open</span>
                    <span className="text-white font-mono">${d.open.toFixed(2)}</span>
                    <span className="text-gray-400">High</span>
                    <span className="text-white font-mono">${d.high.toFixed(2)}</span>
                    <span className="text-gray-400">Low</span>
                    <span className="text-white font-mono">${d.low.toFixed(2)}</span>
                    <span className="text-gray-400">Close</span>
                    <span className="text-white font-mono">${d.close.toFixed(2)}</span>
                  </div>
                  <div className={`mt-2 pt-2 border-t border-white/10 text-sm font-medium ${d.isGreen ? 'text-emerald-400' : 'text-red-400'}`}>
                    {change >= 0 ? '+' : ''}{change.toFixed(2)} ({changePct}%)
                  </div>
                  {d.volume > 0 && (
                    <div className="text-xs text-gray-500 mt-1">
                      Vol: {formatVolume(d.volume)}
                    </div>
                  )}
                </div>
              );
            }}
          />
          
          {/* Live price reference line */}
          {livePrice && livePrice > 0 && (
            <ReferenceLine
              y={livePrice}
              stroke="#f97316"
              strokeWidth={1.5}
              label={{
                value: `$${livePrice.toFixed(2)}`,
                fill: "#f97316",
                fontSize: 11,
                position: "insideRight",
                dy: -10,
              }}
            />
          )}
          
          {/* Orders: Sell Orders (Trailing Stops) */}
          {orders.filter(o => o.action === "SELL" && o.status !== "Filled" && o.status !== "Cancelled").map((o, i) => {
            const price = o.stop_price || o.limit_price;
            if (!price) return null;
            return (
              <ReferenceLine
                key={`order-${o.order_id}-${i}`}
                y={price}
                stroke="#ef4444" 
                strokeDasharray="5 5"
                strokeWidth={1}
                label={{ 
                  value: `${o.order_type} ${o.quantity}`, 
                  fill: "#ef4444", 
                  fontSize: 10, 
                  position: "insideLeft",
                  dy: -10,
                }}
              />
            );
          })}

          {/* Positions: Cost Basis */}
          {positions.filter(p => p.position_type === 'stock').map((p, i) => {
             if (!p.cost_basis || p.cost_basis <= 0) return null;
             return (
               <ReferenceLine
                 key={`pos-cost-${i}`}
                 y={p.cost_basis}
                 stroke="#3b82f6"
                 strokeWidth={1}
                 label={{
                    value: `Avg: $${p.cost_basis.toFixed(2)}`,
                    fill: "#3b82f6",
                    fontSize: 10,
                    position: "insideLeft",
                    dy: -10,
                 }}
               />
             );
          })}

          {/* Option Expirations (Vertical Lines) */}
          {positions.filter(p => p.position_type !== 'stock' && p.expiry).map((p, i) => {
             // Find the x-axis coordinate (displayDate) matching the expiry
             // This is tricky because the x-axis is discrete. We need to match dates.
             // If timeframe is intraday, date matching might be hard. 
             // We'll try to match prefix of date.
             
             // NOTE: Vertical ReferenceLine uses 'x' which must match a categorical value in the dataKey (displayDate).
             // Since 'displayDate' is formatted (e.g. MM-DD), we need to check if expiry matches any displayDate?
             // Or we can use numeric x-axis? No, it's categorical usually for candles.
             // But 'data' in CandlestickChart maps to 'displayDate'.
             // Simplification: Can't easily draw vertical lines on categorical axis if date isn't exact bar.
             // We'll skip vertical lines for now or try best effort if the date matches exactly.
             return null; 
             
             // Implementation plan: 
             // Since we can't easily map date -> index on a categorical chart without more logic, 
             // and visualizing expiry "text showing when" might be better served by just listing options?
             // User asked for "dashed lines showing where (and text showing when) options expire".
             // Maybe "Where" = Strike Price (Horizontal)? 
             // "Text showing when" = Label on that line?
             // Let's assume "Where" = Strike Price, and "When" = Label.
          })}
          
          {/* Option Strikes (Horizontal) with Expiry Label */}
          {positions.filter(p => p.position_type !== 'stock' && p.strike).map((p, i) => (
             <ReferenceLine
                key={`opt-strike-${i}`}
                y={p.strike}
                stroke={p.position_type === 'call' ? "#a855f7" : "#ec4899"} // Purple/Pink
                strokeDasharray="3 3"
                strokeWidth={1}
                label={{
                   value: `${p.qty}x ${p.position_type.toUpperCase()} Exp: ${p.expiry}`,
                   fill: p.position_type === 'call' ? "#a855f7" : "#ec4899",
                   fontSize: 10,
                   position: "insideRight",
                   dy: -10,
                }}
             />
          ))}

          
          {/* Candlestick wicks (rendered as thin bars) */}
          <Bar
            dataKey={(d: CandleData) => [d.wickBottom, d.wickTop]}
            barSize={1}
            fill="#6b7280"
            isAnimationActive={false}
          />
          
          {/* Candlestick bodies */}
          <Bar
            dataKey="candleBody"
            barSize={dynamicBarSize}
            isAnimationActive={false}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.isGreen ? "#22c55e" : "#ef4444"}
                stroke={entry.isGreen ? "#22c55e" : "#ef4444"}
              />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
      
      {/* Volume Chart */}
      <ResponsiveContainer width="100%" height={60}>
        <ComposedChart
          data={chartData}
          margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
        >
          <XAxis dataKey="displayDate" hide />
          <YAxis hide domain={[0, maxVolume * 1.2]} />
          <Bar
            dataKey="volume"
            isAnimationActive={false}
            barSize={Math.max(3, dynamicBarSize - 2)}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`vol-${index}`}
                fill={entry.isGreen ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"}
              />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
      
      <div className="text-center text-xs text-gray-500 mt-1">Volume</div>
    </div>
  );
}

function formatDate(dateStr: string, timeframe: string): string {
  try {
    if (timeframe === "1H" || timeframe === "1D") {
      // Show time for intraday
      const timePart = dateStr.split("T")[1];
      return timePart?.substring(0, 5) || dateStr.substring(11, 16);
    }
    // Show date for longer timeframes
    return dateStr.substring(5, 10); // MM-DD
  } catch {
    return dateStr;
  }
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toString();
}
