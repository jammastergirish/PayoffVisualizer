
import { render, screen } from "@testing-library/react";
import { MarkdownDisplay } from "../components/markdown-display";
import React from "react";
import { vi, describe, it, expect } from "vitest";

// Mock ReactMarkdown since we only want to test the pre-processing logic
// and that it renders eventually.
vi.mock("react-markdown", () => ({
    __esModule: true,
    default: ({ children }: { children: string }) => <div data-testid="markdown-content">{children}</div>,
}));

describe("MarkdownDisplay", () => {
    it("converts single newlines to double newlines", () => {
        const input = "Line 1\nLine 2";
        render(<MarkdownDisplay content={input} />);
        
        const content = screen.getByTestId("markdown-content");
        expect(content.textContent).toBe("Line 1\n\nLine 2");
    });

    it("converts carriage returns to double newlines", () => {
        const input = "Line 1\rLine 2";
        render(<MarkdownDisplay content={input} />);
        
        const content = screen.getByTestId("markdown-content");
        expect(content.textContent).toBe("Line 1\n\nLine 2");
    });

    it("converts CRLF to double newlines", () => {
        const input = "Line 1\r\nLine 2";
        render(<MarkdownDisplay content={input} />);
        
        const content = screen.getByTestId("markdown-content");
        expect(content.textContent).toBe("Line 1\n\nLine 2");
    });

    it("handles multiple newlines gracefully", () => {
        // If there are already double newlines, our global replace makes them quad newlines.
        // Markdown renderers usually treat 2+ newlines as 1 paragraph break anyway, 
        // so excessive formatting isn't typically breaking, but let's verify behavior.
        const input = "Line 1\n\nLine 2";
        render(<MarkdownDisplay content={input} />);
        
        const content = screen.getByTestId("markdown-content");
        // Our regex /.../g replaces each \n with \n\n.
        // So \n\n becomes \n\n\n\n.
        expect(content.textContent).toBe("Line 1\n\n\n\nLine 2");
    });

    it("renders nothing if content is empty", () => {
        const { container } = render(<MarkdownDisplay content="" />);
        expect(container.innerHTML).toBe("");
    });
});
