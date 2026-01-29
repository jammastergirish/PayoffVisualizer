import { render, screen, fireEvent } from "@testing-library/react";
import { InsightCard } from "../components/analyst-insights";
import { AnalystInsight } from "../lib/api-client";
import React from "react";
import { vi, describe, it, expect } from "vitest";

// Mock markdown display to simplify output checking
vi.mock("../components/markdown-display", () => ({
    MarkdownDisplay: ({ content }: { content: string }) => <div data-testid="markdown-content">{content}</div>
}));

describe("InsightCard", () => {
    const mockInsight: AnalystInsight = {
        firm: "Goldman Sachs",
        rating: "Buy",
        rating_action: "Upgrade",
        price_target: 200,
        date: "2026-01-29",
        insight: "Very bullish outlook.",
        company_name: "Apple Inc.",
        ticker: "AAPL"
    };

    it("renders basic info initially (summary view)", () => {
        render(<InsightCard item={mockInsight} />);
        
        expect(screen.getByText("Goldman Sachs")).toBeDefined();
        expect(screen.getByText("Upgrade Buy")).toBeDefined();
        expect(screen.getByText("$200")).toBeDefined();
        
        // Content should NOT be visible yet
        expect(screen.queryByTestId("markdown-content")).toBeNull();
    });

    it("expands to show content when clicked", async () => {
        const { container } = render(<InsightCard item={mockInsight} />);
        
        // Find the clickable header (CardHeader usually adds a div wrapper)
        // We can target the text or just the first child div which likely corresponds to header
        // Using fireEvent.click on the text usually bubbles up
        fireEvent.click(screen.getByText("Goldman Sachs"));

        // Content should now be visible
        expect(screen.getByTestId("markdown-content")).toBeDefined();
        expect(screen.getByText("Very bullish outlook.")).toBeDefined();
    });

    it("collapses when clicked again", () => {
        render(<InsightCard item={mockInsight} />);
        
        const trigger = screen.getByText("Goldman Sachs");
        
        // Open
        fireEvent.click(trigger);
        expect(screen.queryByTestId("markdown-content")).not.toBeNull();
        
        // Close
        fireEvent.click(trigger);
        expect(screen.queryByTestId("markdown-content")).toBeNull();
    });
});
