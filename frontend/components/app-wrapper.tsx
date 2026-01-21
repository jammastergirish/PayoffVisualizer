'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { checkCredentials } from '@/lib/credential-check';
import { Loader2 } from 'lucide-react';

export default function AppWrapper({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function verifyCredentials() {
      // Skip check if we're already on settings or onboarding page
      if (window.location.pathname === '/settings' || window.location.pathname === '/onboarding') {
        setChecking(false);
        return;
      }

      const result = await checkCredentials();

      if (result.needsOnboarding) {
        router.push('/onboarding');
      } else {
        setChecking(false);
      }
    }

    verifyCredentials();
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Checking configuration...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}