export interface CredentialCheckResult {
  hasCredentials: boolean;
  needsOnboarding: boolean;
  missingProviders: string[];
}

export async function checkCredentials(): Promise<CredentialCheckResult> {
  try {
    const response = await fetch('http://localhost:8000/api/credentials/check');
    if (!response.ok) {
      // If endpoint doesn't exist, assume credentials need setup
      return {
        hasCredentials: false,
        needsOnboarding: true,
        missingProviders: ['brokerage', 'data', 'news'],
      };
    }

    const data = await response.json();
    return {
      hasCredentials: data.hasCredentials || false,
      needsOnboarding: data.needsOnboarding || false,
      missingProviders: data.missingProviders || [],
    };
  } catch (error) {
    console.error('Error checking credentials:', error);
    // On error, assume we need onboarding
    return {
      hasCredentials: false,
      needsOnboarding: true,
      missingProviders: [],
    };
  }
}