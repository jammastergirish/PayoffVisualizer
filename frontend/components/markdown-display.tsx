import React from "react";
import ReactMarkdown from "react-markdown";
import { cn } from "../lib/utils";

interface MarkdownDisplayProps {
  content: string;
  className?: string;
}

export function MarkdownDisplay({ content, className }: MarkdownDisplayProps) {
  if (!content) return null;

  // Replace single newlines (or CR/CRLF) with double newlines
  // to ensure Markdown renders them as distinct paragraphs.
  const processedContent = content.replace(/(\r\n|\r|\n)/g, "\n\n");

  return (
    <div className={cn("prose prose-invert prose-sm max-w-none [&>p]:mb-4 leading-relaxed text-gray-300", className)}>
      <ReactMarkdown>{processedContent}</ReactMarkdown>
    </div>
  );
}
