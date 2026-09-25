import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Spinner,
  StatCard,
  DataTable,
  showToast,
  type DataTableColumn,
} from '@ury/ui';
import { formatCurrency, parseFrappeError } from '@ury/core';
import {
  caixaService,
  type SellableItem,
  type SalesHistoryOrder,
  type CaixaOrderType,
} from '../../services/caixa';

type Tab = 'pedido' | 'historico';

interface CartLine {
  item: string;
  item_name: string;
  rate: number;
  qty: number;
}

const ORDER_TYPE_LABEL: Record<CaixaOrderType, string> = {
  'Take Away': 'Retirada',
  Delivery: 'Entrega',
};

export const CaixaPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('pedido');

  // Novo Pedido
  const [orderType, setOrderType] = useState<CaixaOrderType>('Take Away');
  const [items, setItems] = useState<SellableItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Histórico de Vendas
  const [historyDays, setHistoryDays] = useState(7);
  const [historyOrders, setHistoryOrders] = useState<SalesHistoryOrder[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    setLoadingItems(true);
    caixaService
      .sellableItems(orderType)
      .then(setItems)
      .catch(() => showToast.error('Não foi possível carregar o cardápio.'))
      .finally(() => setLoadingItems(false));
  }, [orderType]);

  function loadHistory(days: number) {
    setLoadingHistory(true);
    caixaService
      .salesHistory(days)
      .then((res) => {
        setHistoryOrders(res.orders);
        setHistoryTotal(res.total);
      })
      .catch(() => showToast.error('Não foi possível carregar o histórico de vendas.'))
      .finally(() => setLoadingHistory(false));
  }

  useEffect(() => {
    loadHistory(historyDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyDays]);

  function addToCart(item: SellableItem) {
    setCart((prev) => {
      const existing = prev.find((l) => l.item === item.item);
      if (existing) {
        return prev.map((l) => (l.item === item.item ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { item: item.item, item_name: item.item_name, rate: item.rate, qty: 1 }];
    });
  }

  function changeQty(itemCode: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.item === itemCode ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  function removeFromCart(itemCode: string) {
    setCart((prev) => prev.filter((l) => l.item !== itemCode));
  }

  const cartTotal = useMemo(() => cart.reduce((sum, l) => sum + l.rate * l.qty, 0), [cart]);

  function resetOrderForm() {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setDeliveryAddress('');
    setNotes('');
  }

  async function handleSubmitOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!customerPhone.trim()) {
      showToast.error('Informe o telefone do Cliente.');
      return;
    }
    if (cart.length === 0) {
      showToast.error('Adicione pelo menos um item ao pedido.');
      return;
    }
    if (orderType === 'Delivery' && !deliveryAddress.trim()) {
      showToast.error('Informe o endereço de entrega.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await caixaService.createOrder({
        items: cart.map((l) => ({ item: l.item, item_name: l.item_name, qty: l.qty })),
        order_type: orderType,
        customer_phone: customerPhone.trim(),
        customer_name: customerName.trim() || undefined,
        delivery_address: orderType === 'Delivery' ? deliveryAddress.trim() : undefined,
        notes: notes.trim() || undefined,
      });
      showToast.success(`Pedido registrado — ${result.invoice}`);
      resetOrderForm();
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível registrar o pedido.'));
    } finally {
      setSubmitting(false);
    }
  }

  const historyColumns = useMemo<DataTableColumn<SalesHistoryOrder>[]>(
    () => [
      {
        key: 'posting_date',
        header: 'Data',
        render: (o) => (
          <span className="whitespace-nowrap">
            {o.posting_date} <span className="text-muted-foreground">{o.posting_time?.slice(0, 5)}</span>
          </span>
        ),
      },
      { key: 'customer_name', header: 'Cliente' },
      {
        key: 'order_type',
        header: 'Modalidade',
        render: (o) => ORDER_TYPE_LABEL[o.order_type as CaixaOrderType] || o.order_type,
      },
      {
        key: 'grand_total',
        header: 'Total',
        align: 'right',
        render: (o) => <span className="tabular-nums">{formatCurrency(o.grand_total)}</span>,
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Caixa</h1>
      </div>

      <div className="flex gap-2">
        {(
          [
            { id: 'pedido' as const, label: 'Novo Pedido' },
            { id: 'historico' as const, label: 'Histórico de Vendas' },
          ]
        ).map((t) => (
          <Button
            key={t.id}
            variant="tab"
            size="sm"
            data-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'pedido' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Itens</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                {(['Take Away', 'Delivery'] as CaixaOrderType[]).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant="tab"
                    size="sm"
                    data-selected={orderType === t}
                    onClick={() => setOrderType(t)}
                  >
                    {ORDER_TYPE_LABEL[t]}
                  </Button>
                ))}
              </div>

              {loadingItems ? (
                <Spinner message="Carregando cardápio..." />
              ) : items.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  Nenhum item disponível no cardápio.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {items.map((item) => (
                    <button
                      key={item.item}
                      type="button"
                      disabled={!!item.sold_out}
                      onClick={() => addToCart(item)}
                      className="rounded-lg border border-gray-200 p-3 text-left hover:border-primary hover:bg-primary/5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="font-medium text-sm">{item.item_name}</div>
                      <div className="text-sm text-muted-foreground tabular-nums">
                        {formatCurrency(item.rate)}
                      </div>
                      {!!item.sold_out && (
                        <div className="text-xs text-destructive mt-1">Esgotado</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pedido</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmitOrder}>
                <div className="space-y-2">
                  {cart.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">
                      Nenhum item adicionado ainda.
                    </div>
                  ) : (
                    cart.map((line) => (
                      <div key={line.item} className="flex items-center justify-between gap-2 text-sm">
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium">{line.item_name}</div>
                          <div className="text-muted-foreground tabular-nums">
                            {formatCurrency(line.rate)} x {line.qty}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button type="button" variant="outline" size="sm" onClick={() => changeQty(line.item, -1)}>
                            -
                          </Button>
                          <span className="w-6 text-center tabular-nums">{line.qty}</span>
                          <Button type="button" variant="outline" size="sm" onClick={() => changeQty(line.item, 1)}>
                            +
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => removeFromCart(line.item)}>
                            x
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {cart.length > 0 && (
                  <div className="flex items-center justify-between border-t pt-2 font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatCurrency(cartTotal)}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="caixa-phone" className="text-sm font-medium">
                    Telefone do Cliente
                  </label>
                  <Input
                    id="caixa-phone"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="(00) 00000-0000"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="caixa-name" className="text-sm font-medium">
                    Nome do Cliente
                  </label>
                  <Input
                    id="caixa-name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Opcional"
                  />
                </div>

                {orderType === 'Delivery' && (
                  <div className="space-y-1.5">
                    <label htmlFor="caixa-address" className="text-sm font-medium">
                      Endereço de entrega
                    </label>
                    <Input
                      id="caixa-address"
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder="Rua, número, bairro"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="caixa-notes" className="text-sm font-medium">
                    Observações
                  </label>
                  <Input
                    id="caixa-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Opcional"
                  />
                </div>

                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? 'Registrando...' : 'Registrar Pedido'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'historico' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {[
              { label: 'Hoje', days: 1 },
              { label: '7 dias', days: 7 },
              { label: '30 dias', days: 30 },
            ].map((opt) => (
              <Button
                key={opt.days}
                variant="tab"
                size="sm"
                data-selected={historyDays === opt.days}
                onClick={() => setHistoryDays(opt.days)}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          {loadingHistory ? (
            <Spinner message="Carregando histórico..." />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <StatCard label="Total vendido no período" value={formatCurrency(historyTotal)} />
                <StatCard label="Pedidos concluídos" value={historyOrders.length} />
              </div>

              {historyOrders.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    Nenhum pedido concluído nesse período.
                  </CardContent>
                </Card>
              ) : (
                <DataTable columns={historyColumns} rows={historyOrders} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
