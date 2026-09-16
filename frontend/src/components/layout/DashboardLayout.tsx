import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { call, storage, getDefaultCurrency } from '@ury/core';
import { Spinner } from '@ury/ui';
import { BranchProvider } from '../../context/BranchContext';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
// import { Footer } from './Footer';

// `pos` seeds the shared `currencySymbol` localStorage key itself on login
// (see pos-store.ts's fetchCurrencySymbol); `frontend` never did, so every
// currency display here silently fell back to formatCurrency's hardcoded
// '₹' default regardless of the site's actual currency (confirmed live -
// same root cause self_ordering.py and delivery_orders.py already patched
// per-page). This is the app-wide fix those two deferred: seed it once,
// for the whole dashboard, from the site's actual default currency.
async function seedCurrencySymbol() {
  if (storage.getItem('currencySymbol')) return;
  try {
    const currency = await getDefaultCurrency();
    if (!currency) return;

    const currencyRes = await call<any>('frappe.client.get_value', {
      doctype: 'Currency',
      filters: currency,
      fieldname: 'symbol',
    });
    const symbol = (currencyRes?.message ?? currencyRes)?.symbol;
    storage.setItem('currencySymbol', symbol || currency);
  } catch (e) {
    console.error('Failed to seed currency symbol', e);
  }
}

export const DashboardLayout: React.FC = () => {
  // formatCurrency() reads storage synchronously and isn't reactive, so a
  // KPI card that renders (and calls it) before this seed resolves is stuck
  // showing the '₹' fallback until something else happens to re-render it -
  // confirmed live: the dashboard's own KPI cards routinely won that race on
  // first load. Blocking here (same pattern RoleGuard already uses) means
  // nothing under the dashboard ever calls formatCurrency before the real
  // symbol is in storage.
  const [currencyReady, setCurrencyReady] = useState(false);

  useEffect(() => {
    seedCurrencySymbol().finally(() => setCurrencyReady(true));
  }, []);

  if (!currencyReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  return (
    <BranchProvider>
      <div className="h-screen flex flex-col bg-background text-foreground font-inter text-sm overflow-hidden">
        <Header />
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <Sidebar />
          <main className="flex-1 p-6 overflow-y-auto min-w-0">
            <Outlet />
          </main>
        </div>
        {/* <Footer /> */}
      </div>
    </BranchProvider>
  );
};

export default DashboardLayout;
