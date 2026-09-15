import { call, storage } from '@ury/core';

export interface MenuCostItem {
  item: string;
  item_name: string;
  rate: number;
  cost: number | null;
  margin: number | null;
  margin_percent: number | null;
  missing_cost_for: string[];
}

export interface ExpiringBatch {
  batch_no: string;
  item_code: string;
  item_name: string;
  uom: string;
  expiry_date: string;
  qty: number;
  days_left: number;
  status: 'expired' | 'critical' | 'warning' | 'ok';
}

export interface ItemWithoutBom {
  item: string;
  item_name: string;
}

interface MenuCostOverviewResponse {
  items: MenuCostItem[];
  currency_symbol: string | null;
  buying_price_list: string;
}

interface ExpiringBatchesResponse {
  batches: ExpiringBatch[];
}

interface ItemsWithoutBomResponse {
  items: ItemWithoutBom[];
}

function unwrap<T>(res: unknown, fallback: T): T {
  if (res && typeof res === 'object' && 'message' in res) {
    return (res as { message: T }).message ?? fallback;
  }
  return (res as T) ?? fallback;
}

export const stockOverviewService = {
  async menuCosts(): Promise<MenuCostOverviewResponse> {
    const res = await call<MenuCostOverviewResponse>('ury.ury.api.stock_overview.get_menu_cost_overview');
    const data = unwrap<MenuCostOverviewResponse>(res, { items: [], currency_symbol: null, buying_price_list: '' });
    // Same currencySymbol bootstrap gap as deliveryOrdersService — frontend
    // never populates it on its own, so piggyback the fix here too.
    if (data.currency_symbol) {
      storage.setItem('currencySymbol', data.currency_symbol);
    }
    return data;
  },

  async expiringBatches(days = 14): Promise<ExpiringBatch[]> {
    const res = await call<ExpiringBatchesResponse>('ury.ury.api.stock_overview.get_expiring_batches', { days });
    const data = unwrap<ExpiringBatchesResponse>(res, { batches: [] });
    return Array.isArray(data.batches) ? data.batches : [];
  },

  async itemsWithoutBom(): Promise<ItemWithoutBom[]> {
    const res = await call<ItemsWithoutBomResponse>('ury.ury.api.stock_overview.get_items_without_bom');
    const data = unwrap<ItemsWithoutBomResponse>(res, { items: [] });
    return Array.isArray(data.items) ? data.items : [];
  },
};
