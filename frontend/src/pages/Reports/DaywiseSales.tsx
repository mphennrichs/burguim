import { useCallback, useEffect, useState } from 'react';
import { call, formatCurrency } from '@ury/core';
import { StatCard, DataTable, type DataTableColumn } from '@ury/ui';
import { Receipt, IndianRupee, TrendingUp, Trophy } from 'lucide-react';
import { useBranchContext } from '../../context/BranchContext';
import { DateRangeFilter, type DateRangeValue } from '../../components/reports/DateRangeFilter';
import { LineChartCard } from '../../components/reports/charts/LineChartCard';
import { startOfMonth, endOfDay } from 'date-fns';
import { toApiDate } from '../../lib/reportDate';

interface DayRow {
  date: string;
  total_invoices: number;
  item_total: number;
  total_taxes: number;
  grand_total: number;
  round_off: number;
  cash_discount: number;
}

interface DaywiseSalesData {
  branch: string | null;
  start_date: string;
  end_date: string;
  rows: DayRow[];
  summary: {
    period_total: number;
    period_avg_daily: number;
    total_invoices: number;
    peak_day: string | null;
    peak_day_total: number;
  };
}

const columns: DataTableColumn<DayRow>[] = [
  { key: 'date', header: 'Data' },
  { key: 'total_invoices', header: 'Pedidos', align: 'right' },
  { key: 'item_total', header: 'Total de Itens', render: (r) => formatCurrency(r.item_total), align: 'right' },
  { key: 'total_taxes', header: 'Impostos', render: (r) => formatCurrency(r.total_taxes), align: 'right' },
  { key: 'grand_total', header: 'Total Geral', render: (r) => formatCurrency(r.grand_total), align: 'right' },
  { key: 'round_off', header: 'Arredondamento', render: (r) => formatCurrency(r.round_off), align: 'right' },
  { key: 'cash_discount', header: 'Descontos', render: (r) => formatCurrency(r.cash_discount), align: 'right' },
];

export function DaywiseSales() {
  const { activeBranchId } = useBranchContext();
  const [range, setRange] = useState<DateRangeValue>(() => ({
    from: startOfMonth(new Date()),
    to: endOfDay(new Date()),
  }));
  const [data, setData] = useState<DaywiseSalesData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      setError(null);
      const branch = activeBranchId === 'all' ? undefined : activeBranchId;
      const res = await call<{ message: DaywiseSalesData }>('ury.ury.report_api.sales.get_daywise_sales', {
        branch,
        start_date: toApiDate(range.from),
        end_date: toApiDate(range.to),
      });
      setData(res.message ?? (res as unknown as DaywiseSalesData));
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
          <h1 className="text-xl font-semibold">Vendas por Dia</h1>
          <p className="text-sm text-muted-foreground">
            Tendência diária de vendas {activeBranchId === 'all' ? '· Todas as Filiais' : ''}
          </p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {isLoading && !data ? (
        <div className="text-sm text-muted-foreground">Carregando...</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total do Período"
              value={formatCurrency(data.summary.period_total)}
              icon={<IndianRupee className="w-4 h-4" />}
            />
            <StatCard
              label="Média Diária de Vendas"
              value={formatCurrency(data.summary.period_avg_daily)}
              icon={<TrendingUp className="w-4 h-4" />}
            />
            <StatCard
              label="Total de Pedidos"
              value={data.summary.total_invoices}
              icon={<Receipt className="w-4 h-4" />}
            />
            <StatCard
              label="Melhor Dia"
              value={data.summary.peak_day ? `${data.summary.peak_day}` : '—'}
              delta={
                data.summary.peak_day
                  ? { value: formatCurrency(data.summary.peak_day_total), direction: 'up' }
                  : undefined
              }
              icon={<Trophy className="w-4 h-4" />}
            />
          </div>

          <LineChartCard
            title="Tendência do Total Geral"
            data={data.rows}
            xKey="date"
            yKeys={['grand_total']}
            labels={{ grand_total: 'Total Geral' }}
          />

          <DataTable columns={columns} rows={data.rows} isLoading={isLoading} />
        </>
      ) : null}
    </div>
  );
}
