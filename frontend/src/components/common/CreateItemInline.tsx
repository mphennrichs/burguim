import { useEffect, useState } from 'react';
import { Button, Input, Select, Textarea, showToast } from '@ury/ui';
import { translateUom, parseFrappeError } from '@ury/core';
import { stockOverviewService } from '../../services/stockOverview';

type Kind = 'ingredient' | 'composed';

interface CreateItemInlineProps {
  kind: Kind;
  label: string;
  onCreated: (item: {
    name: string;
    stock_uom: string;
    shelf_life_in_days: number | null;
    description: string | null;
  }) => void;
}

export function CreateItemInline({ kind, label, onCreated }: CreateItemInlineProps) {
  const [open, setOpen] = useState(false);
  const [uoms, setUoms] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [uom, setUom] = useState('');
  const [group, setGroup] = useState('');
  const [shelfLife, setShelfLife] = useState('');
  const [saving, setSaving] = useState(false);

  // Both kinds pick their own unit now (grams was a fine default for a
  // kitchen mostly weighing raw ingredients, but breaks down for
  // anything bought by volume - oil, milk - or by the piece - eggs,
  // buns). Only a composed/output item also gets a group picker.
  useEffect(() => {
    if (!open || uoms.length > 0) return;
    const fetchGroups = kind === 'composed' ? stockOverviewService.itemGroups() : Promise.resolve([]);
    Promise.all([stockOverviewService.uoms(), fetchGroups]).then(([u, g]) => {
      setUoms(u);
      setGroups(g);
      const fallback = kind === 'ingredient' ? 'Gram' : 'Nos';
      setUom((prev) => prev || u.find((x) => x === fallback) || u[0] || '');
    });
  }, [kind, open, uoms.length]);

  async function handleCreate() {
    if (!name.trim()) {
      showToast.error('Informe o nome do item.');
      return;
    }
    if (kind === 'composed' && !uom) {
      showToast.error('Selecione uma unidade de medida.');
      return;
    }
    setSaving(true);
    try {
      const result = await stockOverviewService.createItem({
        item_name: name.trim(),
        kind,
        stock_uom: uom || undefined,
        item_group: kind === 'composed' ? group || undefined : undefined,
        shelf_life_in_days: kind === 'ingredient' && shelfLife ? Number(shelfLife) : undefined,
        description: description.trim() || undefined,
      });
      showToast.success(`"${result.item}" criado.`);
      onCreated({
        name: result.item,
        stock_uom: result.stock_uom,
        shelf_life_in_days: result.shelf_life_in_days,
        description: result.description,
      });
      setOpen(false);
      setName('');
      setDescription('');
      setShelfLife('');
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível criar o item.'));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-primary hover:underline"
      >
        + {label}
      </button>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Nome</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Alface" autoFocus />
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Descrição (opcional)</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Fornecedor, corte, observações..."
            rows={2}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Unidade</label>
          <Select value={uom} onChange={(e) => setUom(e.target.value)}>
            {uoms.map((u) => (
              <option key={u} value={u}>
                {translateUom(u)}
              </option>
            ))}
          </Select>
        </div>
        {kind === 'ingredient' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Validade padrão (dias)</label>
            <Input
              type="number"
              min="0"
              value={shelfLife}
              onChange={(e) => setShelfLife(e.target.value)}
              placeholder="Opcional"
            />
          </div>
        )}
        {kind === 'composed' && (
          <div className="col-span-2 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Grupo (opcional)</label>
            <Select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">Automático</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={handleCreate} disabled={saving}>
          {saving ? 'Criando...' : 'Criar item'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export default CreateItemInline;
