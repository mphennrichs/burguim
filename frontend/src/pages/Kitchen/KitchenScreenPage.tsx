import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, Button, Badge, Spinner } from '@ury/ui';
import { formatCurrency } from '@ury/core';
import { ChevronDown } from 'lucide-react';
import { kitchenService, type KitchenOrder } from '../../services/kitchen';

// Tela de Cozinha (CONTEXT.md): a standalone screen with no sidebar/topbar,
// opened in its own tab from an icon in Painel/Sidebar - not a route nested
// under DashboardLayout. No socket/KDS infra in this app, so a 20s poll
// (same interval the delivery-only queue it replaces used) is the
// reasonable tradeoff against wiring up realtime here.
const POLL_INTERVAL_MS = 20000;

const ORDER_TYPE_LABEL: Record<string, string> = {
  'Take Away': 'Retirada',
  Delivery: 'Entrega',
};

const STATUS_BADGE_VARIANT: Record<string, 'pending' | 'info' | 'warning'> = {
  'Na Fila': 'pending',
  Preparando: 'info',
  'Pronto para Retirada': 'warning',
  'Saiu para Entrega': 'warning',
};

// One kanban column per active (non-terminal) Estado - Retirado/Entregue
// never appear here, since reaching either submits the invoice and drops
// it out of get_kitchen_queue()'s docstatus=0 filter. Mirrors kitchen.py's
// own _COMMON_STATES + _FLOWS shape (Na Fila/Preparando shared by both
// Modalidades, then diverging) rather than re-deriving it.
const COLUMNS = [
  { status: 'Na Fila', label: 'Na Fila' },
  { status: 'Preparando', label: 'Preparando' },
  { status: 'Pronto para Retirada', label: 'Pronto para Retirada' },
  { status: 'Saiu para Entrega', label: 'Saiu para Entrega' },
] as const;

function timeAgo(isoTimestamp: string): string {
  const then = new Date(isoTimestamp.replace(' ', 'T'));
  const minutes = Math.max(0, Math.floor((Date.now() - then.getTime()) / 60000));
  if (minutes < 1) return 'agora mesmo';
  if (minutes === 1) return 'há 1 minuto';
  if (minutes < 60) return `há ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? 'há 1 hora' : `há ${hours} horas`;
}

function itemsSummary(order: KitchenOrder): string {
  return order.items.map((item) => `${item.item_name} ×${item.qty}`).join(', ');
}

interface OrderCardProps {
  order: KitchenOrder;
  advancing: boolean;
  onAdvance: (order: KitchenOrder) => void;
}

const OrderCard: React.FC<OrderCardProps> = ({ order, advancing, onAdvance }) => (
  <Card>
    <CardHeader>
      <div className="flex items-center justify-between gap-2">
        <CardTitle className="truncate text-base">{order.customer_name}</CardTitle>
        <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(order.created_at)}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline">{ORDER_TYPE_LABEL[order.order_type] ?? order.order_type}</Badge>
      </div>
      {order.order_type === 'Delivery' && order.delivery_phone && (
        <p className="text-sm text-muted-foreground">{order.delivery_phone}</p>
      )}
    </CardHeader>
    <CardContent className="space-y-2">
      {order.order_type === 'Delivery' && order.delivery_address && (
        <p className="text-sm">{order.delivery_address}</p>
      )}
      {order.notes && (
        <p className="rounded-md bg-muted p-2 text-sm italic text-muted-foreground">Obs: {order.notes}</p>
      )}
      <p className="text-sm text-muted-foreground">{itemsSummary(order)}</p>
      <div className="flex justify-between border-t pt-2 text-sm font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatCurrency(order.grand_total)}</span>
      </div>
    </CardContent>
    <CardFooter>
      <Button className="w-full" disabled={!order.next_status || advancing} onClick={() => onAdvance(order)}>
        {advancing ? 'Atualizando...' : order.next_status ? `Marcar como ${order.next_status}` : 'Sem próximo estado'}
      </Button>
    </CardFooter>
  </Card>
);

export const KitchenScreenPage: React.FC = () => {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancingInvoice, setAdvancingInvoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const loadOrders = useCallback(async () => {
    try {
      const result = await kitchenService.queue();
      setOrders(result);
      setError(null);
    } catch {
      setError('Não foi possível carregar a fila de pedidos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
    const interval = setInterval(loadOrders, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadOrders]);

  async function handleAdvance(order: KitchenOrder) {
    if (!order.next_status) return;
    setAdvancingInvoice(order.invoice);
    try {
      await kitchenService.advance(order.invoice, order.next_status);
      // The order either moves to its next state or, if that was the
      // flow's terminal one, falls off the queue entirely (submitted) -
      // either way the next poll would resolve it, but updating/removing
      // it here keeps the screen from looking stale for 20s.
      setOrders((prev) =>
        prev
          .map((o) => (o.invoice === order.invoice ? { ...o, kitchen_status: order.next_status! } : o))
          .filter((o) => o.invoice !== order.invoice || !['Retirado', 'Entregue'].includes(o.kitchen_status))
      );
      loadOrders();
    } catch {
      setError('Não foi possível atualizar o pedido. Tente novamente.');
    } finally {
      setAdvancingInvoice(null);
    }
  }

  function toggleColumn(status: string) {
    setCollapsed((prev) => ({ ...prev, [status]: !prev[status] }));
  }

  const ordersByStatus = useMemo(() => {
    const grouped: Record<string, KitchenOrder[]> = {};
    for (const column of COLUMNS) grouped[column.status] = [];
    for (const order of orders) {
      (grouped[order.kitchen_status] ??= []).push(order);
    }
    return grouped;
  }, [orders]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Tela de Cozinha</h1>
        <Badge variant={orders.length > 0 ? 'warning' : 'secondary'}>
          {orders.length} {orders.length === 1 ? 'pedido' : 'pedidos'}
        </Badge>
      </div>

      <div className="p-6">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mb-4">{error}</div>
        )}

        {loading ? (
          <Spinner message="Carregando pedidos..." />
        ) : (
          <div className="flex gap-4 items-start overflow-x-auto pb-4">
            {COLUMNS.map((column) => {
              const columnOrders = ordersByStatus[column.status] ?? [];
              const isCollapsed = !!collapsed[column.status];
              return (
                <div
                  key={column.status}
                  className="w-80 shrink-0 rounded-lg border border-gray-200 bg-white shadow-xs"
                >
                  <button
                    type="button"
                    onClick={() => toggleColumn(column.status)}
                    className="w-full flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100"
                  >
                    <span className="flex items-center gap-2 font-semibold text-gray-900">
                      {column.label}
                      <Badge variant={STATUS_BADGE_VARIANT[column.status] ?? 'secondary'} size="sm">
                        {columnOrders.length}
                      </Badge>
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-gray-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                    />
                  </button>

                  {!isCollapsed && (
                    <div className="p-3 space-y-3 max-h-[calc(100vh-220px)] overflow-y-auto">
                      {columnOrders.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">Nenhum pedido</p>
                      ) : (
                        columnOrders.map((order) => (
                          <OrderCard
                            key={order.invoice}
                            order={order}
                            advancing={advancingInvoice === order.invoice}
                            onAdvance={handleAdvance}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default KitchenScreenPage;
