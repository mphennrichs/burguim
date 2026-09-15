import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Input,
  Select,
  Spinner,
  StatCard,
  DataTable,
  showToast,
  type DataTableColumn,
  type BadgeProps,
} from '@ury/ui';
import { formatCurrency } from '@ury/core';
import {
  stockOverviewService,
  type MenuCostItem,
  type ExpiringBatch,
  type PurchasableItem,
  type ProductionItem,
} from '../../services/stockOverview';

type Tab = 'custos' | 'validade' | 'comprar' | 'produzir';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

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
  const [purchasableItems, setPurchasableItems] = useState<PurchasableItem[]>([]);
  const [productionItems, setProductionItems] = useState<ProductionItem[]>([]);

  const [form, setForm] = useState({
    item_code: '',
    qty: '',
    rate: '',
    purchase_date: todayIso(),
    expiry_date: '',
  });
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [prodForm, setProdForm] = useState({
    item_code: '',
    qty: '',
    purchase_date: todayIso(),
    expiry_date: '',
  });
  const [prodExpiryTouched, setProdExpiryTouched] = useState(false);
  const [prodSubmitting, setProdSubmitting] = useState(false);

  function reloadAll() {
    setLoading(true);
    return Promise.all([
      stockOverviewService.menuCosts(),
      stockOverviewService.expiringBatches(14),
      stockOverviewService.purchasableItems(),
      stockOverviewService.productionItems(),
    ])
      .then(([costResult, batchResult, purchasableResult, productionResult]) => {
        setMenuItems(costResult.items);
        setBatches(batchResult);
        setPurchasableItems(purchasableResult);
        setProductionItems(productionResult);
        setError(null);
      })
      .catch(() => setError('Não foi possível carregar os dados de estoque.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reloadAll();
  }, []);

  const selectedItem = purchasableItems.find((i) => i.name === form.item_code) ?? null;

  function handleItemChange(itemCode: string) {
    const item = purchasableItems.find((i) => i.name === itemCode) ?? null;
    setExpiryTouched(false);
    setForm((prev) => ({
      ...prev,
      item_code: itemCode,
      rate: item?.last_buying_rate != null ? String(item.last_buying_rate) : prev.rate,
      expiry_date:
        item?.shelf_life_in_days != null
          ? addDaysIso(prev.purchase_date, item.shelf_life_in_days)
          : '',
    }));
  }

  function handlePurchaseDateChange(dateIso: string) {
    setForm((prev) => ({
      ...prev,
      purchase_date: dateIso,
      expiry_date:
        !expiryTouched && selectedItem?.shelf_life_in_days != null
          ? addDaysIso(dateIso, selectedItem.shelf_life_in_days)
          : prev.expiry_date,
    }));
  }

  async function handleSubmitPurchase(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(form.qty);
    const rate = Number(form.rate);
    if (!form.item_code) {
      showToast.error('Selecione um ingrediente.');
      return;
    }
    if (!qty || qty <= 0) {
      showToast.error('Informe uma quantidade válida.');
      return;
    }
    if (!rate || rate <= 0) {
      showToast.error('Informe um preço válido.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await stockOverviewService.recordPurchase({
        item_code: form.item_code,
        qty,
        rate,
        purchase_date: form.purchase_date || undefined,
        expiry_date: form.expiry_date || undefined,
      });
      showToast.success(`Compra registrada — lote ${result.batch_no}`);
      setForm({ item_code: '', qty: '', rate: '', purchase_date: todayIso(), expiry_date: '' });
      setExpiryTouched(false);
      await reloadAll();
      setTab('validade');
    } catch {
      showToast.error('Não foi possível registrar a compra. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  const selectedProdItem = productionItems.find((i) => i.name === prodForm.item_code) ?? null;

  function handleProdItemChange(itemCode: string) {
    const item = productionItems.find((i) => i.name === itemCode) ?? null;
    setProdExpiryTouched(false);
    setProdForm((prev) => ({
      ...prev,
      item_code: itemCode,
      expiry_date:
        item?.shelf_life_in_days != null
          ? addDaysIso(prev.purchase_date, item.shelf_life_in_days)
          : '',
    }));
  }

  function handleProdDateChange(dateIso: string) {
    setProdForm((prev) => ({
      ...prev,
      purchase_date: dateIso,
      expiry_date:
        !prodExpiryTouched && selectedProdItem?.shelf_life_in_days != null
          ? addDaysIso(dateIso, selectedProdItem.shelf_life_in_days)
          : prev.expiry_date,
    }));
  }

  async function handleSubmitProduction(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(prodForm.qty);
    if (!prodForm.item_code) {
      showToast.error('Selecione o que você preparou.');
      return;
    }
    if (!qty || qty <= 0) {
      showToast.error('Informe uma quantidade válida.');
      return;
    }

    setProdSubmitting(true);
    try {
      const result = await stockOverviewService.recordProduction({
        item_code: prodForm.item_code,
        qty,
        purchase_date: prodForm.purchase_date || undefined,
        expiry_date: prodForm.expiry_date || undefined,
      });
      showToast.success(`Produção registrada — lote ${result.batch_no}`);
      setProdForm({ item_code: '', qty: '', purchase_date: todayIso(), expiry_date: '' });
      setProdExpiryTouched(false);
      await reloadAll();
      setTab('validade');
    } catch {
      showToast.error('Não foi possível registrar a produção. Confira se há ingrediente suficiente em estoque.');
    } finally {
      setProdSubmitting(false);
    }
  }

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
                { id: 'comprar' as const, label: 'Registrar Compra' },
                { id: 'produzir' as const, label: 'Registrar Produção' },
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

          {tab === 'custos' && (
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
          )}

          {tab === 'validade' && (
            batches.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  Nenhum lote com validade cadastrada em estoque no momento. Registre uma compra na aba ao lado.
                </CardContent>
              </Card>
            ) : (
              <DataTable columns={batchColumns} rows={batches} />
            )
          )}

          {tab === 'comprar' && (
            <Card className="max-w-xl">
              <CardHeader>
                <CardTitle>Registrar compra de ingrediente</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={handleSubmitPurchase}>
                  <div className="space-y-1.5">
                    <label htmlFor="purchase-item" className="text-sm font-medium">
                      Ingrediente
                    </label>
                    <Select
                      id="purchase-item"
                      value={form.item_code}
                      onChange={(e) => handleItemChange(e.target.value)}
                    >
                      <option value="">Selecione um ingrediente</option>
                      {purchasableItems.map((item) => (
                        <option key={item.name} value={item.name}>
                          {item.item_name} ({item.stock_uom})
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="purchase-qty" className="text-sm font-medium">
                        Quantidade {selectedItem ? `(${selectedItem.stock_uom})` : ''}
                      </label>
                      <Input
                        id="purchase-qty"
                        type="number"
                        min="0"
                        step="0.001"
                        value={form.qty}
                        onChange={(e) => setForm((prev) => ({ ...prev, qty: e.target.value }))}
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="purchase-rate" className="text-sm font-medium">
                        Preço pago (por {selectedItem?.stock_uom ?? 'unidade'})
                      </label>
                      <Input
                        id="purchase-rate"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.rate}
                        onChange={(e) => setForm((prev) => ({ ...prev, rate: e.target.value }))}
                        placeholder="0,00"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="purchase-date" className="text-sm font-medium">
                        Data da compra
                      </label>
                      <Input
                        id="purchase-date"
                        type="date"
                        value={form.purchase_date}
                        onChange={(e) => handlePurchaseDateChange(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="purchase-expiry" className="text-sm font-medium">
                        Validade
                      </label>
                      <Input
                        id="purchase-expiry"
                        type="date"
                        value={form.expiry_date}
                        onChange={(e) => {
                          setExpiryTouched(true);
                          setForm((prev) => ({ ...prev, expiry_date: e.target.value }));
                        }}
                      />
                    </div>
                  </div>

                  <Button type="submit" disabled={submitting} className="w-full">
                    {submitting ? 'Registrando...' : 'Registrar compra'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {tab === 'produzir' && (
            <Card className="max-w-xl">
              <CardHeader>
                <CardTitle>Registrar produção</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Pra itens preparados na casa (com receita própria cadastrada). Os ingredientes são
                  descontados do estoque automaticamente, na proporção da receita.
                </p>
                {productionItems.length === 0 ? (
                  <div className="rounded-md bg-orange-50 border border-orange-200 p-3 text-sm text-orange-800">
                    Nenhum item com receita própria cadastrada ainda. Cadastre uma BOM no Frappe Desk pra um
                    item (ex: um molho ou preparo feito com antecedência) pra ele aparecer aqui.
                  </div>
                ) : (
                  <form className="space-y-4" onSubmit={handleSubmitProduction}>
                    <div className="space-y-1.5">
                      <label htmlFor="prod-item" className="text-sm font-medium">
                        O que você preparou
                      </label>
                      <Select
                        id="prod-item"
                        value={prodForm.item_code}
                        onChange={(e) => handleProdItemChange(e.target.value)}
                      >
                        <option value="">Selecione</option>
                        {productionItems.map((item) => (
                          <option key={item.name} value={item.name}>
                            {item.item_name} ({item.stock_uom})
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label htmlFor="prod-qty" className="text-sm font-medium">
                          Quantidade produzida {selectedProdItem ? `(${selectedProdItem.stock_uom})` : ''}
                        </label>
                        <Input
                          id="prod-qty"
                          type="number"
                          min="0"
                          step="0.001"
                          value={prodForm.qty}
                          onChange={(e) => setProdForm((prev) => ({ ...prev, qty: e.target.value }))}
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="prod-date" className="text-sm font-medium">
                          Data do preparo
                        </label>
                        <Input
                          id="prod-date"
                          type="date"
                          value={prodForm.purchase_date}
                          onChange={(e) => handleProdDateChange(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="prod-expiry" className="text-sm font-medium">
                        Validade
                      </label>
                      <Input
                        id="prod-expiry"
                        type="date"
                        value={prodForm.expiry_date}
                        onChange={(e) => {
                          setProdExpiryTouched(true);
                          setProdForm((prev) => ({ ...prev, expiry_date: e.target.value }));
                        }}
                      />
                    </div>

                    <Button type="submit" disabled={prodSubmitting} className="w-full">
                      {prodSubmitting ? 'Registrando...' : 'Registrar produção'}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default StockOverviewPage;
