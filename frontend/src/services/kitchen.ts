import { call, storage } from '@ury/core';

export interface KitchenOrderItem {
  item_name: string;
  qty: number;
  amount: number;
}

export interface KitchenOrder {
  invoice: string;
  customer_name: string;
  order_type: string;
  delivery_address: string | null;
  delivery_phone: string | null;
  notes: string | null;
  grand_total: number;
  created_at: string;
  kitchen_status: string;
  // Next state in this order's own flow (Retirada vs Entrega - see
  // CONTEXT.md's Estados do Pedido), or null if already terminal.
  next_status: string | null;
  items: KitchenOrderItem[];
}

interface KitchenQueueResponse {
  orders: KitchenOrder[];
  currency_symbol: string | null;
}

function unwrap<T>(res: unknown, fallback: T): T {
  if (res && typeof res === 'object' && 'message' in res) {
    return (res as { message: T }).message ?? fallback;
  }
  return (res as T) ?? fallback;
}

export const kitchenService = {
  async queue(): Promise<KitchenOrder[]> {
    const res = await call<KitchenQueueResponse>('ury.ury.api.kitchen.get_kitchen_queue');
    const data = unwrap<KitchenQueueResponse>(res, { orders: [], currency_symbol: null });
    // Same currencySymbol bootstrap gap as the old deliveryOrders service -
    // see kitchen.py's _resolve_branch_currency_symbol docstring.
    if (data.currency_symbol) {
      storage.setItem('currencySymbol', data.currency_symbol);
    }
    return Array.isArray(data.orders) ? data.orders : [];
  },

  async advance(invoice: string, newStatus: string): Promise<void> {
    await call('ury.ury.api.kitchen.advance_kitchen_status', { invoice, new_status: newStatus });
  },
};
