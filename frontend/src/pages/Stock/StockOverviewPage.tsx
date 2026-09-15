import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  Button,
  Badge,
  Spinner,
  StatCard,
  DataTable,
  type DataTableColumn,
  type BadgeProps,
} from '@ury/ui';
import { formatCurrency } from '@ury/core';
import {
  stockOverviewService,
  type MenuCostItem,
  type ExpiringBatch,
} from '../../services/stockOverview';

type Tab = 'custos' | 'validade';

const EXPIRY_BADGE: Record<ExpiringBatch['status'], { variant: BadgeProps['variant']; label: string }> = {
  expired: { variant: 'danger', label: 'Vencido' },
  critical: { variant: 'danger', label: 'Vence em breve' },
  warning: { variant: 'warning', label: 'Atenção' },
  ok: { variant: 'success', label: 'Ok' },
};

function formatDaysLeft(days: number): string {
  if (days < 0) return `Venceu há ${Math.abs(days)} ${Math.abs(days) === 1 ? 'dia' : 'dias'}`;
  if (days === 0) return 'Vence hoje';
  if (days === 1) return 'Vence amanhã';
  return `Vence em ${days} dias`;
}

export const StockOverviewPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('custos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [menuItems, setMenuItems] = useState<MenuCostItem[]>([]);
  const [batches, setBatches] = useState<ExpiringBatch[]>([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([stockOverviewService.menuCosts(), stockOverviewService.expiringBatches(14)])
      .then(([costResult, batchResult]) => {
        setMenuItems(costResult.items);
        setBatches(batchResult);
        setError(null);
      })
      .catch(() => setError('Não foi possível carregar os dados de estoque.'))
      .finally(() => setLoading(false));
  }, []);

  const itemsMissingCost = useMemo(
    () => menuItems.filter((item) => item.cost === null),
    [menuItems],
  );
  const itemsWithCost = useMemo(
    () => menuItems.filter((item) => item.cost !== null),
    [menuItems],
  );
  const averageMarginPercent = useMemo(() => {
    if (itemsWithCost.length === 0) return null;
    const sum = itemsWithCost.reduce((acc, item) => acc + (item.margin_percent ?? 0), 0);
    return sum / itemsWithCost.length;
  }, [itemsWithCost]);

  const urgentBatches = useMemo(
    () => batches.filter((b) => b.status === 'expired' || b.status === 'critical'),
    [batches],
  );

  const costColumns = useMemo<DataTableColumn<MenuCostItem>[]>(
    () => [
      { key: 'item_name', header: 'Produto', render: (i) => <span className="font-medium">{i.item_name}</span> },
      {
        key: 'rate',
        header: 'Preço de venda',
        align: 'right',
        render: (i) => <span className="tabular-nums">{formatCurrency(i.rate)}</span>,
      },
      {
        key: 'cost',
        header: 'Custo',
        align: 'right',
        render: (i) =>
          i.cost !== null ? (
            <span className="tabular-nums">{formatCurrency(i.cost)}</span>
          ) : (
            <Badge variant="warning" size="sm">Sem custo cadastrado</Badge>
          ),
      },
      {
        key: 'margin',
        header: 'Margem',
        align: 'right',
        render: (i) =>
          i.margin !== null ? (
            <span className="tabular-nums">{formatCurrency(i.margin)}</span>
          ) : (
            '—'
          ),
      },
      {
        key: 'margin_percent',
        header: 'Margem %',
        align: 'right',
        render: (i) =>
          i.margin_percent !== null ? (
            <Badge variant={i.margin_percent >= 50 ? 'success' : i.margin_percent >= 20 ? 'warning' : 'danger'} size="sm">
              {i.margin_percent.toFixed(1)}%
            </Badge>
          ) : (
            '—'
          ),
      },
    ],
    [],
  );

  const batchColumns = useMemo<DataTableColumn<ExpiringBatch>[]>(
    () => [
      { key: 'item_name', header: 'Ingrediente', render: (b) => <span className="font-medium">{b.item_name}</span> },
      { key: 'batch_no', header: 'Lote', render: (b) => <span className="text-muted-foreground">{b.batch_no}</span> },
      {
        key: 'qty',
        header: 'Quantidade',
        align: 'right',
        render: (b) => (
          <span className="tabular-nums">
            {b.qty} {b.uom}
          </span>
        ),
      },
      {
        key: 'expiry_date',
        header: 'Validade',
        render: (b) => <span className="whitespace-nowrap">{formatDaysLeft(b.days_left)}</span>,
      },
      {
        key: 'status',
        header: '',
        align: 'right',
        render: (b) => (
          <Badge variant={EXPIRY_BADGE[b.status].variant} size="sm">
            {EXPIRY_BADGE[b.status].label}
          </Badge>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Meu Estoque</h1>
      </div>

      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      {loading ? (
        <Spinner message="Carregando estoque..." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Produtos com custo calculado"
              value={`${itemsWithCost.length} / ${menuItems.length}`}
            />
            <StatCard
              label="Margem média"
              value={averageMarginPercent !== null ? `${averageMarginPercent.toFixed(1)}%` : '—'}
            />
            <StatCard
              label="Lotes vencendo em breve"
              value={urgentBatches.length}
              delta={
                urgentBatches.length > 0
                  ? { value: 'requer atenção', direction: 'down' }
                  : undefined
              }
            />
          </div>

          <div className="flex gap-2">
            {(
              [
                { id: 'custos' as const, label: 'Custo & Margem' },
                { id: 'validade' as const, label: 'Validade' },
              ]
            ).map((item) => (
              <Button
                key={item.id}
                variant="tab"
                size="sm"
                data-selected={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>

          {tab === 'custos' ? (
            <div className="space-y-4">
              {itemsMissingCost.length > 0 && (
                <div className="rounded-md bg-orange-50 border border-orange-200 p-3 text-sm text-orange-800">
                  {itemsMissingCost.length === 1
                    ? '1 produto do cardápio ainda não tem receita (BOM) ou preço de compra cadastrado:'
                    : `${itemsMissingCost.length} produtos do cardápio ainda não têm receita (BOM) ou preço de compra cadastrado:`}{' '}
                  <span className="font-medium">
                    {itemsMissingCost.map((i) => i.item_name).join(', ')}
                  </span>
                  . Cadastre a BOM ou o preço de compra no Frappe Desk para ver o custo aqui.
                </div>
              )}
              {menuItems.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    Nenhum produto no cardápio ainda.
                  </CardContent>
                </Card>
              ) : (
                <DataTable columns={costColumns} rows={menuItems} />
              )}
            </div>
          ) : batches.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                Nenhum lote com validade cadastrada em estoque no momento.
              </CardContent>
            </Card>
          ) : (
            <DataTable columns={batchColumns} rows={batches} />
          )}
        </>
      )}
    </div>
  );
};

export default StockOverviewPage;
