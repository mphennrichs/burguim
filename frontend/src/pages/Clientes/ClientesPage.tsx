import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, Input, Spinner, DataTable, showToast, type DataTableColumn } from '@ury/ui';
import { caixaService, type CustomerRecord } from '../../services/caixa';

export const ClientesPage: React.FC = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);

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
        <DataTable columns={columns} rows={customers} onRowClick={(c) => navigate(`/clientes/${encodeURIComponent(c.name)}`)} />
      )}
    </div>
  );
};

export default ClientesPage;
