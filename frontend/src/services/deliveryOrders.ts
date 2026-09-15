import { call, storage } from '@ury/core';

export interface DeliveryOrderItem {
  item_name: string;
  qty: number;
  amount: number;
}

export interface DeliveryOrder {
  invoice: string;
  customer_name: string;
  delivery_address: string | null;
  delivery_phone: string | null;
  notes: string | null;
  grand_total: number;
  created_at: string;
  // Only set on history entries (list_delivery_order_history) — null for
  // still-pending orders from list().
  completed_at: string | null;
  items: DeliveryOrderItem[];
}

interface ListDeliveryOrdersResponse {
  orders: DeliveryOrder[];
  currency_symbol: string | null;
}

function unwrap<T>(res: unknown, fallback: T): T {
  if (res && typeof res === 'object' && 'message' in res) {
    return (res as { message: T }).message ?? fallback;
  }
  return (res as T) ?? fallback;
}

async function fetchOrders(method: string, params?: Record<string, unknown>): Promise<DeliveryOrder[]> {
  const res = await call<ListDeliveryOrdersResponse>(method, params);
  const data = unwrap<ListDeliveryOrdersResponse>(res, { orders: [], currency_symbol: null });
  // `formatCurrency` (@ury/core / frontend's own utils/format.ts) reads
  // this same key — `pos` populates it from its own login bootstrap,
  // `frontend` never does, so it silently falls back to '₹'. Piggyback
  // the fix on this call rather than adding a separate app-wide bootstrap
  // fetch (a broader fix — see delivery_orders.py's
  // _resolve_branch_currency_symbol comment).
  if (data.currency_symbol) {
    storage.setItem('currencySymbol', data.currency_symbol);
  }
  return Array.isArray(data.orders) ? data.orders : [];
}

export const deliveryOrdersService = {
  async list(): Promise<DeliveryOrder[]> {
    return fetchOrders('ury.ury.api.delivery_orders.list_delivery_orders');
  },

  async history(limit = 50): Promise<DeliveryOrder[]> {
    return fetchOrders('ury.ury.api.delivery_orders.list_delivery_order_history', { limit });
  },

  async markComplete(invoice: string): Promise<void> {
    await call('ury.ury.api.delivery_orders.mark_delivery_order_complete', { invoice });
  },
};
