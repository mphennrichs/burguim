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

export interface OrderStatusHistoryEntry {
  status: string;
  changed_at: string;
}

export interface OrderDetail {
  invoice: string;
  customer: string;
  customer_name: string;
  contact_mobile: string | null;
  shipping_address: string | null;
  notes: string | null;
  order_type: string;
  kitchen_status: string;
  grand_total: number;
  posting_date: string;
  posting_time: string;
  items: { item_name: string; qty: number; rate: number; amount: number }[];
  status_history: OrderStatusHistoryEntry[];
}

export interface CustomerRecord {
  name: string;
  customer_name: string;
  mobile_number: string;
  delivery_address: string | null;
}

export interface CustomerLookupResult {
  found: boolean;
  customer_name: string | null;
  delivery_address: string | null;
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

  async orderDetail(invoice: string): Promise<OrderDetail> {
    const res = await call<OrderDetail>('ury.ury.api.caixa.get_order_detail', { invoice });
    return unwrap<OrderDetail>(res, {
      invoice,
      customer: '',
      customer_name: '',
      contact_mobile: null,
      shipping_address: null,
      notes: null,
      order_type: '',
      kitchen_status: '',
      grand_total: 0,
      posting_date: '',
      posting_time: '',
      items: [],
      status_history: [],
    });
  },

  async customer(name: string): Promise<CustomerRecord> {
    const res = await call<CustomerRecord>('ury.ury.api.caixa.get_customer', { customer: name });
    return unwrap<CustomerRecord>(res, { name, customer_name: '', mobile_number: '', delivery_address: null });
  },

  async customers(query?: string): Promise<CustomerRecord[]> {
    const res = await call<{ customers: CustomerRecord[] }>('ury.ury.api.caixa.list_customers', {
      query: query || undefined,
    });
    const data = unwrap<{ customers: CustomerRecord[] }>(res, { customers: [] });
    return Array.isArray(data.customers) ? data.customers : [];
  },

  async customerOrders(customer: string): Promise<SalesHistoryResponse> {
    const res = await call<SalesHistoryResponse>('ury.ury.api.caixa.get_customer_orders', { customer });
    return unwrap<SalesHistoryResponse>(res, { orders: [], total: 0, count: 0 });
  },

  async updateCustomerAddress(customer: string, deliveryAddress: string): Promise<void> {
    await call('ury.ury.api.caixa.update_customer_address', {
      customer,
      delivery_address: deliveryAddress,
    });
  },

  async lookupCustomerByPhone(phone: string): Promise<CustomerLookupResult> {
    const res = await call<CustomerLookupResult>('ury.ury.api.caixa.lookup_customer_by_phone', { phone });
    return unwrap<CustomerLookupResult>(res, { found: false, customer_name: null, delivery_address: null });
  },
};
