"""Configuration loader for .env-based credentials."""

import os
from typing import Dict, Any, Optional
from dotenv import load_dotenv


class ConfigLoader:
    """Loads provider selection and credentials from environment variables."""

    def __init__(self):
        load_dotenv()
        self.config: Dict[str, Any] = {
            'providers': {
                'brokerage': os.getenv('BROKERAGE_PROVIDER', 'ibkr'),
                'data': os.getenv('DATA_PROVIDER', 'massive'),
                'news': os.getenv('NEWS_PROVIDER', 'massive'),
            },
            'credentials': {},
        }

        if os.getenv('MASSIVE_API_KEY'):
            self.config['credentials']['massive'] = {
                'api_key': os.getenv('MASSIVE_API_KEY'),
            }

        if os.getenv('ALPACA_API_KEY'):
            self.config['credentials']['alpaca'] = {
                'api_key': os.getenv('ALPACA_API_KEY'),
                'api_secret': os.getenv('ALPACA_API_SECRET', ''),
                'paper': os.getenv('ALPACA_PAPER', 'true').lower() == 'true',
            }

        if os.getenv('OPENAI_API_KEY'):
            self.config['credentials']['openai'] = {
                'api_key': os.getenv('OPENAI_API_KEY'),
            }

    def get_config(self) -> Dict[str, Any]:
        return self.config

    def get_providers(self) -> Dict[str, str]:
        return self.config.get('providers', {})

    def get_credentials(self, provider: str) -> Optional[Dict[str, Any]]:
        return self.config.get('credentials', {}).get(provider)


config_loader = ConfigLoader()
