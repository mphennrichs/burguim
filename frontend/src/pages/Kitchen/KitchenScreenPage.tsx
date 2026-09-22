import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, Button, Badge, Spinner } from '@ury/ui';
import { formatCurrency } from '@ury/core';
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

export const KitchenScreenPage: React.FC = () => {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancingInvoice, setAdvancingInvoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        ) : orders.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Nenhum pedido na fila no momento.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {orders.map((order) => (
              <Card key={order.invoice}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="truncate">{order.customer_name}</CardTitle>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(order.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{ORDER_TYPE_LABEL[order.order_type] ?? order.order_type}</Badge>
                    <Badge variant={STATUS_BADGE_VARIANT[order.kitchen_status] ?? 'secondary'}>
                      {order.kitchen_status}
                    </Badge>
                  </div>
                  {order.order_type === 'Delivery' && order.delivery_phone && (
                    <p className="text-sm text-muted-foreground">{order.delivery_phone}</p>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {order.order_type === 'Delivery' && order.delivery_address && (
                    <p className="text-sm">{order.delivery_address}</p>
                  )}
                  {order.notes && (
                    <p className="rounded-md bg-muted p-2 text-sm italic text-muted-foreground">
                      Obs: {order.notes}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">{itemsSummary(order)}</p>
                  <div className="flex justify-between border-t pt-2 text-sm font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatCurrency(order.grand_total)}</span>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    disabled={!order.next_status || advancingInvoice === order.invoice}
                    onClick={() => handleAdvance(order)}
                  >
                    {advancingInvoice === order.invoice
                      ? 'Atualizando...'
                      : order.next_status
                        ? `Marcar como ${order.next_status}`
                        : 'Sem próximo estado'}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default KitchenScreenPage;
