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
import { formatCurrency, translateUom } from '@ury/core';
import {
  stockOverviewService,
  type MenuCostItem,
  type ExpiringBatch,
  type ConsolidatedStockItem,
  type PurchasableItem,
  type ProductionItem,
} from '../../services/stockOverview';
import { Switch } from '../../components/ui/switch';
import { CreateItemInline } from '../../components/common/CreateItemInline';

type Tab = 'custos' | 'validade' | 'consolidado' | 'comprar' | 'produzir' | 'config';

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

// Stock is always kept (and recipes always measured) in the smaller unit
// of each pair - Gram, Millilitre - since that's the precision a recipe
// actually needs (10g of alface, 50ml of maionese). A purchase is almost
// always bulk though (4 litros de leite, 2kg de patinho), so this offers
// the bigger metric unit too and converts 1:1000 on submit - the batch
// itself still ends up stored in the item's real stock_uom, unchanged
// from what recordPurchase always expected.
const _BULK_UNIT_FOR: Record<string, string> = { Gram: 'Kg', Millilitre: 'Litre' };

function purchaseUnitOptions(stockUom: string | undefined): string[] {
  if (!stockUom) return [];
  const bulk = _BULK_UNIT_FOR[stockUom];
  return bulk ? [bulk, stockUom] : [stockUom];
}

function defaultPurchaseUnit(stockUom: string | undefined): string {
  return purchaseUnitOptions(stockUom)[0] ?? '';
}

function purchaseUnitFactor(purchaseUnit: string, stockUom: string | undefined): number {
  return purchaseUnit !== stockUom && _BULK_UNIT_FOR[stockUom ?? ''] === purchaseUnit ? 1000 : 1;
}

// Same bulk-unit idea, for reading a quantity back instead of entering
// one: a batch/stock total is always stored in the base unit (grams,
// millilitres - what a recipe actually consumes), but showing "10000
// Grama" instead of "10 Kg" on a stock screen is the kind of number a
// person has to mentally divide by 1000 to make sense of.
function formatBulkQty(qty: number, stockUom: string | undefined): string {
  const bulk = _BULK_UNIT_FOR[stockUom ?? ''];
  if (bulk) {
    const converted = qty / 1000;
    const rounded = Math.round(converted * 1000) / 1000;
    return `${rounded} ${translateUom(bulk)}`;
  }
  return `${qty} ${translateUom(stockUom)}`;
}

export const StockOverviewPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('custos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [menuItems, setMenuItems] = useState<MenuCostItem[]>([]);
  const [batches, setBatches] = useState<ExpiringBatch[]>([]);
  const [consolidatedStock, setConsolidatedStock] = useState<ConsolidatedStockItem[]>([]);
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
  const [purchaseUnit, setPurchaseUnit] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [prodForm, setProdForm] = useState({
    item_code: '',
    qty: '',
    purchase_date: todayIso(),
    expiry_date: '',
  });
  const [prodExpiryTouched, setProdExpiryTouched] = useState(false);
  const [prodSubmitting, setProdSubmitting] = useState(false);

  const [blockOnInsufficientStock, setBlockOnInsufficientStock] = useState(false);
  const [savingStockSettings, setSavingStockSettings] = useState(false);

  function reloadAll() {
    setLoading(true);
    return Promise.all([
      stockOverviewService.menuCosts(),
      stockOverviewService.expiringBatches(14),
      stockOverviewService.consolidatedStock(),
      stockOverviewService.purchasableItems(),
      stockOverviewService.productionItems(),
      stockOverviewService.getStockSettings(),
    ])
      .then(([costResult, batchResult, consolidatedResult, purchasableResult, productionResult, settingsResult]) => {
        setMenuItems(costResult.items);
        setBatches(batchResult);
        setConsolidatedStock(consolidatedResult);
        setPurchasableItems(purchasableResult);
        setProductionItems(productionResult);
        setBlockOnInsufficientStock(settingsResult.block_sale_on_insufficient_stock);
        setError(null);
      })
      .catch(() => setError('Não foi possível carregar os dados de estoque.'))
      .finally(() => setLoading(false));
  }

  async function handleToggleBlockOnInsufficientStock(checked: boolean) {
    setBlockOnInsufficientStock(checked);
    setSavingStockSettings(true);
    try {
      await stockOverviewService.updateStockSettings(checked);
      showToast.success('Configuração de estoque atualizada.');
    } catch {
      setBlockOnInsufficientStock(!checked);
      showToast.error('Não foi possível salvar. Tente novamente.');
    } finally {
      setSavingStockSettings(false);
    }
  }

  useEffect(() => {
    reloadAll();
  }, []);

  const selectedItem = purchasableItems.find((i) => i.name === form.item_code) ?? null;

  function handleItemChange(itemCode: string) {
    const item = purchasableItems.find((i) => i.name === itemCode) ?? null;
    const unit = defaultPurchaseUnit(item?.stock_uom);
    const factor = purchaseUnitFactor(unit, item?.stock_uom);
    setExpiryTouched(false);
    setPurchaseUnit(unit);
    setForm((prev) => ({
      ...prev,
      item_code: itemCode,
      // last_buying_rate is stored per stock_uom (the base unit) - scale
      // it into whatever unit is now pre-selected (Kg/Litre default to
      // bulk) so the field shows a sensible number, not the raw per-gram
      // price where a per-kg one was expected.
      rate: item?.last_buying_rate != null ? String(item.last_buying_rate * factor) : prev.rate,
      expiry_date:
        item?.shelf_life_in_days != null
          ? addDaysIso(prev.purchase_date, item.shelf_life_in_days)
          : '',
    }));
  }

  function handlePurchaseUnitChange(unit: string) {
    const prevFactor = purchaseUnitFactor(purchaseUnit, selectedItem?.stock_uom);
    const nextFactor = purchaseUnitFactor(unit, selectedItem?.stock_uom);
    setPurchaseUnit(unit);
    // Keep the same real-world quantity/price the fields represent when
    // switching units mid-entry, instead of leaving stale numbers behind
    // in the new unit's scale (4 "Litros" silently becoming 4 "ml").
    setForm((prev) => ({
      ...prev,
      qty: prev.qty ? String((Number(prev.qty) * prevFactor) / nextFactor) : prev.qty,
      rate: prev.rate ? String((Number(prev.rate) * nextFactor) / prevFactor) : prev.rate,
    }));
  }

  function handleIngredientCreated(item: { name: string; stock_uom: string }) {
    setPurchasableItems((prev) => [
      ...prev,
      { name: item.name, item_name: item.name, stock_uom: item.stock_uom, shelf_life_in_days: null, last_buying_rate: null },
    ]);
    handleItemChange(item.name);
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
    const enteredQty = Number(form.qty);
    const enteredRate = Number(form.rate);
    if (!form.item_code) {
      showToast.error('Selecione um ingrediente.');
      return;
    }
    if (!enteredQty || enteredQty <= 0) {
      showToast.error('Informe uma quantidade válida.');
      return;
    }
    if (!enteredRate || enteredRate <= 0) {
      showToast.error('Informe um preço válido.');
      return;
    }

    // The batch is always recorded in the item's own stock_uom - convert
    // out of whatever bulk unit (Kg/Litre) was picked for entry. qty
    // scales up, rate scales down by the same factor so qty × rate (the
    // total paid) comes out the same either way.
    const factor = purchaseUnitFactor(purchaseUnit, selectedItem?.stock_uom);
    const qty = enteredQty * factor;
    const rate = enteredRate / factor;

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
      setPurchaseUnit('');
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
        render: (b) => <span className="tabular-nums">{formatBulkQty(b.qty, b.uom)}</span>,
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

  const consolidatedColumns = useMemo<DataTableColumn<ConsolidatedStockItem>[]>(
    () => [
      { key: 'item_name', header: 'Ingrediente', render: (i) => <span className="font-medium">{i.item_name}</span> },
      {
        key: 'qty',
        header: 'Estoque total',
        align: 'right',
        render: (i) => <span className="tabular-nums">{formatBulkQty(i.qty, i.uom)}</span>,
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
                { id: 'consolidado' as const, label: 'Estoque Consolidado' },
                { id: 'comprar' as const, label: 'Registrar Compra' },
                { id: 'produzir' as const, label: 'Registrar Produção' },
                { id: 'config' as const, label: 'Configurações' },
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
                  . Cadastre a receita em &quot;Receitas (BOM)&quot; ou registre uma compra com preço para ver o custo aqui.
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

          {tab === 'consolidado' && (
            consolidatedStock.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  Nenhum estoque dentro da validade no momento. Registre uma compra na aba ao lado.
                </CardContent>
              </Card>
            ) : (
              <DataTable columns={consolidatedColumns} rows={consolidatedStock} />
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
                          {item.item_name}
                        </option>
                      ))}
                    </Select>
                    <CreateItemInline
                      kind="ingredient"
                      label="Criar ingrediente novo"
                      onCreated={handleIngredientCreated}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="purchase-qty" className="text-sm font-medium">
                        Quantidade
                      </label>
                      <div className="flex gap-1.5">
                        <Input
                          id="purchase-qty"
                          type="number"
                          min="0"
                          step="0.001"
                          value={form.qty}
                          onChange={(e) => setForm((prev) => ({ ...prev, qty: e.target.value }))}
                          placeholder="0"
                        />
                        {selectedItem && purchaseUnitOptions(selectedItem.stock_uom).length > 1 ? (
                          <div className="w-28 shrink-0">
                            <Select
                              value={purchaseUnit}
                              onChange={(e) => handlePurchaseUnitChange(e.target.value)}
                            >
                              {purchaseUnitOptions(selectedItem.stock_uom).map((u) => (
                                <option key={u} value={u}>
                                  {translateUom(u)}
                                </option>
                              ))}
                            </Select>
                          </div>
                        ) : (
                          selectedItem && (
                            <span className="flex items-center px-2 text-sm text-muted-foreground shrink-0">
                              {translateUom(selectedItem.stock_uom)}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="purchase-rate" className="text-sm font-medium">
                        Preço pago (por {selectedItem ? translateUom(purchaseUnit || selectedItem.stock_uom) : 'unidade'})
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
                    Nenhum item com receita própria cadastrada ainda. Cadastre uma receita em &quot;Receitas
                    (BOM)&quot; pra um item (ex: um molho ou preparo feito com antecedência) pra ele aparecer aqui.
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
                            {item.item_name}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label htmlFor="prod-qty" className="text-sm font-medium">
                          Quantidade produzida {selectedProdItem ? `(${translateUom(selectedProdItem.stock_uom)})` : ''}
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

          {tab === 'config' && (
            <Card className="max-w-xl">
              <CardHeader>
                <CardTitle>Configurações de estoque</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Bloquear venda sem estoque suficiente
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Quando ligado, uma venda é recusada se faltar estoque de algum ingrediente —
                      seja o próprio item (quando pré-produzido) ou, para itens montados na hora,
                      qualquer parte da receita. Desligado (padrão), a venda sempre é concluída — o
                      estoque só é descontado até onde houver.
                    </p>
                  </div>
                  <Switch
                    checked={blockOnInsufficientStock}
                    onCheckedChange={handleToggleBlockOnInsufficientStock}
                    disabled={savingStockSettings}
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default StockOverviewPage;
