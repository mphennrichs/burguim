import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Select,
  Textarea,
  Spinner,
  DataTable,
  showToast,
  type DataTableColumn,
} from '@ury/ui';
import { translateUom, parseFrappeError } from '@ury/core';
import {
  stockOverviewService,
  type BomCandidateItem,
  type BomOutputCandidateItem,
  type Bom,
  type Ingredient,
  type ComposedItem,
} from '../../services/stockOverview';
import { CreateItemInline } from '../../components/common/CreateItemInline';

type Tab = 'receitas' | 'ingredientes' | 'compostos' | 'nova';

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
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [composedItems, setComposedItems] = useState<ComposedItem[]>([]);

  const [editingBom, setEditingBom] = useState<Bom | null>(null);
  const [outputItemName, setOutputItemName] = useState('');
  const [outputItem, setOutputItem] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [preparationNotes, setPreparationNotes] = useState('');
  const [rows, setRows] = useState<IngredientRow[]>([emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [savingBom, setSavingBom] = useState<string | null>(null);
  const [confirmingDeleteBom, setConfirmingDeleteBom] = useState<string | null>(null);

  const [ingredientDrafts, setIngredientDrafts] = useState<
    Record<string, { description: string; shelfLife: string }>
  >({});
  const [savingIngredient, setSavingIngredient] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const [savingComposed, setSavingComposed] = useState<string | null>(null);
  const [confirmingDeleteComposed, setConfirmingDeleteComposed] = useState<string | null>(null);

  function reloadAll() {
    setLoading(true);
    return Promise.all([
      stockOverviewService.bomCandidates(),
      stockOverviewService.bomOutputCandidates(),
      stockOverviewService.boms(),
      stockOverviewService.ingredients(),
      stockOverviewService.composedItems(),
    ])
      .then(([candidateResult, outputResult, bomResult, ingredientResult, composedResult]) => {
        setCandidates(candidateResult);
        setOutputCandidates(outputResult);
        setBoms(bomResult);
        setIngredients(ingredientResult);
        setComposedItems(composedResult);
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

  function handleIngredientCreated(item: {
    name: string;
    stock_uom: string;
    shelf_life_in_days: number | null;
    description: string | null;
  }) {
    setCandidates((prev) => [...prev, { name: item.name, item_name: item.name, stock_uom: item.stock_uom }]);
    setRows((prev) => {
      const emptyIndex = prev.findIndex((r) => !r.item_code);
      if (emptyIndex === -1) return [...prev, { item_code: item.name, qty: '' }];
      return prev.map((r, i) => (i === emptyIndex ? { ...r, item_code: item.name } : r));
    });
  }

  function handleIngredientCreatedInTab(item: {
    name: string;
    stock_uom: string;
    shelf_life_in_days: number | null;
    description: string | null;
  }) {
    setCandidates((prev) => [...prev, { name: item.name, item_name: item.name, stock_uom: item.stock_uom }]);
    setIngredients((prev) => [
      ...prev,
      {
        name: item.name,
        item_name: item.name,
        stock_uom: item.stock_uom,
        item_group: '',
        shelf_life_in_days: item.shelf_life_in_days,
        description: item.description,
      },
    ]);
  }

  function handleOutputCreated(item: { name: string; stock_uom: string }) {
    setOutputCandidates((prev) => [
      ...prev,
      { name: item.name, item_name: item.name, stock_uom: item.stock_uom, has_batch_no: 0 },
    ]);
    setOutputItem(item.name);
  }

  function handleIngredientDraftChange(itemCode: string, patch: Partial<{ description: string; shelfLife: string }>) {
    setIngredientDrafts((prev) => ({
      ...prev,
      [itemCode]: { ...defaultIngredientDraft(itemCode), ...prev[itemCode], ...patch },
    }));
  }

  function defaultIngredientDraft(itemCode: string) {
    const ing = ingredients.find((i) => i.name === itemCode);
    return { description: ing?.description ?? '', shelfLife: String(ing?.shelf_life_in_days ?? '') };
  }

  async function handleSaveIngredient(itemCode: string) {
    const draft = ingredientDrafts[itemCode] ?? defaultIngredientDraft(itemCode);
    const shelfLifeInDays = draft.shelfLife.trim() !== '' ? Number(draft.shelfLife) : null;
    setSavingIngredient(itemCode);
    try {
      await stockOverviewService.updateIngredient({
        item_code: itemCode,
        shelf_life_in_days: shelfLifeInDays,
        description: draft.description.trim() || null,
      });
      setIngredients((prev) =>
        prev.map((i) =>
          i.name === itemCode ? { ...i, shelf_life_in_days: shelfLifeInDays, description: draft.description.trim() || null } : i,
        ),
      );
      showToast.success('Ingrediente atualizado.');
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível salvar. Tente novamente.'));
    } finally {
      setSavingIngredient(null);
    }
  }

  async function handleDeleteIngredient(itemCode: string) {
    if (confirmingDelete !== itemCode) {
      setConfirmingDelete(itemCode);
      return;
    }
    setConfirmingDelete(null);
    setSavingIngredient(itemCode);
    try {
      await stockOverviewService.deleteIngredient(itemCode);
      setIngredients((prev) => prev.filter((i) => i.name !== itemCode));
      setCandidates((prev) => prev.filter((c) => c.name !== itemCode));
      showToast.success('Ingrediente excluído.');
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível excluir o ingrediente.'));
    } finally {
      setSavingIngredient(null);
    }
  }

  async function handleDisableIngredient(itemCode: string) {
    setSavingIngredient(itemCode);
    try {
      await stockOverviewService.disableItem(itemCode);
      setIngredients((prev) => prev.filter((i) => i.name !== itemCode));
      setCandidates((prev) => prev.filter((c) => c.name !== itemCode));
      showToast.success('Ingrediente desativado.');
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível desativar o ingrediente.'));
    } finally {
      setSavingIngredient(null);
    }
  }

  const ingredientColumns = useMemo<DataTableColumn<Ingredient>[]>(
    () => [
      {
        key: 'item_name',
        header: 'Ingrediente',
        render: (i) => <span className="font-medium">{i.item_name}</span>,
      },
      {
        key: 'description',
        header: 'Descrição',
        render: (i) => (
          <Input
            className="min-w-[160px]"
            value={ingredientDrafts[i.name]?.description ?? i.description ?? ''}
            onChange={(e) => handleIngredientDraftChange(i.name, { description: e.target.value })}
            placeholder="Opcional"
          />
        ),
      },
      {
        key: 'shelf_life_in_days',
        header: 'Validade padrão (dias)',
        render: (i) => (
          <Input
            type="number"
            min="0"
            className="w-24"
            value={ingredientDrafts[i.name]?.shelfLife ?? (i.shelf_life_in_days ?? '')}
            onChange={(e) => handleIngredientDraftChange(i.name, { shelfLife: e.target.value })}
            placeholder="—"
          />
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (i) => (
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={savingIngredient === i.name}
              onClick={() => handleSaveIngredient(i.name)}
            >
              Salvar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={savingIngredient === i.name}
              onClick={() => handleDisableIngredient(i.name)}
              title="Tira o ingrediente das listas sem apagar o histórico de compras/produção"
            >
              Desativar
            </Button>
            <Button
              type="button"
              size="sm"
              variant={confirmingDelete === i.name ? 'danger' : 'ghost'}
              disabled={savingIngredient === i.name}
              onClick={() => handleDeleteIngredient(i.name)}
            >
              {confirmingDelete === i.name ? 'Confirmar exclusão?' : 'Excluir'}
            </Button>
          </div>
        ),
      },
    ],
    [ingredientDrafts, savingIngredient, confirmingDelete, ingredients],
  );

  async function handleDeleteComposedItem(itemCode: string) {
    if (confirmingDeleteComposed !== itemCode) {
      setConfirmingDeleteComposed(itemCode);
      return;
    }
    setConfirmingDeleteComposed(null);
    setSavingComposed(itemCode);
    try {
      await stockOverviewService.deleteComposedItem(itemCode);
      setComposedItems((prev) => prev.filter((i) => i.name !== itemCode));
      setCandidates((prev) => prev.filter((c) => c.name !== itemCode));
      setOutputCandidates((prev) => prev.filter((c) => c.name !== itemCode));
      showToast.success('Item excluído.');
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível excluir o item.'));
    } finally {
      setSavingComposed(null);
    }
  }

  async function handleDisableComposedItem(itemCode: string) {
    setSavingComposed(itemCode);
    try {
      await stockOverviewService.disableItem(itemCode);
      setComposedItems((prev) => prev.filter((i) => i.name !== itemCode));
      setCandidates((prev) => prev.filter((c) => c.name !== itemCode));
      setOutputCandidates((prev) => prev.filter((c) => c.name !== itemCode));
      showToast.success('Item desativado.');
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível desativar o item.'));
    } finally {
      setSavingComposed(null);
    }
  }

  async function handleMarkPreparedAhead(itemCode: string) {
    setSavingComposed(itemCode);
    try {
      await stockOverviewService.markPreparedAhead(itemCode);
      // Once has_batch_no flips it stops matching get_composed_items'
      // own filter (has_batch_no=0) - drop it from this list, same as a
      // delete/disable would, instead of leaving a stale row that would
      // 404 on the next action taken against it.
      setComposedItems((prev) => prev.filter((i) => i.name !== itemCode));
      showToast.success('Item convertido. Agora aparece na aba Ingredientes, com validade própria.');
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível converter o item.'));
    } finally {
      setSavingComposed(null);
    }
  }

  const composedColumns = useMemo<DataTableColumn<ComposedItem>[]>(
    () => [
      {
        key: 'item_name',
        header: 'Item',
        render: (i) => <span className="font-medium">{i.item_name}</span>,
      },
      {
        key: 'description',
        header: 'Descrição',
        render: (i) => <span className="text-muted-foreground">{i.description || '—'}</span>,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (i) => (
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={savingComposed === i.name}
              onClick={() => handleMarkPreparedAhead(i.name)}
              title="Pra itens preparados com antecedência (ex: molho, carne grelhada) - passa a ter validade própria e aparece em Registrar Produção"
            >
              Preparado com antecedência
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={savingComposed === i.name}
              onClick={() => handleDisableComposedItem(i.name)}
              title="Tira o item das listas sem apagar o histórico de vendas/produção"
            >
              Desativar
            </Button>
            <Button
              type="button"
              size="sm"
              variant={confirmingDeleteComposed === i.name ? 'danger' : 'ghost'}
              disabled={savingComposed === i.name}
              onClick={() => handleDeleteComposedItem(i.name)}
            >
              {confirmingDeleteComposed === i.name ? 'Confirmar exclusão?' : 'Excluir'}
            </Button>
          </div>
        ),
      },
    ],
    [savingComposed, confirmingDeleteComposed],
  );

  function resetForm() {
    setEditingBom(null);
    setOutputItemName('');
    setOutputItem('');
    setQuantity('1');
    setPreparationNotes('');
    setRows([emptyRow()]);
  }

  function handleStartEdit(bom: Bom) {
    setEditingBom(bom);
    setOutputItemName(bom.item_name);
    setOutputItem(bom.item);
    setQuantity(String(bom.quantity));
    setPreparationNotes(bom.preparation_notes ?? '');
    setRows(
      bom.ingredients.length > 0
        ? bom.ingredients.map((ing) => ({ item_code: ing.item_code, qty: String(ing.qty) }))
        : [emptyRow()],
    );
    setTab('nova');
  }

  async function handleDeleteBom(bomName: string) {
    if (confirmingDeleteBom !== bomName) {
      setConfirmingDeleteBom(bomName);
      return;
    }
    setConfirmingDeleteBom(null);
    setSavingBom(bomName);
    try {
      await stockOverviewService.deleteBom(bomName);
      setBoms((prev) => prev.filter((b) => b.name !== bomName));
      showToast.success('Receita excluída.');
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível excluir a receita.'));
    } finally {
      setSavingBom(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(quantity);
    if (!outputItem) {
      showToast.error('Selecione o item que a receita produz.');
      return;
    }
    if (editingBom && !outputItemName.trim()) {
      showToast.error('Informe o nome da receita.');
      return;
    }
    if (!qty || qty <= 0) {
      showToast.error('Informe um rendimento válido.');
      return;
    }
    const ingredientRows = rows
      .filter((r) => r.item_code && Number(r.qty) > 0)
      .map((r) => ({ item_code: r.item_code, qty: Number(r.qty) }));
    if (ingredientRows.length === 0) {
      showToast.error('Adicione pelo menos um ingrediente com quantidade válida.');
      return;
    }
    if (ingredientRows.some((i) => i.item_code === outputItem)) {
      showToast.error('Um item não pode ser ingrediente da própria receita.');
      return;
    }

    setSubmitting(true);
    try {
      if (editingBom) {
        const trimmedName = outputItemName.trim();
        if (trimmedName !== editingBom.item_name) {
          await stockOverviewService.renameItem(editingBom.item, trimmedName);
        }
        await stockOverviewService.updateBom({
          bom_name: editingBom.name,
          quantity: qty,
          ingredients: ingredientRows,
          preparation_notes: preparationNotes.trim() || undefined,
        });
        showToast.success('Receita atualizada.');
      } else {
        await stockOverviewService.createBom({
          item_code: outputItem,
          quantity: qty,
          ingredients: ingredientRows,
          preparation_notes: preparationNotes.trim() || undefined,
        });
        showToast.success('Receita cadastrada.');
      }
      resetForm();
      await reloadAll();
      setTab('receitas');
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível salvar a receita. Tente novamente.'));
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
                { id: 'ingredientes' as const, label: 'Ingredientes' },
                { id: 'compostos' as const, label: 'Itens compostos' },
                { id: 'nova' as const, label: editingBom ? 'Editar receita' : 'Nova receita' },
              ]
            ).map((item) => (
              <Button
                key={item.id}
                variant="tab"
                size="sm"
                data-selected={tab === item.id}
                onClick={() => {
                  if (item.id !== 'nova') resetForm();
                  setTab(item.id);
                }}
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
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle>{bom.item_name}</CardTitle>
                          <p className="text-sm text-muted-foreground">
                            Rende {bom.quantity} {translateUom(bom.uom)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button type="button" size="sm" variant="ghost" onClick={() => handleStartEdit(bom)}>
                            Editar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={confirmingDeleteBom === bom.name ? 'danger' : 'ghost'}
                            disabled={savingBom === bom.name}
                            onClick={() => handleDeleteBom(bom.name)}
                          >
                            {confirmingDeleteBom === bom.name ? 'Confirmar?' : 'Excluir'}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <ul className="space-y-1.5">
                        {bom.ingredients.map((ing) => (
                          <li
                            key={ing.item_code}
                            className="flex items-center justify-between text-sm border-b border-border last:border-b-0 py-1.5"
                          >
                            <span>{ing.item_name}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {ing.qty} {translateUom(ing.uom)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {bom.preparation_notes && (
                        <div className="rounded-md bg-muted/50 p-2.5 text-sm text-muted-foreground whitespace-pre-wrap">
                          {bom.preparation_notes}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )
          )}

          {tab === 'ingredientes' && (
            <div className="space-y-4">
              <CreateItemInline
                kind="ingredient"
                label="Criar ingrediente novo"
                onCreated={handleIngredientCreatedInTab}
              />
              {ingredients.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    Nenhum ingrediente cadastrado ainda.
                  </CardContent>
                </Card>
              ) : (
                <DataTable columns={ingredientColumns} rows={ingredients} />
              )}
            </div>
          )}

          {tab === 'compostos' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Itens que uma receita produz (ex: um hambúrguer montado). Removê-los do cardápio não os apaga daqui
                — use este botão pra excluir de vez um item que não está mais em uso.
              </p>
              {composedItems.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    Nenhum item composto cadastrado ainda.
                  </CardContent>
                </Card>
              ) : (
                <DataTable columns={composedColumns} rows={composedItems} />
              )}
            </div>
          )}

          {tab === 'nova' && (
              <Card className="max-w-2xl">
                <CardHeader>
                  <CardTitle>{editingBom ? `Editar receita: ${editingBom.item_name}` : 'Nova receita'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={handleSubmit}>
                    <div className="space-y-1.5">
                      <label htmlFor="bom-output" className="text-sm font-medium">
                        O que essa receita produz
                      </label>
                      {editingBom ? (
                        <Input
                          id="bom-output"
                          value={outputItemName}
                          onChange={(e) => setOutputItemName(e.target.value)}
                        />
                      ) : (
                        <>
                          <Select id="bom-output" value={outputItem} onChange={(e) => setOutputItem(e.target.value)}>
                            <option value="">Selecione um item</option>
                            {outputCandidates.map((item) => (
                              <option key={item.name} value={item.name}>
                                {item.item_name}
                              </option>
                            ))}
                          </Select>
                          <CreateItemInline kind="composed" label="Criar item novo" onCreated={handleOutputCreated} />
                        </>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="bom-quantity" className="text-sm font-medium">
                        Rendimento {outputItem ? `(${translateUom(outputCandidateByCode.get(outputItem)?.stock_uom)})` : ''}
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
                                Quantidade {row.item_code ? `(${translateUom(candidateByCode.get(row.item_code)?.stock_uom)})` : ''}
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

                    <div className="space-y-1.5">
                      <label htmlFor="bom-prep" className="text-sm font-medium">
                        Modo de preparo (opcional)
                      </label>
                      <Textarea
                        id="bom-prep"
                        value={preparationNotes}
                        onChange={(e) => setPreparationNotes(e.target.value)}
                        placeholder="Ex: Grelhe o hambúrguer por 3 min de cada lado, monte na ordem: pão, molho, carne, queijo, pão."
                        rows={4}
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button type="submit" disabled={submitting} className="flex-1">
                        {submitting ? 'Salvando...' : editingBom ? 'Salvar alterações' : 'Cadastrar receita'}
                      </Button>
                      {editingBom && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={submitting}
                          onClick={() => {
                            resetForm();
                            setTab('receitas');
                          }}
                        >
                          Cancelar
                        </Button>
                      )}
                    </div>
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
