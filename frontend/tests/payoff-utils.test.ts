import { afterEach, describe, expect, it, vi } from "vitest";
import Papa from "papaparse";
import {
  analyzeRiskReward,
  calculateDte,
  calculateMaxRiskReward,
  calculatePnl,
  cleanNumber,
  findColumn,

  getPriceRange,
  parseFinancialInstrument,
  parsePositionsFromRows,
} from "../lib/payoff-utils";

describe("cleanNumber", () => {
  it("parses common IBKR numeric formats", () => {
    expect(cleanNumber("(1,234.56)")).toBeCloseTo(-1234.56);
    expect(cleanNumber("$5,678")).toBe(5678);
    expect(cleanNumber("C4.39")).toBeCloseTo(4.39);
    expect(cleanNumber("P0.26")).toBeCloseTo(0.26);
    expect(cleanNumber("'-189,652")).toBe(-189652);
    expect(cleanNumber("")).toBe(0);
  });
});

describe("parseFinancialInstrument", () => {
  it("parses option symbols with expiry and strike", () => {
    const parsed = parseFinancialInstrument("IREN Jan30'26 40 CALL");
    expect(parsed).toEqual({
      ticker: "IREN",
      type: "call",
      strike: 40,
      expiry: "2026-01-30",
    });
  });

  it("treats plain tickers as stock", () => {
    const parsed = parseFinancialInstrument("MU");
    expect(parsed).toEqual({ ticker: "MU", type: "stock" });
  });
});

describe("findColumn", () => {
  it("matches case-insensitive and trimmed headers", () => {
    const row = {
      " Financial Instrument ": "MU",
      "Prob. of Profit": "55",
    };
    expect(findColumn(row, "Financial Instrument")).toBe(" Financial Instrument ");
    expect(findColumn(row, "prob. of profit")).toBe("Prob. of Profit");
    expect(findColumn(row, "profit")).toBe("Prob. of Profit");
  });
});

describe("calculatePnl", () => {
  it("calculates stock P&L for long and short positions", () => {
    const longPnl = calculatePnl(
      [{ ticker: "AAPL", position_type: "stock", qty: 100, cost_basis: 150 }],
      [140, 160],
    );
    expect(longPnl[0]).toBe(-1000);
    expect(longPnl[1]).toBe(1000);

    const shortPnl = calculatePnl(
      [{ ticker: "AAPL", position_type: "stock", qty: -100, cost_basis: 150 }],
      [140, 160],
    );
    expect(shortPnl[0]).toBe(1000);
    expect(shortPnl[1]).toBe(-1000);
  });

  it("calculates option P&L with the contract multiplier", () => {
    const callPnl = calculatePnl(
      [{ ticker: "AAPL", position_type: "call", qty: 1, strike: 100, cost_basis: 2.5 }],
      [90, 110],
    );
    expect(callPnl[0]).toBeCloseTo(-250);
    expect(callPnl[1]).toBeCloseTo(750);

    const putPnl = calculatePnl(
      [{ ticker: "AAPL", position_type: "put", qty: -2, strike: 50, cost_basis: 1 }],
      [40, 60],
    );
    expect(putPnl[0]).toBeCloseTo(-1800);
    expect(putPnl[1]).toBeCloseTo(200);
  });
});

describe("analyzeRiskReward", () => {
  it("returns max profit and max loss from P&L values", () => {
    const result = analyzeRiskReward([10, -5, 25, 0]);
    expect(result).toEqual({ maxProfit: 25, maxLoss: -5 });
  });
});



describe("getPriceRange", () => {
  it("returns 200 points for stock-only positions", () => {
    const range = getPriceRange(
      [{ ticker: "AAPL", position_type: "stock", qty: 10, cost_basis: 100 }],
      200
    );
    expect(range).toHaveLength(200);
    expect(range[0]).toBeCloseTo(140);
    expect(range[199]).toBeCloseTo(260);
  });

  it("expands range using option strikes when present", () => {
    const range = getPriceRange(
      [
        { ticker: "AAPL", position_type: "call", qty: 1, strike: 100, cost_basis: 2 },
        { ticker: "AAPL", position_type: "put", qty: -1, strike: 150, cost_basis: 3 },
      ],
      120
    );
    expect(range).toHaveLength(200);
    expect(range[0]).toBeCloseTo(80);
    expect(range[199]).toBeCloseTo(180);
  });
});

describe("calculateMaxRiskReward", () => {
  it("handles long stock correctly", () => {
    const { maxProfit, maxLoss } = calculateMaxRiskReward([
      { ticker: "AAPL", position_type: "stock", qty: 100, cost_basis: 150 },
    ]);
    expect(maxProfit).toBe(Infinity);
    expect(maxLoss).toBeCloseTo(-15000);
  });

  it("handles short calls correctly", () => {
    const { maxProfit, maxLoss } = calculateMaxRiskReward([
      { ticker: "AAPL", position_type: "call", qty: -1, strike: 150, cost_basis: 5 },
    ]);
    expect(maxProfit).toBeCloseTo(500);
    expect(maxLoss).toBe(-Infinity);
  });

  it("handles bull call spreads correctly", () => {
    const { maxProfit, maxLoss } = calculateMaxRiskReward([
      { ticker: "AAPL", position_type: "call", qty: 1, strike: 100, cost_basis: 5 },
      { ticker: "AAPL", position_type: "call", qty: -1, strike: 110, cost_basis: 2 },
    ]);
    expect(maxProfit).toBeCloseTo(700);
    expect(maxLoss).toBeCloseTo(-300);
  });

  it("handles long puts correctly", () => {
    const { maxProfit, maxLoss } = calculateMaxRiskReward([
      { ticker: "AAPL", position_type: "put", qty: 1, strike: 100, cost_basis: 4 },
    ]);
    expect(maxProfit).toBeCloseTo(9600);
    expect(maxLoss).toBeCloseTo(-400);
  });
});

describe("calculateDte", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts whole days based on local dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 15, 15, 30));

    expect(calculateDte("2025-01-16")).toBe(1);
    expect(calculateDte("2025-01-15")).toBe(0);
    expect(calculateDte("2025-01-14")).toBe(0);
  });
});

describe("parsePositionsFromRows", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses stock and option rows with prices and metrics", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));

    const rows = [
      {
        "Financial Instrument ": "MU",
        Position: "400",
        Last: "324.59",
        "Cost Basis": "105,053",
        "Unrealized P&L": "24,767",
      },
      {
        "Financial Instrument": "IREN Jan30'26 40 CALL",
        Position: "12",
        "Underlying Price": "38.5",
        "Cost Basis": "4,424",
        "Unrealized P&L": "2,507",
        Delta: "0.651",
        Gamma: "0.033",
        Theta: "-0.076",
        Vega: "0.043",
        "Implied Vol.": "34.5",
        "Prob. of Profit": "55",
      },
    ] as Record<string, unknown>[];

    const { positions, prices } = parsePositionsFromRows(rows);

    expect(positions).toHaveLength(2);
    expect(prices.MU).toBeCloseTo(324.59);
    expect(prices.IREN).toBeCloseTo(38.5);

    expect(positions[0].position_type).toBe("stock");
    expect(positions[0].cost_basis).toBeCloseTo(262.6325);
    expect(positions[0].unrealized_pnl).toBeCloseTo(24767);

    expect(positions[1].position_type).toBe("call");
    expect(positions[1].strike).toBe(40);
    expect(positions[1].expiry).toBe("2026-01-30");
    expect(positions[1].dte).toBe(29);
    expect(positions[1].cost_basis).toBeCloseTo(3.6867, 4);
    expect(positions[1].delta).toBeCloseTo(0.651);
    expect(positions[1].iv).toBeCloseTo(34.5);
  });
});

describe("CSV integration pipeline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses CSV and produces payoff stats", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 8, 0, 0));

    const csv = [
      "Financial Instrument,Position,Last,Cost Basis,Underlying Price,Unrealized P&L",
      "ACME,100,100,10000,,0",
      "ACME Jan30'26 100 CALL,1,2,200,100,0",
    ].join("\n");

    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    const { positions, prices } = parsePositionsFromRows(
      parsed.data as Record<string, unknown>[]
    );

    expect(positions).toHaveLength(2);
    expect(prices.ACME).toBeCloseTo(100);

    const currentPrice = prices.ACME;
    const range = getPriceRange(positions, currentPrice);
    const pnl = calculatePnl(positions, range);
    const stats = calculateMaxRiskReward(positions);

    expect(stats.maxProfit).toBe(Infinity);
    expect(stats.maxLoss).toBeCloseTo(-10200);
  });
});
