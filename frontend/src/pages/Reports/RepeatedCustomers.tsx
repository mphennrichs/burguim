import { useCallback, useEffect, useState } from 'react';
import { call } from '@ury/core';
import { StatCard, DataTable, type DataTableColumn } from '@ury/ui';
import { Users, UserPlus, Repeat, Percent } from 'lucide-react';
import { useBranchContext } from '../../context/BranchContext';
import { DateRangeFilter, type DateRangeValue } from '../../components/reports/DateRangeFilter';
import { BarChartCard } from '../../components/reports/charts/BarChartCard';
import { toApiDate } from '../../lib/reportDate';
import { startOfMonth, endOfDay } from 'date-fns';

interface DayRow {
  date: string;
  total_customers: number;
  new_customers: number;
  repeat_customers: number;
  repeat_rate_percent: number;
}

interface RepeatedCustomersData {
  rows: DayRow[];
  summary: {
    total_customers: number;
    new_customers: number;
    repeat_customers: number;
    avg_repeat_rate_percent: number;
  };
}

const columns: DataTableColumn<DayRow>[] = [
  { key: 'date', header: 'Data' },
  { key: 'total_customers', header: 'Total', align: 'right' },
  { key: 'new_customers', header: 'Novos', align: 'right' },
  { key: 'repeat_customers', header: 'Recorrentes', align: 'right' },
  { key: 'repeat_rate_percent', header: 'Taxa de Recorrência', render: (r) => `${r.repeat_rate_percent}%`, align: 'right' },
];

export function RepeatedCustomers() {
  const { activeBranchId } = useBranchContext();
  const [range, setRange] = useState<DateRangeValue>(() => ({
    from: startOfMonth(new Date()),
    to: endOfDay(new Date()),
  }));
  const [data, setData] = useState<RepeatedCustomersData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      setError(null);
      const branch = activeBranchId === 'all' ? undefined : activeBranchId;
      const res = await call<{ message: RepeatedCustomersData }>('ury.ury.report_api.customers.get_repeated_customers', {
        branch,
        start_date: toApiDate(range.from),
        end_date: toApiDate(range.to),
      });
      setData(res.message ?? (res as unknown as RepeatedCustomersData));
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
          <h1 className="text-xl font-semibold">Clientes Recorrentes</h1>
          <p className="text-sm text-muted-foreground">
            Visitas novas vs. recorrentes {activeBranchId === 'all' ? '· Todas as Filiais' : ''}
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
            <StatCard label="Total de Visitas" value={data.summary.total_customers} icon={<Users className="w-4 h-4" />} />
            <StatCard label="Novos Clientes" value={data.summary.new_customers} icon={<UserPlus className="w-4 h-4" />} />
            <StatCard label="Visitas Recorrentes" value={data.summary.repeat_customers} icon={<Repeat className="w-4 h-4" />} />
            <StatCard
              label="Taxa Média de Recorrência"
              value={`${data.summary.avg_repeat_rate_percent}%`}
              icon={<Percent className="w-4 h-4" />}
            />
          </div>

          <BarChartCard
            title="Visitas Novas vs. Recorrentes"
            data={data.rows}
            xKey="date"
            yKeys={['new_customers', 'repeat_customers']}
            labels={{ new_customers: 'Novos Clientes', repeat_customers: 'Clientes Recorrentes' }}
          />

          <DataTable columns={columns} rows={data.rows} isLoading={isLoading} />
        </>
      ) : null}
    </div>
  );
}
