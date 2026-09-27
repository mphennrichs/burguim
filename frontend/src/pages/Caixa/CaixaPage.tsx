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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  showToast,
  type DataTableColumn,
} from '@ury/ui';
import { formatCurrency, parseFrappeError } from '@ury/core';
import {
  caixaService,
  type SellableItem,
  type SalesHistoryOrder,
  type CaixaOrderType,
  type OrderDetail,
  type CustomerRecord,
} from '../../services/caixa';
import { Switch } from '../../components/ui/switch';
import SideDrawer from '../../components/layout/SideDrawer';

type Tab = 'pedido' | 'historico' | 'clientes';

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

const AUTOFILL_STORAGE_KEY = 'caixaAutofillEnabled';

function formatDateTime(ts: string): string {
  const then = new Date(ts.replace(' ', 'T'));
  if (Number.isNaN(then.getTime())) return ts;
  return then.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

  // Autopreenchimento por telefone (Novo Pedido)
  const [autofillEnabled, setAutofillEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem(AUTOFILL_STORAGE_KEY);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });

  // Histórico de Vendas
  const [historyDays, setHistoryDays] = useState(7);
  const [historyOrders, setHistoryOrders] = useState<SalesHistoryOrder[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Detalhe do pedido (compartilhado entre Histórico e Clientes)
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<OrderDetail | null>(null);
  const [loadingOrderDetail, setLoadingOrderDetail] = useState(false);

  // Clientes
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [customerOrders, setCustomerOrders] = useState<SalesHistoryOrder[]>([]);
  const [loadingCustomerOrders, setLoadingCustomerOrders] = useState(false);
  const [editingAddress, setEditingAddress] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);

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

  function toggleAutofill(checked: boolean) {
    setAutofillEnabled(checked);
    try {
      localStorage.setItem(AUTOFILL_STORAGE_KEY, String(checked));
    } catch {
      // per-device convenience only - fine if it can't persist
    }
  }

  async function handlePhoneBlur() {
    const phone = customerPhone.trim();
    if (!autofillEnabled || !phone) return;
    try {
      const result = await caixaService.lookupCustomerByPhone(phone);
      if (!result.found) return;
      // Never overwrite something the Caixa already typed themselves.
      setCustomerName((prev) => prev || result.customer_name || '');
      setDeliveryAddress((prev) => prev || result.delivery_address || '');
      showToast.success(`Cliente reconhecido: ${result.customer_name || phone}`);
    } catch {
      // silent - autofill is a convenience, never blocks the order
    }
  }

  async function openOrderDetail(invoice: string) {
    setLoadingOrderDetail(true);
    setSelectedOrderDetail(null);
    try {
      const detail = await caixaService.orderDetail(invoice);
      setSelectedOrderDetail(detail);
    } catch {
      showToast.error('Não foi possível carregar o detalhe do pedido.');
    } finally {
      setLoadingOrderDetail(false);
    }
  }

  useEffect(() => {
    setLoadingCustomers(true);
    const timeout = setTimeout(() => {
      caixaService
        .customers(customerQuery.trim() || undefined)
        .then(setCustomers)
        .catch(() => showToast.error('Não foi possível carregar os clientes.'))
        .finally(() => setLoadingCustomers(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [customerQuery]);

  function openCustomerDrawer(customer: CustomerRecord) {
    setSelectedCustomer(customer);
    setEditingAddress(customer.delivery_address || '');
    setLoadingCustomerOrders(true);
    caixaService
      .customerOrders(customer.name)
      .then((res) => setCustomerOrders(res.orders))
      .catch(() => showToast.error('Não foi possível carregar o histórico do cliente.'))
      .finally(() => setLoadingCustomerOrders(false));
  }

  async function handleSaveAddress() {
    if (!selectedCustomer) return;
    setSavingAddress(true);
    try {
      await caixaService.updateCustomerAddress(selectedCustomer.name, editingAddress.trim());
      showToast.success('Endereço atualizado');
      setCustomers((prev) =>
        prev.map((c) => (c.name === selectedCustomer.name ? { ...c, delivery_address: editingAddress.trim() } : c)),
      );
      setSelectedCustomer((prev) => (prev ? { ...prev, delivery_address: editingAddress.trim() } : prev));
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível atualizar o endereço.'));
    } finally {
      setSavingAddress(false);
    }
  }

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

  const customerColumns = useMemo<DataTableColumn<CustomerRecord>[]>(
    () => [
      { key: 'customer_name', header: 'Nome' },
      { key: 'mobile_number', header: 'Telefone' },
      {
        key: 'delivery_address',
        header: 'Endereço',
        render: (c) => c.delivery_address || <span className="text-muted-foreground">—</span>,
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
            { id: 'clientes' as const, label: 'Clientes' },
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

                <div className="flex items-center gap-2 p-2.5 rounded-lg border border-gray-100 bg-gray-50/50">
                  <Switch
                    id="caixa-autofill"
                    checked={autofillEnabled}
                    onCheckedChange={toggleAutofill}
                  />
                  <label htmlFor="caixa-autofill" className="text-xs font-medium text-gray-700 cursor-pointer">
                    Preencher dados automaticamente
                  </label>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="caixa-phone" className="text-sm font-medium">
                    Telefone do Cliente
                  </label>
                  <Input
                    id="caixa-phone"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    onBlur={handlePhoneBlur}
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
                <DataTable columns={historyColumns} rows={historyOrders} onRowClick={(o) => openOrderDetail(o.name)} />
              )}
            </>
          )}
        </div>
      )}

      {tab === 'clientes' && (
        <div className="space-y-4">
          <Input
            value={customerQuery}
            onChange={(e) => setCustomerQuery(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            className="max-w-sm"
          />

          {loadingCustomers ? (
            <Spinner message="Carregando clientes..." />
          ) : customers.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                Nenhum cliente encontrado.
              </CardContent>
            </Card>
          ) : (
            <DataTable columns={customerColumns} rows={customers} onRowClick={openCustomerDrawer} />
          )}
        </div>
      )}

      <SideDrawer
        isOpen={!!selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
        title={selectedCustomer?.customer_name || 'Cliente'}
      >
        {selectedCustomer && (
          <div className="space-y-5 text-sm">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Telefone</label>
              <Input value={selectedCustomer.mobile_number} disabled />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cliente-address" className="text-sm font-medium">
                Endereço
              </label>
              <Input
                id="cliente-address"
                value={editingAddress}
                onChange={(e) => setEditingAddress(e.target.value)}
                placeholder="Rua, número, bairro"
              />
              <Button
                type="button"
                size="sm"
                disabled={savingAddress || editingAddress === (selectedCustomer.delivery_address || '')}
                onClick={handleSaveAddress}
              >
                {savingAddress ? 'Salvando...' : 'Salvar endereço'}
              </Button>
            </div>

            <div className="pt-2 border-t border-gray-100">
              <h3 className="font-semibold text-gray-700 mb-2">Histórico de pedidos</h3>
              {loadingCustomerOrders ? (
                <Spinner message="Carregando pedidos..." />
              ) : customerOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum pedido concluído ainda.</p>
              ) : (
                <div className="space-y-2">
                  {customerOrders.map((o) => (
                    <button
                      key={o.name}
                      type="button"
                      onClick={() => openOrderDetail(o.name)}
                      className="w-full text-left rounded-md border border-gray-100 p-2.5 hover:border-primary hover:bg-primary/5"
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span>
                          {o.posting_date} <span className="text-muted-foreground">{o.posting_time?.slice(0, 5)}</span>
                        </span>
                        <span className="tabular-nums font-medium">{formatCurrency(o.grand_total)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {ORDER_TYPE_LABEL[o.order_type as CaixaOrderType] || o.order_type}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SideDrawer>

      <Dialog open={!!selectedOrderDetail || loadingOrderDetail} onOpenChange={(open) => !open && setSelectedOrderDetail(null)}>
        <DialogContent size="lg" onClose={() => setSelectedOrderDetail(null)}>
          <DialogHeader>
            <DialogTitle>Pedido {selectedOrderDetail?.invoice}</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 space-y-4 text-sm overflow-y-auto max-h-[70vh]">
            {loadingOrderDetail || !selectedOrderDetail ? (
              <Spinner message="Carregando pedido..." />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{selectedOrderDetail.customer_name}</span>
                  {selectedOrderDetail.contact_mobile && (
                    <span className="text-muted-foreground">{selectedOrderDetail.contact_mobile}</span>
                  )}
                  <span className="text-muted-foreground">
                    · {ORDER_TYPE_LABEL[selectedOrderDetail.order_type as CaixaOrderType] || selectedOrderDetail.order_type}
                  </span>
                </div>
                {selectedOrderDetail.shipping_address && (
                  <p className="text-muted-foreground">{selectedOrderDetail.shipping_address}</p>
                )}

                <div>
                  <h3 className="font-semibold text-gray-700 mb-1.5">Itens</h3>
                  <div className="space-y-1">
                    {selectedOrderDetail.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span>
                          {item.item_name} × {item.qty}
                        </span>
                        <span className="tabular-nums">{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between border-t pt-2 mt-2 font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatCurrency(selectedOrderDetail.grand_total)}</span>
                  </div>
                </div>

                {selectedOrderDetail.notes && (
                  <div>
                    <h3 className="font-semibold text-gray-700 mb-1.5">Observações</h3>
                    <p className="rounded-md bg-muted p-2 italic text-muted-foreground">{selectedOrderDetail.notes}</p>
                  </div>
                )}

                <div>
                  <h3 className="font-semibold text-gray-700 mb-1.5">Linha do tempo</h3>
                  <div className="space-y-1">
                    {selectedOrderDetail.status_history.map((entry, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span>{entry.status}</span>
                        <span className="text-muted-foreground tabular-nums">{formatDateTime(entry.changed_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
