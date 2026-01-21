import { useRef } from "react";

interface TickerDisplayProps {
  symbol: string;
  iconUrl?: string | null;
  className?: string;
  showSymbol?: boolean;
}

export function TickerDisplay({ symbol, iconUrl, className = "", showSymbol = true }: TickerDisplayProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="w-6 h-6 flex-shrink-0 rounded bg-white/10 overflow-hidden">
        {iconUrl ? (
          <img 
            src={iconUrl}
            alt={symbol}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600 text-[10px] font-bold">
            {symbol.slice(0, 2)}
          </div>
        )}
      </div>
      {showSymbol && <span className="font-medium text-white">{symbol}</span>}
    </div>
  );
}
