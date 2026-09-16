import { useCallback, useEffect, useState } from 'react';
import { call, formatCurrency } from '@ury/core';
import { StatCard, DataTable, type DataTableColumn } from '@ury/ui';
import { Package, Banknote } from 'lucide-react';
import { useBranchContext } from '../../context/BranchContext';
import { DateRangeFilter, type DateRangeValue } from '../../components/reports/DateRangeFilter';
import { toApiDate } from '../../lib/reportDate';
import { startOfMonth, endOfDay } from 'date-fns';

interface PurchaseItemRow {
  item_code: string;
  item_name: string;
  qty: number;
  avg_rate: number;
  amount: number;
  purchase_count: number;
  supplier_count: number;
}

interface ItemWisePurchaseHistoryData {
  items: PurchaseItemRow[];
  summary: { total_qty: number; total_amount: number };
}

const columns: DataTableColumn<PurchaseItemRow>[] = [
  { key: 'item_name', header: 'Item' },
  { key: 'qty', header: 'Qtd. Comprada', align: 'right' },
  { key: 'avg_rate', header: 'Preço Médio', render: (r) => formatCurrency(r.avg_rate), align: 'right' },
  { key: 'amount', header: 'Total Gasto', render: (r) => formatCurrency(r.amount), align: 'right' },
  { key: 'purchase_count', header: 'Nº de Compras', align: 'right' },
  { key: 'supplier_count', header: 'Nº de Fornecedores', align: 'right' },
];

export function ItemWisePurchaseHistory() {
  const { activeBranchId } = useBranchContext();
  const [range, setRange] = useState<DateRangeValue>(() => ({
    from: startOfMonth(new Date()),
    to: endOfDay(new Date()),
  }));
  const [data, setData] = useState<ItemWisePurchaseHistoryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      setError(null);
      const branch = activeBranchId === 'all' ? undefined : activeBranchId;
      const res = await call<{ message: ItemWisePurchaseHistoryData }>(
        'ury.ury.report_api.items.get_item_wise_purchase_history',
        { branch, start_date: toApiDate(range.from), end_date: toApiDate(range.to) },
      );
      setData(res.message ?? (res as unknown as ItemWisePurchaseHistoryData));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar os dados do relatório.');
    } finally {
      setIsLoading(false);
    }
  }, [activeBranchId, range]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Histórico de Compras por Item</h1>
          <p className="text-sm text-muted-foreground">
            Aquisições por item {activeBranchId === 'all' ? '· Todas as Filiais' : ''}
          </p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard label="Qtd. Total Comprada" value={data.summary.total_qty} icon={<Package className="w-4 h-4" />} />
          <StatCard
            label="Total Gasto"
            value={formatCurrency(data.summary.total_amount)}
            icon={<Banknote className="w-4 h-4" />}
          />
        </div>
      )}

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        isLoading={isLoading}
        emptyMessage="Nenhum registro de compra neste período — as Faturas de Compra são criadas pelo Desk padrão do ERPNext, não por um fluxo específico do URY, então isso pode ser normal."
      />
    </div>
  );
}
