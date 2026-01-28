'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, XCircle, Loader2, Settings, Rocket, Eye, EyeOff } from 'lucide-react';

interface Credentials {
  providers: {
    brokerage: 'ibkr' | 'alpaca';
    data: 'ibkr' | 'alpaca' | 'massive';
    news: 'alpaca' | 'massive' | 'ibkr';
  };
  credentials: {
    massive?: {
      api_key: string;
    };
    alpaca?: {
      api_key: string;
      api_secret: string;
      paper: boolean;
    };
    ibkr?: {
      configured: boolean;
    };
    openai?: {
      api_key: string;
    };
  };
}

interface ConnectionStatus {
  ibkr: boolean;
  alpaca: boolean;
  massive: boolean;
  checking: boolean;
}

export default function SettingsPage({ isOnboarding = false }: { isOnboarding?: boolean }) {
  const [credentials, setCredentials] = useState<Credentials>({
    providers: {
      brokerage: 'ibkr',
      data: 'massive',
      news: 'massive',
    },
    credentials: {},
  });

  const [showCredentials, setShowCredentials] = useState<{ [key: string]: boolean }>({});

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    ibkr: false,
    alpaca: false,
    massive: false,
    checking: false,
  });

  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Load credentials on mount
  useEffect(() => {
    loadCredentials();
  }, []);

  // Check connections when credentials change
  useEffect(() => {
    checkAllConnections();
  }, [credentials.credentials]);

  const checkAllConnections = async () => {
    // Check each provider's connection in parallel
    const checks = [];

    // Check IBKR
    checks.push(
      fetch('http://localhost:8000/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'ibkr', credentials: {} }),
      })
        .then(res => res.json())
        .then(data => ({ ibkr: data.connected }))
        .catch(() => ({ ibkr: false }))
    );

    // Check Massive if credentials exist
    if (credentials.credentials.massive?.api_key && !credentials.credentials.massive.api_key.includes('YOUR_')) {
      checks.push(
        fetch('http://localhost:8000/api/test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'massive', credentials: credentials.credentials.massive }),
        })
          .then(res => res.json())
          .then(data => ({ massive: data.connected }))
          .catch(() => ({ massive: false }))
      );
    } else {
      checks.push(Promise.resolve({ massive: false }));
    }

    // Check Alpaca if credentials exist
    if (credentials.credentials.alpaca?.api_key && credentials.credentials.alpaca?.api_secret &&
        !credentials.credentials.alpaca.api_key.includes('YOUR_')) {
      checks.push(
        fetch('http://localhost:8000/api/test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'alpaca', credentials: credentials.credentials.alpaca }),
        })
          .then(res => res.json())
          .then(data => ({ alpaca: data.connected }))
          .catch(() => ({ alpaca: false }))
      );
    } else {
      checks.push(Promise.resolve({ alpaca: false }));
    }

    // Wait for all checks to complete
    const results = await Promise.all(checks);
    const newStatus = results.reduce((acc, cur) => ({ ...acc, ...cur }), { checking: false });
    setConnectionStatus(prev => ({ ...prev, ...newStatus }));
  };

  const testConnection = async (provider: string) => {
    const creds = credentials.credentials[provider as keyof typeof credentials.credentials];
    if (!creds) return;

    try {
      const response = await fetch('http://localhost:8000/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, credentials: creds }),
      });
      const data = await response.json();
      setConnectionStatus(prev => ({ ...prev, [provider]: data.connected }));
    } catch (error) {
      console.error(`Error testing ${provider} connection:`, error);
      setConnectionStatus(prev => ({ ...prev, [provider]: false }));
    }
  };

  const loadCredentials = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/credentials');
      if (response.ok) {
        const data = await response.json();
        console.log('Loaded credentials from backend:', data);
        if (data.credentials) {
          setCredentials(data.credentials);
        }
      }
    } catch (error) {
      console.error('Error loading credentials:', error);
    }
  };

  const validateCredentials = () => {
    // NO VALIDATION - just save whatever the user wants
    setErrors({});
    return true;
  };

  const handleSave = async () => {
    if (!validateCredentials()) {
      return;
    }

    setSaving(true);
    setSaveStatus('idle');

    try {
      const response = await fetch('http://localhost:8000/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      if (response.ok) {
        setSaveStatus('success');
        // Reload the app to apply new settings
        setTimeout(() => {
          window.location.href = '/';
        }, 1500);
      } else {
        setSaveStatus('error');
      }
    } catch (error) {
      console.error('Error saving credentials:', error);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const updateProvider = (type: 'brokerage' | 'data' | 'news', value: string) => {
    setCredentials(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        [type]: value,
      },
    }));
  };

  const updateCredential = (provider: string, field: string, value: string | boolean) => {
    setCredentials(prev => ({
      ...prev,
      credentials: {
        ...prev.credentials,
        [provider]: {
          ...(prev.credentials as any)[provider],
          [field]: value,
        },
      },
    }));

    // Test connection after a short delay when credentials are updated
    if ((field === 'api_key' || field === 'api_secret') && value) {
      setTimeout(() => testConnection(provider), 500);
    }
  };

  const pageIcon = isOnboarding ? <Rocket className="h-5 w-5" /> : <Settings className="h-5 w-5" />;
  const pageTitle = isOnboarding ? 'Welcome to PayoffDiagrams' : 'Settings';
  const pageDescription = isOnboarding
    ? 'Let\'s set up your data sources and credentials to get started'
    : 'Configure your data sources and API credentials';

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {pageIcon}
              {pageTitle}
            </CardTitle>
            <CardDescription>{pageDescription}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Connection Status */}
            <div className="space-y-2">
              <Label>Connection Status</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="flex items-center gap-2 p-2 rounded border">
                  {connectionStatus.checking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : connectionStatus.ibkr ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-sm">IBKR Gateway/TWS</span>
                </div>

                <div className="flex items-center gap-2 p-2 rounded border">
                  {connectionStatus.alpaca ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-sm">Alpaca</span>
                </div>

                <div className="flex items-center gap-2 p-2 rounded border">
                  {connectionStatus.massive ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-sm">Massive</span>
                </div>
              </div>
            </div>

            {/* Provider Selection */}
            <Tabs defaultValue="providers" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="providers">Data Sources</TabsTrigger>
                <TabsTrigger value="credentials">API Credentials</TabsTrigger>
              </TabsList>

              <TabsContent value="providers" className="space-y-4 mt-4">
                {/* Brokerage Selection */}
                <div className="space-y-2">
                  <Label htmlFor="brokerage">Brokerage Provider</Label>
                  <RadioGroup
                    value={credentials.providers.brokerage}
                    onValueChange={(value) => updateProvider('brokerage', value)}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem
                        value="ibkr"
                        id="brokerage-ibkr"
                      />
                      <Label htmlFor="brokerage-ibkr">
                        Interactive Brokers (IBKR)
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem
                        value="alpaca"
                        id="brokerage-alpaca"
                      />
                      <Label htmlFor="brokerage-alpaca">
                        Alpaca
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* Data Provider Selection */}
                <div className="space-y-2">
                  <Label htmlFor="data">Market Data Provider</Label>
                  <RadioGroup
                    value={credentials.providers.data}
                    onValueChange={(value) => updateProvider('data', value)}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="massive" id="data-massive" />
                      <Label htmlFor="data-massive">Massive (Polygon.io)</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem
                        value="ibkr"
                        id="data-ibkr"
                      />
                      <Label htmlFor="data-ibkr">
                        Interactive Brokers
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="alpaca" id="data-alpaca" />
                      <Label htmlFor="data-alpaca">Alpaca</Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* News Provider Selection */}
                <div className="space-y-2">
                  <Label htmlFor="news">News Provider</Label>
                  <RadioGroup
                    value={credentials.providers.news}
                    onValueChange={(value) => updateProvider('news', value)}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="massive" id="news-massive" />
                      <Label htmlFor="news-massive">Massive (Polygon.io)</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="alpaca" id="news-alpaca" />
                      <Label htmlFor="news-alpaca">Alpaca</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem
                        value="ibkr"
                        id="news-ibkr"
                      />
                      <Label htmlFor="news-ibkr">
                        Interactive Brokers
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              </TabsContent>

              <TabsContent value="credentials" className="space-y-4 mt-4">
                {/* Massive Credentials */}
                {(credentials.providers.data === 'massive' || credentials.providers.news === 'massive') && (
                  <div className="space-y-2">
                    <Label htmlFor="massive-api-key">Massive API Key</Label>
                    <div className="relative">
                      <Input
                        id="massive-api-key"
                        type={showCredentials['massive'] ? 'text' : 'password'}
                        placeholder="Enter your Massive/Polygon.io API key"
                        value={credentials.credentials.massive?.api_key || ''}
                        onChange={(e) => updateCredential('massive', 'api_key', e.target.value)}
                        className="pr-10"
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCredentials(prev => ({ ...prev, massive: !prev.massive }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded"
                      >
                        {showCredentials['massive'] ? (
                          <EyeOff className="h-4 w-4 text-gray-400" />
                        ) : (
                          <Eye className="h-4 w-4 text-gray-400" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Get your API key at <a href="https://polygon.io" target="_blank" rel="noopener noreferrer" className="underline">polygon.io</a>
                    </p>
                  </div>
                )}

                {/* Alpaca Credentials */}
                {(credentials.providers.brokerage === 'alpaca' ||
                  credentials.providers.data === 'alpaca' ||
                  credentials.providers.news === 'alpaca') && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="alpaca-api-key">Alpaca API Key</Label>
                      <div className="relative">
                        <Input
                          id="alpaca-api-key"
                          type={showCredentials['alpaca_key'] ? 'text' : 'password'}
                          placeholder="Enter your Alpaca API key"
                          value={credentials.credentials.alpaca?.api_key || ''}
                          onChange={(e) => updateCredential('alpaca', 'api_key', e.target.value)}
                          className="pr-10"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCredentials(prev => ({ ...prev, alpaca_key: !prev.alpaca_key }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded"
                        >
                          {showCredentials['alpaca_key'] ? (
                            <EyeOff className="h-4 w-4 text-gray-400" />
                          ) : (
                            <Eye className="h-4 w-4 text-gray-400" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="alpaca-api-secret">Alpaca API Secret</Label>
                      <div className="relative">
                        <Input
                          id="alpaca-api-secret"
                          type={showCredentials['alpaca_secret'] ? 'text' : 'password'}
                          placeholder="Enter your Alpaca API secret"
                          value={credentials.credentials.alpaca?.api_secret || ''}
                          onChange={(e) => updateCredential('alpaca', 'api_secret', e.target.value)}
                          className="pr-10"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCredentials(prev => ({ ...prev, alpaca_secret: !prev.alpaca_secret }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded"
                        >
                          {showCredentials['alpaca_secret'] ? (
                            <EyeOff className="h-4 w-4 text-gray-400" />
                          ) : (
                            <Eye className="h-4 w-4 text-gray-400" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="alpaca-paper"
                        checked={credentials.credentials.alpaca?.paper || false}
                        onChange={(e) => updateCredential('alpaca', 'paper', e.target.checked)}
                        className="h-4 w-4"
                      />
                      <Label htmlFor="alpaca-paper">Use Paper Trading Account</Label>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Get your API credentials at <a href="https://alpaca.markets" target="_blank" rel="noopener noreferrer" className="underline">alpaca.markets</a>
                    </p>
                  </div>
                )}

                {/* IBKR Info */}
                {credentials.providers.brokerage === 'ibkr' && (
                  <Alert>
                    <AlertDescription>
                      Interactive Brokers requires IBKR Gateway or Trader Workstation (TWS) to be running
                      with API access enabled on port 5000. No API keys are needed.
                    </AlertDescription>
                  </Alert>
                )}

                {/* OpenAI Credentials (Optional) */}
                <div className="space-y-2">
                  <Label htmlFor="openai-api-key">OpenAI API Key (Optional)</Label>
                  <div className="relative">
                    <Input
                      id="openai-api-key"
                      type={showCredentials['openai'] ? 'text' : 'password'}
                      placeholder="Enter your OpenAI API key for AI features"
                      value={credentials.credentials.openai?.api_key || ''}
                      onChange={(e) => updateCredential('openai', 'api_key', e.target.value)}
                      className="pr-10"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCredentials(prev => ({ ...prev, openai: !prev.openai }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded"
                    >
                      {showCredentials['openai'] ? (
                        <EyeOff className="h-4 w-4 text-gray-400" />
                      ) : (
                        <Eye className="h-4 w-4 text-gray-400" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Optional: Used for AI-powered features
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            {/* Save Button and Status */}
            <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="w-full sm:w-auto"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isOnboarding ? 'Get Started' : 'Save Settings'}
              </Button>

              {saveStatus === 'success' && (
                <Alert className="flex-1">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>Settings saved successfully! Redirecting...</AlertDescription>
                </Alert>
              )}

              {saveStatus === 'error' && (
                <Alert variant="destructive" className="flex-1">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>Failed to save settings. Please try again.</AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}