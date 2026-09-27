import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  Button,
  Input,
  Spinner,
  DataTable,
  showToast,
  type DataTableColumn,
} from '@ury/ui';
import { formatCurrency, parseFrappeError } from '@ury/core';
import { caixaService, type CustomerRecord, type SalesHistoryOrder, type CaixaOrderType } from '../../services/caixa';
import SideDrawer from '../../components/layout/SideDrawer';
import { OrderDetailDialog } from '../../components/common/OrderDetailDialog';

const ORDER_TYPE_LABEL: Record<CaixaOrderType, string> = {
  'Take Away': 'Retirada',
  Delivery: 'Entrega',
};

export const ClientesPage: React.FC = () => {
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [customerOrders, setCustomerOrders] = useState<SalesHistoryOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [editingAddress, setEditingAddress] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);

  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const timeout = setTimeout(() => {
      caixaService
        .customers(query.trim() || undefined)
        .then(setCustomers)
        .catch(() => showToast.error('Não foi possível carregar os clientes.'))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  function openCustomer(customer: CustomerRecord) {
    setSelectedCustomer(customer);
    setEditingAddress(customer.delivery_address || '');
    setLoadingOrders(true);
    caixaService
      .customerOrders(customer.name)
      .then((res) => setCustomerOrders(res.orders))
      .catch(() => showToast.error('Não foi possível carregar o histórico do cliente.'))
      .finally(() => setLoadingOrders(false));
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

  const columns = useMemo<DataTableColumn<CustomerRecord>[]>(
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
        <h1 className="text-xl font-semibold">Clientes</h1>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por nome ou telefone"
        className="max-w-sm"
      />

      {loading ? (
        <Spinner message="Carregando clientes..." />
      ) : customers.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nenhum cliente encontrado.
          </CardContent>
        </Card>
      ) : (
        <DataTable columns={columns} rows={customers} onRowClick={openCustomer} />
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
              {loadingOrders ? (
                <Spinner message="Carregando pedidos..." />
              ) : customerOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum pedido concluído ainda.</p>
              ) : (
                <div className="space-y-2">
                  {customerOrders.map((o) => (
                    <button
                      key={o.name}
                      type="button"
                      onClick={() => setSelectedInvoice(o.name)}
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

      <OrderDetailDialog invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
    </div>
  );
};

export default ClientesPage;
