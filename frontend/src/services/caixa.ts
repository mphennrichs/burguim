import { call } from '@ury/core';

export interface SellableItem {
  item: string;
  item_name: string;
  rate: number;
  course: string | null;
  course_label: string | null;
  sold_out: number;
  disabled: number;
  special_dish: number;
  item_image: string | null;
}

export interface SalesHistoryOrder {
  name: string;
  customer_name: string;
  posting_date: string;
  posting_time: string;
  order_type: string;
  grand_total: number;
}

export interface SalesHistoryResponse {
  orders: SalesHistoryOrder[];
  total: number;
  count: number;
}

export interface CreateOrderResult {
  invoice: string;
  grand_total: number;
}

export type CaixaOrderType = 'Take Away' | 'Delivery';

function unwrap<T>(res: unknown, fallback: T): T {
  if (res && typeof res === 'object' && 'message' in res) {
    return (res as { message: T }).message ?? fallback;
  }
  return (res as T) ?? fallback;
}

export const caixaService = {
  async sellableItems(orderType: CaixaOrderType): Promise<SellableItem[]> {
    const res = await call<{ items: SellableItem[] }>('ury.ury.api.caixa.get_sellable_items', {
      order_type: orderType,
    });
    const data = unwrap<{ items: SellableItem[] }>(res, { items: [] });
    return Array.isArray(data.items) ? data.items : [];
  },

  async createOrder(params: {
    items: { item: string; item_name: string; qty: number }[];
    order_type: CaixaOrderType;
    customer_phone: string;
    customer_name?: string;
    delivery_address?: string;
    notes?: string;
  }): Promise<CreateOrderResult> {
    const res = await call<CreateOrderResult>('ury.ury.api.caixa.create_manual_order', {
      ...params,
      items: JSON.stringify(params.items),
    });
    return unwrap<CreateOrderResult>(res, { invoice: '', grand_total: 0 });
  },

  async salesHistory(days = 30): Promise<SalesHistoryResponse> {
    const res = await call<SalesHistoryResponse>('ury.ury.api.caixa.get_sales_history', { days });
    return unwrap<SalesHistoryResponse>(res, { orders: [], total: 0, count: 0 });
  },
};
