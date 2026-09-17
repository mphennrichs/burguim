import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Select,
  Spinner,
  showToast,
} from '@ury/ui';
import {
  stockOverviewService,
  type BomCandidateItem,
  type BomOutputCandidateItem,
  type Bom,
} from '../../services/stockOverview';
import { CreateItemInline } from '../../components/common/CreateItemInline';

type Tab = 'receitas' | 'nova';

interface IngredientRow {
  item_code: string;
  qty: string;
}

function emptyRow(): IngredientRow {
  return { item_code: '', qty: '' };
}

export const BomPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('receitas');
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<BomCandidateItem[]>([]);
  const [outputCandidates, setOutputCandidates] = useState<BomOutputCandidateItem[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);

  const [outputItem, setOutputItem] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [rows, setRows] = useState<IngredientRow[]>([emptyRow()]);
  const [submitting, setSubmitting] = useState(false);

  function reloadAll() {
    setLoading(true);
    return Promise.all([
      stockOverviewService.bomCandidates(),
      stockOverviewService.bomOutputCandidates(),
      stockOverviewService.boms(),
    ])
      .then(([candidateResult, outputResult, bomResult]) => {
        setCandidates(candidateResult);
        setOutputCandidates(outputResult);
        setBoms(bomResult);
      })
      .catch(() => showToast.error('Não foi possível carregar as receitas.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reloadAll();
  }, []);

  const candidateByCode = useMemo(
    () => new Map(candidates.map((c) => [c.name, c])),
    [candidates],
  );
  const outputCandidateByCode = useMemo(
    () => new Map(outputCandidates.map((c) => [c.name, c])),
    [outputCandidates],
  );

  function updateRow(index: number, patch: Partial<IngredientRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function handleIngredientCreated(item: { name: string; stock_uom: string }) {
    setCandidates((prev) => [...prev, { name: item.name, item_name: item.name, stock_uom: item.stock_uom }]);
    setRows((prev) => {
      const emptyIndex = prev.findIndex((r) => !r.item_code);
      if (emptyIndex === -1) return [...prev, { item_code: item.name, qty: '' }];
      return prev.map((r, i) => (i === emptyIndex ? { ...r, item_code: item.name } : r));
    });
  }

  function handleOutputCreated(item: { name: string; stock_uom: string }) {
    setOutputCandidates((prev) => [
      ...prev,
      { name: item.name, item_name: item.name, stock_uom: item.stock_uom, has_batch_no: 0 },
    ]);
    setOutputItem(item.name);
  }

  function resetForm() {
    setOutputItem('');
    setQuantity('1');
    setRows([emptyRow()]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(quantity);
    if (!outputItem) {
      showToast.error('Selecione o item que a receita produz.');
      return;
    }
    if (!qty || qty <= 0) {
      showToast.error('Informe um rendimento válido.');
      return;
    }
    const ingredients = rows
      .filter((r) => r.item_code && Number(r.qty) > 0)
      .map((r) => ({ item_code: r.item_code, qty: Number(r.qty) }));
    if (ingredients.length === 0) {
      showToast.error('Adicione pelo menos um ingrediente com quantidade válida.');
      return;
    }
    if (ingredients.some((i) => i.item_code === outputItem)) {
      showToast.error('Um item não pode ser ingrediente da própria receita.');
      return;
    }

    setSubmitting(true);
    try {
      await stockOverviewService.createBom({ item_code: outputItem, quantity: qty, ingredients });
      showToast.success('Receita cadastrada.');
      resetForm();
      await reloadAll();
      setTab('receitas');
    } catch {
      showToast.error('Não foi possível cadastrar a receita. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Receitas (BOM)</h1>
      </div>

      {loading ? (
        <Spinner message="Carregando receitas..." />
      ) : (
        <>
          <div className="flex gap-2">
            {(
              [
                { id: 'receitas' as const, label: 'Receitas cadastradas' },
                { id: 'nova' as const, label: 'Nova receita' },
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

          {tab === 'receitas' && (
            boms.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  Nenhuma receita cadastrada ainda. Crie uma na aba &quot;Nova receita&quot;.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {boms.map((bom) => (
                  <Card key={bom.name}>
                    <CardHeader>
                      <CardTitle>{bom.item_name}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        Rende {bom.quantity} {bom.uom}
                      </p>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1.5">
                        {bom.ingredients.map((ing) => (
                          <li
                            key={ing.item_code}
                            className="flex items-center justify-between text-sm border-b border-border last:border-b-0 py-1.5"
                          >
                            <span>{ing.item_name}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {ing.qty} {ing.uom}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )
          )}

          {tab === 'nova' && (
              <Card className="max-w-2xl">
                <CardHeader>
                  <CardTitle>Nova receita</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={handleSubmit}>
                    <div className="space-y-1.5">
                      <label htmlFor="bom-output" className="text-sm font-medium">
                        O que essa receita produz
                      </label>
                      <Select id="bom-output" value={outputItem} onChange={(e) => setOutputItem(e.target.value)}>
                        <option value="">Selecione um item</option>
                        {outputCandidates.map((item) => (
                          <option key={item.name} value={item.name}>
                            {item.item_name}
                          </option>
                        ))}
                      </Select>
                      <CreateItemInline kind="composed" label="Criar item novo" onCreated={handleOutputCreated} />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="bom-quantity" className="text-sm font-medium">
                        Rendimento {outputItem ? `(${outputCandidateByCode.get(outputItem)?.stock_uom ?? ''})` : ''}
                      </label>
                      <Input
                        id="bom-quantity"
                        type="number"
                        min="0"
                        step="0.001"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="1"
                      />
                    </div>

                    <div className="space-y-2">
                      <span className="text-sm font-medium">Ingredientes</span>
                      {rows.map((row, index) => (
                        <div key={index} className="flex items-end gap-2">
                          <div className="flex-1 space-y-1.5">
                            {index === 0 && (
                              <label htmlFor={`bom-ing-item-${index}`} className="text-xs text-muted-foreground">
                                Ingrediente
                              </label>
                            )}
                            <Select
                              id={`bom-ing-item-${index}`}
                              value={row.item_code}
                              onChange={(e) => updateRow(index, { item_code: e.target.value })}
                            >
                              <option value="">Selecione</option>
                              {candidates.map((item) => (
                                <option key={item.name} value={item.name}>
                                  {item.item_name}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="w-32 space-y-1.5">
                            {index === 0 && (
                              <label htmlFor={`bom-ing-qty-${index}`} className="text-xs text-muted-foreground">
                                Quantidade {row.item_code ? `(${candidateByCode.get(row.item_code)?.stock_uom ?? ''})` : ''}
                              </label>
                            )}
                            <Input
                              id={`bom-ing-qty-${index}`}
                              type="number"
                              min="0"
                              step="0.001"
                              value={row.qty}
                              onChange={(e) => updateRow(index, { qty: e.target.value })}
                              placeholder="0"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeRow(index)}
                            disabled={rows.length === 1}
                            aria-label="Remover ingrediente"
                          >
                            ×
                          </Button>
                        </div>
                      ))}
                      <div className="flex items-center gap-4">
                        <Button type="button" variant="outline" size="sm" onClick={addRow}>
                          + Adicionar ingrediente
                        </Button>
                        <CreateItemInline
                          kind="ingredient"
                          label="Criar ingrediente novo"
                          onCreated={handleIngredientCreated}
                        />
                      </div>
                    </div>

                    <Button type="submit" disabled={submitting} className="w-full">
                      {submitting ? 'Cadastrando...' : 'Cadastrar receita'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
          )}
        </>
      )}
    </div>
  );
};

export default BomPage;
