"""
OpenAI LLM Client for TradeShape.

Centralized module for making LLM calls to analyze news and provide portfolio insights.
"""

import os
from typing import Optional
from pydantic import BaseModel
from .common.utils import format_error_response
from .config_loader import config_loader

# Initialize OpenAI client
openai_creds = config_loader.get_credentials('openai') or {}
_api_key = openai_creds.get('api_key') or os.getenv("OPENAI_API_KEY")
_client = None

if _api_key:
    try:
        from openai import OpenAI
        _client = OpenAI(api_key=_api_key)
        print("INFO [LLM]: OpenAI client initialized successfully")
    except Exception as e:
        print(f"WARN [LLM]: Failed to initialize OpenAI client: {e}")
else:
    print("WARN [LLM]: OPENAI_API_KEY not found in environment")


# Default configuration
DEFAULT_MODEL = "gpt-4o-mini"
DEFAULT_MAX_TOKENS = 300
DEFAULT_TEMPERATURE = 0.7
MAX_ARTICLES = 10


class NewsArticle(BaseModel):
    """Article data for LLM analysis."""
    headline: str
    body: Optional[str] = None


def _format_articles(articles: list[NewsArticle]) -> str:
    """Format articles with headline and full body as numbered list."""
    formatted = []
    for i, article in enumerate(articles[:MAX_ARTICLES], 1):
        if article.body:
            formatted.append(f"{i}. {article.headline}\n{article.body}")
        else:
            formatted.append(f"{i}. {article.headline}")
    return "\n\n".join(formatted)


def _call_openai(system_prompt: str, user_prompt: str, max_tokens: int = DEFAULT_MAX_TOKENS) -> dict:
    """
    Make an OpenAI chat completion call.
    
    Args:
        system_prompt: The system message for context
        user_prompt: The user message/question
        max_tokens: Maximum tokens in response
        
    Returns:
        Dict with 'summary' string or 'error' if failed
    """
    if not _client:
        return format_error_response("OpenAI API key not configured")
    
    try:
        response = _client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            max_tokens=max_tokens,
            temperature=DEFAULT_TEMPERATURE,
        )
        
        summary = response.choices[0].message.content.strip()
        return {"summary": summary}
        
    except Exception as e:
        print(f"ERROR [LLM]: API call failed: {e}")
        return format_error_response(str(e))


def analyze_market_news(articles: list[dict], tickers: list[str]) -> dict:
    """
    Analyze market news articles for portfolio impact.
    
    Args:
        articles: List of article dicts with headline and body
        tickers: List of ticker symbols in the portfolio
        
    Returns:
        Dict with 'summary' string or 'error' if failed
    """
    if not articles:
        return format_error_response("No articles provided")
    
    # Convert to NewsArticle objects
    news_articles = [NewsArticle(**a) if isinstance(a, dict) else a for a in articles]
    
    tickers_str = ", ".join(tickers) if tickers else "general market"
    articles_str = _format_articles(news_articles)
    
    system_prompt = "You are Matt Levine providing brief, actionable insights on how news affects stock portfolios. Be witty and direct."
    user_prompt = f"""Based on these news articles, what are the key market-moving insights for my investments ({tickers_str})? Give a summary in 150 words—and give advice on what to do.

Articles:
{articles_str}"""

    return _call_openai(system_prompt, user_prompt, max_tokens=300)


def analyze_ticker_news(articles: list[dict], ticker: str) -> dict:
    """
    Analyze news articles for a specific ticker.
    
    Args:
        articles: List of article dicts with headline and body
        ticker: Stock ticker symbol (e.g., "AAPL")
        
    Returns:
        Dict with 'summary' string or 'error' if failed
    """
    if not articles:
        return format_error_response("No articles provided")
    
    if not ticker:
        return format_error_response("No ticker provided")
    
    # Convert to NewsArticle objects
    news_articles = [NewsArticle(**a) if isinstance(a, dict) else a for a in articles]
    
    articles_str = _format_articles(news_articles)
    
    system_prompt = "You are Matt Levine providing brief, actionable insights on how news affects individual stocks. Be witty and direct about potential price impact."
    user_prompt = f"""Based on these news articles about {ticker.upper()}, what is the likely price impact? Give a summary in 150 words—and give advice on what to do.

Articles:
{articles_str}"""

    return _call_openai(system_prompt, user_prompt, max_tokens=300)


def analyze_8k_filings(filings: list[dict], ticker: str) -> dict:
    """
    Analyze recent 8-K filings for a specific ticker.

    Args:
        filings: List of dicts with filing_date, items (list of {code,title}), items_text
        ticker: Stock ticker symbol (e.g., "AAPL")

    Returns:
        Dict with 'summary' string or 'error' if failed
    """
    if not filings:
        return format_error_response("No filings provided")
    if not ticker:
        return format_error_response("No ticker provided")

    formatted = []
    for i, f in enumerate(filings[:MAX_ARTICLES], 1):
        items = f.get("items") or []
        item_str = ", ".join(f"Item {it.get('code')} ({it.get('title')})" for it in items) or "Unspecified"
        body = (f.get("items_text") or "").strip()
        if len(body) > 1500:
            body = body[:1500] + "…"
        formatted.append(f"{i}. {f.get('filing_date', '')} — {item_str}\n{body}")
    filings_str = "\n\n".join(formatted)

    system_prompt = "You are Matt Levine providing brief, actionable insights on how SEC 8-K disclosures affect individual stocks. Be witty, direct, and call out which items are mundane Reg FD vs genuinely material."
    user_prompt = f"""Based on these recent 8-K filings for {ticker.upper()}, what's the material signal and likely price impact? Highlight earnings, M&A, leadership changes, and material agreements; downweight Reg FD housekeeping. Give a summary in 150 words—and brief advice.

Filings:
{filings_str}"""

    return _call_openai(system_prompt, user_prompt, max_tokens=350)


# 10-K sections are long — keep the prompt input bounded. ~30k chars ≈ ~8k tokens.
MAX_10K_SECTION_CHARS = 30000


def analyze_10k_section(ticker: str, section: str, section_title: str, text: str, period_end: Optional[str] = None) -> dict:
    """
    Summarize a single 10-K section (e.g. Risk Factors, Business).

    Args:
        ticker: Stock ticker
        section: Section identifier (e.g. 'risk_factors')
        section_title: Display title (e.g. 'Risk Factors')
        text: Full section text
        period_end: Period end date of the filing for context
    """
    if not text:
        return format_error_response("No section text provided")
    if not ticker:
        return format_error_response("No ticker provided")

    truncated = text.strip()
    if len(truncated) > MAX_10K_SECTION_CHARS:
        truncated = truncated[:MAX_10K_SECTION_CHARS] + "\n\n…[truncated for length]"

    period_str = f" (period ending {period_end})" if period_end else ""

    if section == "risk_factors":
        instruction = (
            "Identify the top 5–7 most material risks. Group similar risks. "
            "Call out anything that looks new, unusual, or company-specific (as opposed to boilerplate language that every 10-K has). "
            "Format as a markdown bullet list with a one-line rationale per item."
        )
    elif section == "business":
        instruction = (
            "Summarize what the company does, its segments, key products/markets, and competitive positioning. "
            "Format as: a 2–3 sentence overview followed by a markdown bullet list of segments or business lines."
        )
    else:
        instruction = "Summarize the key points in a markdown bullet list of 5–7 items, with brief context."

    system_prompt = "You are an experienced equity analyst who turns dense SEC filings into the kind of crisp summary a portfolio manager would actually read."
    user_prompt = (
        f"Below is the '{section_title}' section from {ticker.upper()}'s most recent 10-K{period_str}.\n\n"
        f"{instruction}\n\n"
        f"--- BEGIN SECTION ---\n{truncated}\n--- END SECTION ---"
    )

    return _call_openai(system_prompt, user_prompt, max_tokens=600)
