import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, Button, Badge, Spinner, showToast } from '@ury/ui';
import { formatCurrency } from '@ury/core';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { kitchenService, type KitchenOrder } from '../../services/kitchen';

// Tela de Cozinha (CONTEXT.md): a standalone screen with no sidebar/topbar,
// opened in its own tab from an icon in Painel/Sidebar - not a route nested
// under DashboardLayout. No socket/KDS infra in this app, so a short poll
// is the reasonable tradeoff against wiring up realtime here - 5s (down
// from the old delivery-only queue's 20s) keeps a new Pedido from Caixa
// showing up here noticeably late.
const POLL_INTERVAL_MS = 5000;

// Which columns are visible is a per-device preference (this screen is
// typically opened from a dedicated kitchen tablet, which should keep its
// own layout independent of whoever configured it) - not a shared/global
// URY setting like Sidebar's hidden-items feature.
const HIDDEN_COLUMNS_STORAGE_KEY = 'kitchenHiddenColumns';

const ORDER_TYPE_LABEL: Record<string, string> = {
  'Take Away': 'Retirada',
  Delivery: 'Entrega',
};

const STATUS_BADGE_VARIANT: Record<string, 'pending' | 'info' | 'warning' | 'completed' | 'danger'> = {
  'Na Fila': 'pending',
  Preparando: 'info',
  Pronto: 'warning',
  'Saiu para Entrega': 'warning',
  Entregue: 'completed',
  Cancelado: 'danger',
};

// One kanban column per Estado (CONTEXT.md) - mirrors kitchen.py's own
// _COMMON_STATES + _FLOWS shape (Na Fila/Preparando/Pronto shared by both
// Modalidades, then diverging) rather than re-deriving it. Retirado has no
// column of its own (not asked for) even though Entregue does - the same
// shape as Entregue's would cover it if that changes; get_kitchen_queue()
// only ever returns today's already-Entregue Pedidos (bounded, see its own
// docstring), everything else here is still in-progress (docstatus=0).
// Cancelado isn't part of kitchen.py's _FLOWS at all (it's a side branch
// reachable from any active state, not a sequential step) but still gets
// its own column here - a Pedido sits there, still docstatus=0, only
// while awaiting the devolver-ao-estoque decision; once resolved it's
// submitted and drops out, same as Retirado/Entregue.
const COLUMNS = [
  { status: 'Na Fila', label: 'Na Fila' },
  { status: 'Preparando', label: 'Preparando' },
  { status: 'Pronto', label: 'Pronto' },
  { status: 'Saiu para Entrega', label: 'Saiu para Entrega' },
  { status: 'Entregue', label: 'Entregue' },
  { status: 'Cancelado', label: 'Cancelados' },
] as const;

function loadHiddenColumns(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(HIDDEN_COLUMNS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

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
  resolving: boolean;
  onResolveCancel: (order: KitchenOrder, restock: boolean) => void;
  cancelling: boolean;
  confirmingCancel: boolean;
  onCancel: (order: KitchenOrder) => void;
}

const OrderCard: React.FC<OrderCardProps> = ({
  order,
  advancing,
  onAdvance,
  resolving,
  onResolveCancel,
  cancelling,
  confirmingCancel,
  onCancel,
}) => {
  const pendingCancelDecision = order.kitchen_status === 'Cancelado';
  return (
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
      <CardFooter className="flex-col items-stretch gap-2">
        {pendingCancelDecision ? (
          <>
            <p className="text-xs text-muted-foreground text-center">
              Este pedido já tinha item em preparo. Os ingredientes foram consumidos?
            </p>
            <div className="flex gap-2 w-full">
              <Button
                variant="outline"
                className="flex-1"
                disabled={resolving}
                onClick={() => onResolveCancel(order, true)}
              >
                Devolver ao estoque
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={resolving}
                onClick={() => onResolveCancel(order, false)}
              >
                Não devolver (perda)
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button className="w-full" disabled={!order.next_status || advancing} onClick={() => onAdvance(order)}>
              {advancing ? 'Atualizando...' : order.next_status ? `Marcar como ${order.next_status}` : 'Sem próximo estado'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-destructive hover:text-destructive"
              disabled={cancelling}
              onClick={() => onCancel(order)}
            >
              {confirmingCancel ? 'Confirmar cancelamento?' : 'Cancelar Pedido'}
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
};

export const KitchenScreenPage: React.FC = () => {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancingInvoice, setAdvancingInvoice] = useState<string | null>(null);
  const [cancellingInvoice, setCancellingInvoice] = useState<string | null>(null);
  const [confirmingCancelInvoice, setConfirmingCancelInvoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hiddenColumns, setHiddenColumns] = useState<Record<string, boolean>>(loadHiddenColumns);
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
        setIsColumnMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggleColumnVisibility(status: string) {
    setHiddenColumns((prev) => {
      const next = { ...prev, [status]: !prev[status] };
      localStorage.setItem(HIDDEN_COLUMNS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

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
      // Entregue still has its own column (get_kitchen_queue() keeps
      // today's Entregue Pedidos around), so only Retirado (no column)
      // needs to disappear here - everything else just moves column. The
      // full loadOrders() right after resolves either case properly; this
      // just keeps the screen from looking stale for the ~20s until then.
      setOrders((prev) =>
        prev
          .map((o) => (o.invoice === order.invoice ? { ...o, kitchen_status: order.next_status! } : o))
          .filter((o) => o.invoice !== order.invoice || o.kitchen_status !== 'Retirado')
      );
      loadOrders();
    } catch {
      setError('Não foi possível atualizar o pedido. Tente novamente.');
    } finally {
      setAdvancingInvoice(null);
    }
  }

  async function handleCancel(order: KitchenOrder) {
    if (confirmingCancelInvoice !== order.invoice) {
      setConfirmingCancelInvoice(order.invoice);
      return;
    }
    setConfirmingCancelInvoice(null);
    setCancellingInvoice(order.invoice);
    try {
      const result = await kitchenService.cancel(order.invoice);
      showToast.success(
        result.status === 'pending_decision'
          ? 'Pedido movido para Cancelados — decida se devolve os ingredientes.'
          : 'Pedido cancelado.',
      );
      loadOrders();
    } catch {
      showToast.error('Não foi possível cancelar o pedido. Tente novamente.');
    } finally {
      setCancellingInvoice(null);
    }
  }

  async function handleResolveCancel(order: KitchenOrder, restock: boolean) {
    setCancellingInvoice(order.invoice);
    try {
      await kitchenService.resolveCancelled(order.invoice, restock);
      showToast.success(restock ? 'Estoque devolvido — pedido cancelado.' : 'Perda registrada — pedido cancelado.');
      loadOrders();
    } catch {
      showToast.error('Não foi possível concluir o cancelamento. Tente novamente.');
    } finally {
      setCancellingInvoice(null);
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

  // Entregue is already-completed reference, not part of "how many
  // pedidos need attention right now" - excluded from the header count.
  const activeOrdersCount = orders.filter(
    (o) => o.kitchen_status !== 'Entregue' && o.kitchen_status !== 'Cancelado',
  ).length;
  const visibleColumns = COLUMNS.filter((column) => !hiddenColumns[column.status]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Tela de Cozinha</h1>
        <div className="flex items-center gap-2">
          <Badge variant={activeOrdersCount > 0 ? 'warning' : 'secondary'}>
            {activeOrdersCount} {activeOrdersCount === 1 ? 'pedido' : 'pedidos'}
          </Badge>
          <div className="relative" ref={columnMenuRef}>
            <button
              type="button"
              onClick={() => setIsColumnMenuOpen((prev) => !prev)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <SlidersHorizontal className="w-4 h-4" />
              Colunas
            </button>
            {isColumnMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1.5 z-50">
                {COLUMNS.map((column) => (
                  <label
                    key={column.status}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenColumns[column.status]}
                      onChange={() => toggleColumnVisibility(column.status)}
                      className="rounded border-gray-300"
                    />
                    {column.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-6">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mb-4">{error}</div>
        )}

        {loading ? (
          <Spinner message="Carregando pedidos..." />
        ) : (
          <div className="flex gap-4 items-start overflow-x-auto pb-4">
            {visibleColumns.map((column) => {
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
                            resolving={cancellingInvoice === order.invoice}
                            onResolveCancel={handleResolveCancel}
                            cancelling={cancellingInvoice === order.invoice}
                            confirmingCancel={confirmingCancelInvoice === order.invoice}
                            onCancel={handleCancel}
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
