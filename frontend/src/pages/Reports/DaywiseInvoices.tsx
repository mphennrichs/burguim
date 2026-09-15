import { useCallback, useEffect, useState } from 'react';
import { call, formatCurrency } from '@ury/core';
import { DataTable, type DataTableColumn, Button } from '@ury/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useBranchContext } from '../../context/BranchContext';
import { DateRangeFilter, type DateRangeValue } from '../../components/reports/DateRangeFilter';
import { startOfMonth, endOfDay } from 'date-fns';
import { toApiDate } from '../../lib/reportDate';

interface InvoiceRow {
  date: string;
  time: string;
  invoice: string;
  item_total: number;
  total_taxes: number;
  grand_total: number;
  round_off: number;
  rounded_total: number;
  received_amount: number;
  change_amount: number;
  cash_discounts: number;
  payment_mode: string | null;
}

interface DaywiseInvoicesData {
  invoices: InvoiceRow[];
  pagination: { page: number; page_size: number; total: number; total_pages: number };
}

const columns: DataTableColumn<InvoiceRow>[] = [
  { key: 'date', header: 'Data' },
  { key: 'time', header: 'Hora' },
  { key: 'invoice', header: 'Pedido' },
  { key: 'item_total', header: 'Total de Itens', render: (r) => formatCurrency(r.item_total), align: 'right' },
  { key: 'total_taxes', header: 'Impostos', render: (r) => formatCurrency(r.total_taxes), align: 'right' },
  { key: 'grand_total', header: 'Total Geral', render: (r) => formatCurrency(r.grand_total), align: 'right' },
  { key: 'received_amount', header: 'Recebido', render: (r) => formatCurrency(r.received_amount), align: 'right' },
  { key: 'cash_discounts', header: 'Descontos', render: (r) => formatCurrency(r.cash_discounts), align: 'right' },
  { key: 'payment_mode', header: 'Forma de Pagamento', render: (r) => r.payment_mode || '—' },
];

const PAGE_SIZE = 50;

export function DaywiseInvoices() {
  const { activeBranchId } = useBranchContext();
  const [range, setRange] = useState<DateRangeValue>(() => ({
    from: startOfMonth(new Date()),
    to: endOfDay(new Date()),
  }));
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DaywiseInvoicesData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      setError(null);
      const branch = activeBranchId === 'all' ? undefined : activeBranchId;
      const res = await call<{ message: DaywiseInvoicesData }>('ury.ury.report_api.sales.get_daywise_invoices', {
        branch,
        start_date: toApiDate(range.from),
        end_date: toApiDate(range.to),
        page,
        page_size: PAGE_SIZE,
      });
      setData(res.message ?? (res as unknown as DaywiseInvoicesData));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar os dados do relatório.');
    } finally {
      setIsLoading(false);
    }
  }, [activeBranchId, range, page]);

  useEffect(() => {
    setPage(1);
  }, [activeBranchId, range]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Pedidos por Dia</h1>
          <p className="text-sm text-muted-foreground">
            Detalhamento por pedido {activeBranchId === 'all' ? '· Todas as Filiais' : ''}
            {pagination ? ` · ${pagination.total} pedidos` : ''}
          </p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <DataTable columns={columns} rows={data?.invoices ?? []} isLoading={isLoading} />

      {pagination && pagination.total_pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {pagination.page} de {pagination.total_pages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-4 h-4" /> Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.total_pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
