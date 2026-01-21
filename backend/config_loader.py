"""Configuration loader that handles both .env and credentials.json files."""

import os
import json
from pathlib import Path
from typing import Dict, Any, Optional
from dotenv import load_dotenv

class ConfigLoader:
    """Handles loading configuration from credentials.json or .env files."""

    def __init__(self):
        self.config: Dict[str, Any] = {}
        self.credentials_path = Path("credentials.json")
        self._load_config()

    def _load_config(self):
        """Load configuration from credentials.json if it exists, otherwise fall back to .env."""

        # First, try to load from credentials.json
        if self.credentials_path.exists():
            try:
                with open(self.credentials_path, 'r') as f:
                    data = json.load(f)
                    self.config = data
                    self._set_env_from_json(data)
                    print("Configuration loaded from credentials.json")
                    return
            except Exception as e:
                print(f"Error loading credentials.json: {e}")

        # Fall back to .env file
        load_dotenv()
        self._load_from_env()
        print("Configuration loaded from .env file")

    def _set_env_from_json(self, data: Dict[str, Any]):
        """Set environment variables from JSON configuration."""

        # Set provider selections
        providers = data.get('providers', {})
        os.environ['BROKERAGE_PROVIDER'] = providers.get('brokerage', 'ibkr')
        os.environ['DATA_PROVIDER'] = providers.get('data', 'massive')
        os.environ['NEWS_PROVIDER'] = providers.get('news', 'massive')

        # Set credentials
        creds = data.get('credentials', {})

        # Massive/Polygon credentials
        if 'massive' in creds:
            massive = creds['massive']
            if 'api_key' in massive:
                os.environ['MASSIVE_API_KEY'] = massive['api_key']

        # Alpaca credentials
        if 'alpaca' in creds:
            alpaca = creds['alpaca']
            if 'api_key' in alpaca:
                os.environ['ALPACA_API_KEY'] = alpaca['api_key']
            if 'api_secret' in alpaca:
                os.environ['ALPACA_API_SECRET'] = alpaca['api_secret']
            if 'paper' in alpaca:
                os.environ['ALPACA_PAPER'] = str(alpaca['paper']).lower()

        # OpenAI credentials
        if 'openai' in creds:
            openai = creds['openai']
            if 'api_key' in openai:
                os.environ['OPENAI_API_KEY'] = openai['api_key']

        # Ngrok settings
        ngrok = data.get('ngrok', {})
        if 'domain' in ngrok:
            os.environ['NGROK_DOMAIN'] = ngrok['domain']
        if 'port' in ngrok:
            os.environ['NGROK_PORT'] = str(ngrok['port'])
        if 'oauth_provider' in ngrok:
            os.environ['NGROK_OAUTH_PROVIDER'] = ngrok['oauth_provider']
        if 'oauth_allow_emails' in ngrok:
            os.environ['NGROK_OAUTH_ALLOW_EMAILS'] = ','.join(ngrok['oauth_allow_emails'])

    def _load_from_env(self):
        """Load configuration from environment variables."""

        self.config = {
            'providers': {
                'brokerage': os.getenv('BROKERAGE_PROVIDER', 'ibkr'),
                'data': os.getenv('DATA_PROVIDER', 'massive'),
                'news': os.getenv('NEWS_PROVIDER', 'massive')
            },
            'credentials': {}
        }

        # Load Massive credentials if present
        if os.getenv('MASSIVE_API_KEY'):
            self.config['credentials']['massive'] = {
                'api_key': os.getenv('MASSIVE_API_KEY')
            }

        # Load Alpaca credentials if present
        if os.getenv('ALPACA_API_KEY'):
            self.config['credentials']['alpaca'] = {
                'api_key': os.getenv('ALPACA_API_KEY'),
                'api_secret': os.getenv('ALPACA_API_SECRET', ''),
                'paper': os.getenv('ALPACA_PAPER', 'true').lower() == 'true'
            }

        # Load OpenAI credentials if present
        if os.getenv('OPENAI_API_KEY'):
            self.config['credentials']['openai'] = {
                'api_key': os.getenv('OPENAI_API_KEY')
            }

        # Load Ngrok settings
        self.config['ngrok'] = {
            'domain': os.getenv('NGROK_DOMAIN', ''),
            'port': int(os.getenv('NGROK_PORT', '3000')),
            'oauth_provider': os.getenv('NGROK_OAUTH_PROVIDER', ''),
            'oauth_allow_emails': os.getenv('NGROK_OAUTH_ALLOW_EMAILS', '').split(',') if os.getenv('NGROK_OAUTH_ALLOW_EMAILS') else []
        }

    def get_config(self) -> Dict[str, Any]:
        """Get the full configuration dictionary."""
        return self.config

    def get_providers(self) -> Dict[str, str]:
        """Get the provider configuration."""
        return self.config.get('providers', {})

    def get_credentials(self, provider: str) -> Optional[Dict[str, Any]]:
        """Get credentials for a specific provider."""
        return self.config.get('credentials', {}).get(provider)

    def check_credentials(self) -> Dict[str, Any]:
        """Check which credentials are configured and valid."""

        providers = self.config.get('providers', {})
        creds = self.config.get('credentials', {})

        missing_providers = []
        has_credentials = False

        # Check brokerage provider
        brokerage = providers.get('brokerage')
        if brokerage == 'alpaca':
            alpaca_creds = creds.get('alpaca', {})
            if not alpaca_creds.get('api_key') or 'YOUR_' in alpaca_creds.get('api_key', ''):
                missing_providers.append('brokerage')
            else:
                has_credentials = True
        elif brokerage == 'ibkr':
            # IBKR doesn't need API keys, just connection
            has_credentials = True

        # Check data provider
        data_provider = providers.get('data')
        if data_provider == 'massive':
            massive_creds = creds.get('massive', {})
            if not massive_creds.get('api_key') or 'YOUR_' in massive_creds.get('api_key', ''):
                missing_providers.append('data')
            else:
                has_credentials = True
        elif data_provider == 'alpaca':
            alpaca_creds = creds.get('alpaca', {})
            if not alpaca_creds.get('api_key') or 'YOUR_' in alpaca_creds.get('api_key', ''):
                missing_providers.append('data')
            else:
                has_credentials = True

        # Check news provider
        news_provider = providers.get('news')
        if news_provider == 'massive':
            massive_creds = creds.get('massive', {})
            if not massive_creds.get('api_key') or 'YOUR_' in massive_creds.get('api_key', ''):
                missing_providers.append('news')
            else:
                has_credentials = True
        elif news_provider == 'alpaca':
            alpaca_creds = creds.get('alpaca', {})
            if not alpaca_creds.get('api_key') or 'YOUR_' in alpaca_creds.get('api_key', ''):
                missing_providers.append('news')
            else:
                has_credentials = True

        # Remove duplicates
        missing_providers = list(set(missing_providers))

        return {
            'hasCredentials': has_credentials,
            'needsOnboarding': len(missing_providers) > 0 or not has_credentials,
            'missingProviders': missing_providers,
            'providers': providers,
            'configuredProviders': {
                'massive': bool(creds.get('massive', {}).get('api_key') and 'YOUR_' not in creds.get('massive', {}).get('api_key', '')),
                'alpaca': bool(creds.get('alpaca', {}).get('api_key') and 'YOUR_' not in creds.get('alpaca', {}).get('api_key', '')),
                'ibkr': True  # Always available if gateway is running
            }
        }

    def save_credentials(self, data: Dict[str, Any]) -> bool:
        """Save credentials to credentials.json file."""
        try:
            with open(self.credentials_path, 'w') as f:
                json.dump(data, f, indent=2)

            # Reload configuration
            self.config = data
            self._set_env_from_json(data)

            return True
        except Exception as e:
            print(f"Error saving credentials: {e}")
            return False

# Global instance
config_loader = ConfigLoader()