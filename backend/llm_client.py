"""
OpenAI LLM Client for TradeShape.

Centralized module for making LLM calls to analyze news and provide portfolio insights.
"""

import os
from typing import Optional
from pydantic import BaseModel
from dotenv import load_dotenv
from .common.utils import format_error_response

load_dotenv()

# Initialize OpenAI client
_api_key = os.getenv("OPENAI_API_KEY")
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
