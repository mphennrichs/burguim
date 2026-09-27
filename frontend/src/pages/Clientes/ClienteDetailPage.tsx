import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { ArrowLeft } from 'lucide-react';
import {
  caixaService,
  type CustomerRecord,
  type SalesHistoryOrder,
  type CaixaOrderType,
} from '../../services/caixa';
import { OrderDetailDialog } from '../../components/common/OrderDetailDialog';

const ORDER_TYPE_LABEL: Record<CaixaOrderType, string> = {
  'Take Away': 'Retirada',
  Delivery: 'Entrega',
};

export const ClienteDetailPage: React.FC = () => {
  const { customer: customerName } = useParams<{ customer: string }>();
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [loadingCustomer, setLoadingCustomer] = useState(true);

  const [orders, setOrders] = useState<SalesHistoryOrder[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [loadingOrders, setLoadingOrders] = useState(true);

  const [editingAddress, setEditingAddress] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);

  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);

  useEffect(() => {
    if (!customerName) return;
    setLoadingCustomer(true);
    caixaService
      .customer(customerName)
      .then((c) => {
        setCustomer(c);
        setEditingAddress(c.delivery_address || '');
      })
      .catch(() => showToast.error('Não foi possível carregar o cliente.'))
      .finally(() => setLoadingCustomer(false));

    setLoadingOrders(true);
    caixaService
      .customerOrders(customerName)
      .then((res) => {
        setOrders(res.orders);
        setOrdersTotal(res.total);
      })
      .catch(() => showToast.error('Não foi possível carregar o histórico de pedidos.'))
      .finally(() => setLoadingOrders(false));
  }, [customerName]);

  async function handleSaveAddress() {
    if (!customer) return;
    setSavingAddress(true);
    try {
      await caixaService.updateCustomerAddress(customer.name, editingAddress.trim());
      showToast.success('Endereço atualizado');
      setCustomer((prev) => (prev ? { ...prev, delivery_address: editingAddress.trim() } : prev));
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível atualizar o endereço.'));
    } finally {
      setSavingAddress(false);
    }
  }

  // orders comes back most-recent-first (get_customer_orders' own order_by)
  const firstOrder = orders.length > 0 ? orders[orders.length - 1] : null;
  const lastOrder = orders.length > 0 ? orders[0] : null;

  const columns = useMemo<DataTableColumn<SalesHistoryOrder>[]>(
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
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/clientes')} className="flex items-center gap-1.5">
          <ArrowLeft className="w-4 h-4" />
          Clientes
        </Button>
      </div>

      {loadingCustomer || !customer ? (
        <Spinner message="Carregando cliente..." />
      ) : (
        <>
          <h1 className="text-xl font-semibold">{customer.customer_name}</h1>

          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle>Dados do Cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Telefone</label>
                <Input value={customer.mobile_number} disabled />
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
                  disabled={savingAddress || editingAddress === (customer.delivery_address || '')}
                  onClick={handleSaveAddress}
                >
                  {savingAddress ? 'Salvando...' : 'Salvar endereço'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {loadingOrders ? (
            <Spinner message="Carregando pedidos..." />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatCard label="Total de pedidos" value={orders.length} />
                <StatCard label="Total gasto" value={formatCurrency(ordersTotal)} />
                <StatCard label="Primeiro pedido" value={firstOrder ? firstOrder.posting_date : '—'} />
                <StatCard label="Último pedido" value={lastOrder ? lastOrder.posting_date : '—'} />
              </div>

              <div>
                <h2 className="font-semibold text-gray-700 mb-2">Histórico de pedidos</h2>
                {orders.length === 0 ? (
                  <Card>
                    <CardContent className="py-10 text-center text-muted-foreground">
                      Nenhum pedido concluído ainda.
                    </CardContent>
                  </Card>
                ) : (
                  <DataTable columns={columns} rows={orders} onRowClick={(o) => setSelectedInvoice(o.name)} />
                )}
              </div>
            </>
          )}
        </>
      )}

      <OrderDetailDialog invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
    </div>
  );
};

export default ClienteDetailPage;
