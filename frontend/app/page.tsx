
import { PayoffDashboard } from "@/components/payoff-dashboard";
import AppWrapper from "@/components/app-wrapper";

export default function Home() {
  return (
    <AppWrapper>
      <main className="min-h-screen bg-black text-white p-8 dark flex flex-col">
        <div className="max-w-7xl mx-auto w-full flex-1 space-y-6">
          <PayoffDashboard />

        </div>
        <footer className="mt-auto border-t border-white/10 pt-6 pb-4 text-center text-sm text-gray-500">
          Created by{" "}
          <a href="https://www.girish.xyz" className="hover:text-orange-500">
            Girish Gupta
          </a>
        </footer>
      </main>
    </AppWrapper>
  );
}
