import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, Button, Badge, Spinner } from '@ury/ui';
import { formatCurrency } from '@ury/core';
import { deliveryOrdersService, type DeliveryOrder } from '../../services/deliveryOrders';

// No socket/KDS infra in this app (unlike Mosaic) — a small business
// checking one screen every 20s to catch a new order is a reasonable
// tradeoff against wiring up realtime here. Only polls the pending tab —
// history doesn't change from outside this page's own actions.
const POLL_INTERVAL_MS = 20000;

type Tab = 'pending' | 'history';

function timeAgo(isoTimestamp: string): string {
  const then = new Date(isoTimestamp.replace(' ', 'T'));
  const minutes = Math.max(0, Math.floor((Date.now() - then.getTime()) / 60000));
  if (minutes < 1) return 'agora mesmo';
  if (minutes === 1) return 'há 1 minuto';
  if (minutes < 60) return `há ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? 'há 1 hora' : `há ${hours} horas`;
}

export const DeliveryOrdersPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('pending');
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingInvoice, setCompletingInvoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async (activeTab: Tab) => {
    try {
      const result = activeTab === 'pending' ? await deliveryOrdersService.list() : await deliveryOrdersService.history();
      setOrders(result);
      setError(null);
    } catch {
      setError(
        activeTab === 'pending'
          ? 'Não foi possível carregar os pedidos.'
          : 'Não foi possível carregar o histórico.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadOrders(tab);
    if (tab !== 'pending') return;
    const interval = setInterval(() => loadOrders(tab), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [tab, loadOrders]);

  async function handleComplete(invoice: string) {
    setCompletingInvoice(invoice);
    try {
      await deliveryOrdersService.markComplete(invoice);
      // Optimistic removal — the order fell off the pending queue the
      // moment the submit succeeded; no need to wait for the next poll.
      setOrders((prev) => prev.filter((order) => order.invoice !== invoice));
    } catch {
      setError('Não foi possível marcar o pedido como entregue. Tente novamente.');
    } finally {
      setCompletingInvoice(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Pedidos de Delivery</h1>
        {tab === 'pending' && (
          <Badge variant={orders.length > 0 ? 'warning' : 'secondary'}>
            {orders.length} {orders.length === 1 ? 'pendente' : 'pendentes'}
          </Badge>
        )}
      </div>

      <div className="flex gap-2">
        {(
          [
            { id: 'pending' as const, label: 'Pendentes' },
            { id: 'history' as const, label: 'Histórico' },
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

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {loading ? (
        <Spinner message="Carregando pedidos..." />
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {tab === 'pending' ? 'Nenhum pedido de delivery pendente no momento.' : 'Nenhum pedido concluído ainda.'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <Card key={order.invoice}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate">{order.customer_name}</CardTitle>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {tab === 'pending' ? timeAgo(order.created_at) : order.completed_at ? timeAgo(order.completed_at) : ''}
                  </span>
                </div>
                {order.delivery_phone && (
                  <p className="text-sm text-muted-foreground">{order.delivery_phone}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {order.delivery_address && <p className="text-sm">{order.delivery_address}</p>}
                {order.notes && (
                  <p className="rounded-md bg-muted p-2 text-sm italic text-muted-foreground">
                    Obs: {order.notes}
                  </p>
                )}
                <ul className="space-y-1 text-sm">
                  {order.items.map((item, idx) => (
                    <li key={idx} className="flex justify-between gap-2">
                      <span className="truncate">
                        {item.item_name} × {item.qty}
                      </span>
                      <span className="shrink-0 tabular-nums">{formatCurrency(item.amount)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-between border-t pt-2 text-sm font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrency(order.grand_total)}</span>
                </div>
              </CardContent>
              <CardFooter>
                {tab === 'pending' ? (
                  <Button
                    className="w-full"
                    disabled={completingInvoice === order.invoice}
                    onClick={() => handleComplete(order.invoice)}
                  >
                    {completingInvoice === order.invoice ? 'Marcando...' : 'Marcar como entregue'}
                  </Button>
                ) : (
                  <Badge variant="completed" className="w-full justify-center py-2">
                    Entregue
                  </Badge>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default DeliveryOrdersPage;
