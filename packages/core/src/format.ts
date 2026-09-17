import { call } from './frappe/client';
import { storage } from './storage';

/**
 * The site's configured default currency code (e.g. "BRL"), read from
 * Global Defaults. Used both to seed the `currencySymbol` storage key
 * `formatCurrency` reads, and anywhere a new doc (e.g. a Price List) needs
 * the real currency instead of a hardcoded one.
 */
export async function getDefaultCurrency(): Promise<string | null> {
  try {
    const res = await call<any>('frappe.client.get_value', {
      doctype: 'Global Defaults',
      fieldname: 'default_currency',
    });
    return (res?.message ?? res)?.default_currency || null;
  } catch (e) {
    console.error('Failed to fetch default currency', e);
    return null;
  }
}

/**
 * The site's actual default Price List names, read from Selling/Buying
 * Settings. NEVER assume these are "Standard Selling"/"Standard Buying" -
 * ERPNext's own regional setup can create them with a localized name
 * instead (confirmed live: this site's are "Venda Padrão"/"Compra
 * Padrão"), and hardcoding the English default breaks doc creation with an
 * opaque LinkValidationError the moment a form falls back to it.
 */
export async function getDefaultSellingPriceList(): Promise<string | null> {
  try {
    const res = await call<any>('frappe.client.get_value', {
      doctype: 'Selling Settings',
      fieldname: 'selling_price_list',
    });
    return (res?.message ?? res)?.selling_price_list || null;
  } catch (e) {
    console.error('Failed to fetch default selling price list', e);
    return null;
  }
}

export async function getDefaultBuyingPriceList(): Promise<string | null> {
  try {
    const res = await call<any>('frappe.client.get_value', {
      doctype: 'Buying Settings',
      fieldname: 'buying_price_list',
    });
    return (res?.message ?? res)?.buying_price_list || null;
  } catch (e) {
    console.error('Failed to fetch default buying price list', e);
    return null;
  }
}

export function formatCurrency(amount: number): string {
  const symbol = storage.getItem('currencySymbol') || '₹';
  const roundedAmount = flt(amount, 2);
  const formattedVal = typeof roundedAmount === 'number' && !isNaN(roundedAmount) ? roundedAmount.toLocaleString('en-IN') : roundedAmount;
  return `${symbol} ${formattedVal}`;
}

export function flt(v: number | string | null | undefined, decimals: number = 2): number {
  if (v == null || v === '') return 0;
  const num = typeof v === 'number' ? v : parseFloat(v as string);
  if (isNaN(num)) return 0;
  if (decimals != null) {
    const mult = Math.pow(10, decimals);
    const isNegative = num < 0;
    const absNum = Math.abs(num);
    const n = +(absNum * mult).toFixed(8);
    const rounded = Math.round(n) / mult;
    return isNegative ? -rounded : rounded;
  }
  return num;
}

/**
 * Formats a number as compact Indian-style currency for chart axes/labels,
 * e.g. 600000 -> "₹6L", 12500000 -> "₹1.25Cr", 8200 -> "₹8.2k".
 */
export function formatCompactCurrency(amount: number): string {
  const symbol = storage.getItem('currencySymbol') || '₹';
  if (typeof amount !== 'number' || isNaN(amount)) return `${symbol} ${amount}`;

  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);

  const trim = (value: number) => {
    const rounded = Math.round(value * 100) / 100;
    return rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  };

  if (abs >= 1_00_00_000) return `${sign}${symbol}${trim(abs / 1_00_00_000)}Cr`;
  if (abs >= 1_00_000) return `${sign}${symbol}${trim(abs / 1_00_000)}L`;
  if (abs >= 1_000) return `${sign}${symbol}${trim(abs / 1_000)}k`;
  return `${sign}${symbol}${trim(abs)}`;
}

export const formatInvoiceTime = (timestamp: string | null) => {
    if (!timestamp) return 'Nenhuma atividade de fatura ainda';

    const parsedDate = new Date(timestamp);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: 'numeric' });
    }

    const timeOnlyMatch = timestamp.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
    if (timeOnlyMatch) {
      const [, hours, minutes, seconds] = timeOnlyMatch;
      const date = new Date();
      date.setHours(Number(hours), Number(minutes), Number(seconds), 0);
      const formatted = date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      if (/^\d{1,2}:\d{2}$/.test(formatted)) {
        return formatted;
      }
      return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
    }

    return timestamp;
  };

// ERPNext's UOM master data is seeded in English (Kg, Litre, Nos...) and
// never renamed here - other records already reference those exact names,
// and renaming a master record would ripple through every one of them.
// This only relabels the handful actually used in this app for display,
// falling back to the raw name for anything not in the map.
const UOM_LABELS: Record<string, string> = {
  Nos: 'Unidade',
  Kg: 'Kg',
  Gram: 'Grama',
  Litre: 'Litro',
  Millilitre: 'Mililitro',
};

export function translateUom(uom: string | null | undefined): string {
  if (!uom) return '';
  return UOM_LABELS[uom] ?? uom;
}