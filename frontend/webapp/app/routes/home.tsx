import { useState } from "react";
import { Navigate } from "react-router";
import type { Route } from "./+types/home";
import { AuthLoading } from "../components/AuthShell";
import { BottomPanel } from "../components/BottomPanel";
import { OrderForm } from "../components/OrderForm";
import { RightDock } from "../components/RightDock";
import { TopNav } from "../components/TopNav";
import { TradingChart } from "../components/chart/TradingChart";
import { authRedirect, useAuth } from "../lib/auth";
import { TradingStoreProvider } from "../lib/trading-store";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "ZRS Exchange — Paper trading terminal" },
    { name: "description", content: "Paper trading terminal with live Binance prices" },
  ];
}

export default function Home() {
  const { user, ready } = useAuth();
  const [orderOpen, setOrderOpen] = useState(true);

  if (!ready) return <AuthLoading />;
  const redirect = authRedirect(user);
  if (redirect) return <Navigate to={redirect} replace />;

  return (
    <TradingStoreProvider>
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-ex-bg">
        <TopNav />
        <div className="flex min-h-0 flex-1 gap-0">
          <TradingChart />
          {orderOpen && (
            <aside className="flex w-[300px] shrink-0 flex-col border-l border-ex-border bg-ex-panel">
              <OrderForm />
            </aside>
          )}
          <RightDock orderOpen={orderOpen} onToggleOrder={() => setOrderOpen((open) => !open)} />
        </div>
        <BottomPanel />
      </div>
    </TradingStoreProvider>
  );
}
