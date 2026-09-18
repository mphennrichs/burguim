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

export interface PurchasableItem {
  name: string;
  item_name: string;
  stock_uom: string;
  shelf_life_in_days: number | null;
  last_buying_rate: number | null;
}

export interface RecordedPurchase {
  stock_entry: string;
  batch_no: string;
  qty: number;
  expiry_date: string | null;
}

export interface ProductionItem {
  name: string;
  item_name: string;
  stock_uom: string;
  shelf_life_in_days: number | null;
  bom: string;
}

export interface BomCandidateItem {
  name: string;
  item_name: string;
  stock_uom: string;
}

export interface BomOutputCandidateItem extends BomCandidateItem {
  has_batch_no: number;
}

export interface Ingredient {
  name: string;
  item_name: string;
  stock_uom: string;
  item_group: string;
  shelf_life_in_days: number | null;
  description: string | null;
}

export interface ComposedItem {
  name: string;
  item_name: string;
  stock_uom: string;
  item_group: string;
  description: string | null;
}

export interface BomIngredient {
  item_code: string;
  item_name: string;
  qty: number;
  uom: string;
}

export interface Bom {
  name: string;
  item: string;
  item_name: string;
  quantity: number;
  uom: string;
  preparation_notes: string | null;
  ingredients: BomIngredient[];
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

  async purchasableItems(): Promise<PurchasableItem[]> {
    const res = await call<{ items: PurchasableItem[] }>('ury.ury.api.stock_entry.get_purchasable_items');
    const data = unwrap<{ items: PurchasableItem[] }>(res, { items: [] });
    return Array.isArray(data.items) ? data.items : [];
  },

  async recordPurchase(params: {
    item_code: string;
    qty: number;
    rate: number;
    purchase_date?: string;
    expiry_date?: string;
  }): Promise<RecordedPurchase> {
    const res = await call<RecordedPurchase>('ury.ury.api.stock_entry.record_purchase', params);
    return unwrap<RecordedPurchase>(res, { stock_entry: '', batch_no: '', qty: 0, expiry_date: null });
  },

  async productionItems(): Promise<ProductionItem[]> {
    const res = await call<{ items: ProductionItem[] }>('ury.ury.api.stock_entry.get_production_items');
    const data = unwrap<{ items: ProductionItem[] }>(res, { items: [] });
    return Array.isArray(data.items) ? data.items : [];
  },

  async recordProduction(params: {
    item_code: string;
    qty: number;
    purchase_date?: string;
    expiry_date?: string;
  }): Promise<RecordedPurchase> {
    const res = await call<RecordedPurchase>('ury.ury.api.stock_entry.record_production', params);
    return unwrap<RecordedPurchase>(res, { stock_entry: '', batch_no: '', qty: 0, expiry_date: null });
  },

  async bomCandidates(): Promise<BomCandidateItem[]> {
    const res = await call<{ items: BomCandidateItem[] }>('ury.ury.api.bom.get_bom_candidates');
    const data = unwrap<{ items: BomCandidateItem[] }>(res, { items: [] });
    return Array.isArray(data.items) ? data.items : [];
  },

  async bomOutputCandidates(): Promise<BomOutputCandidateItem[]> {
    const res = await call<{ items: BomOutputCandidateItem[] }>('ury.ury.api.bom.get_bom_output_candidates');
    const data = unwrap<{ items: BomOutputCandidateItem[] }>(res, { items: [] });
    return Array.isArray(data.items) ? data.items : [];
  },

  async itemGroups(): Promise<string[]> {
    const res = await call<{ groups: string[] }>('ury.ury.api.bom.get_item_groups');
    const data = unwrap<{ groups: string[] }>(res, { groups: [] });
    return Array.isArray(data.groups) ? data.groups : [];
  },

  async uoms(): Promise<string[]> {
    const res = await call<{ uoms: string[] }>('ury.ury.api.bom.get_uoms');
    const data = unwrap<{ uoms: string[] }>(res, { uoms: [] });
    return Array.isArray(data.uoms) ? data.uoms : [];
  },

  async createItem(params: {
    item_name: string;
    kind: 'ingredient' | 'composed';
    stock_uom?: string;
    item_group?: string;
    shelf_life_in_days?: number;
    description?: string;
  }): Promise<{ item: string; stock_uom: string; shelf_life_in_days: number | null; description: string | null }> {
    const res = await call<{
      item: string;
      stock_uom: string;
      shelf_life_in_days: number | null;
      description: string | null;
    }>('ury.ury.api.bom.create_item', params);
    return unwrap(res, {
      item: '',
      stock_uom: params.stock_uom ?? '',
      shelf_life_in_days: params.shelf_life_in_days ?? null,
      description: params.description ?? null,
    });
  },

  async ingredients(): Promise<Ingredient[]> {
    const res = await call<{ items: Ingredient[] }>('ury.ury.api.bom.get_ingredients');
    const data = unwrap<{ items: Ingredient[] }>(res, { items: [] });
    return Array.isArray(data.items) ? data.items : [];
  },

  async updateIngredient(params: {
    item_code: string;
    shelf_life_in_days: number | null;
    description?: string | null;
  }): Promise<{ item: string; shelf_life_in_days: number | null; description: string | null }> {
    const res = await call<{ item: string; shelf_life_in_days: number | null; description: string | null }>(
      'ury.ury.api.bom.update_ingredient',
      params,
    );
    return unwrap(res, {
      item: params.item_code,
      shelf_life_in_days: params.shelf_life_in_days,
      description: params.description ?? null,
    });
  },

  async deleteIngredient(itemCode: string): Promise<void> {
    await call('ury.ury.api.bom.delete_ingredient', { item_code: itemCode });
  },

  async composedItems(): Promise<ComposedItem[]> {
    const res = await call<{ items: ComposedItem[] }>('ury.ury.api.bom.get_composed_items');
    const data = unwrap<{ items: ComposedItem[] }>(res, { items: [] });
    return Array.isArray(data.items) ? data.items : [];
  },

  async deleteComposedItem(itemCode: string): Promise<void> {
    await call('ury.ury.api.bom.delete_composed_item', { item_code: itemCode });
  },

  async boms(): Promise<Bom[]> {
    const res = await call<{ boms: Bom[] }>('ury.ury.api.bom.get_boms');
    const data = unwrap<{ boms: Bom[] }>(res, { boms: [] });
    return Array.isArray(data.boms) ? data.boms : [];
  },

  async createBom(params: {
    item_code: string;
    quantity: number;
    ingredients: { item_code: string; qty: number }[];
    preparation_notes?: string;
  }): Promise<{ bom: string }> {
    const res = await call<{ bom: string }>('ury.ury.api.bom.create_bom', params);
    return unwrap<{ bom: string }>(res, { bom: '' });
  },

  async updateBom(params: {
    bom_name: string;
    quantity: number;
    ingredients: { item_code: string; qty: number }[];
    preparation_notes?: string;
  }): Promise<{ bom: string }> {
    const res = await call<{ bom: string }>('ury.ury.api.bom.update_bom', params);
    return unwrap<{ bom: string }>(res, { bom: '' });
  },

  async deleteBom(bomName: string): Promise<void> {
    await call('ury.ury.api.bom.delete_bom', { bom_name: bomName });
  },

  async getStockSettings(): Promise<{ block_sale_on_insufficient_stock: boolean }> {
    const res = await call<{ block_sale_on_insufficient_stock: boolean }>(
      'ury.ury.api.stock_settings.get_stock_settings',
    );
    return unwrap(res, { block_sale_on_insufficient_stock: false });
  },

  async updateStockSettings(blockSaleOnInsufficientStock: boolean): Promise<{ block_sale_on_insufficient_stock: boolean }> {
    const res = await call<{ block_sale_on_insufficient_stock: boolean }>(
      'ury.ury.api.stock_settings.update_stock_settings',
      { block_sale_on_insufficient_stock: blockSaleOnInsufficientStock },
    );
    return unwrap(res, { block_sale_on_insufficient_stock: blockSaleOnInsufficientStock });
  },
};
