import { useEffect, useState } from 'react';
import { Button, Input, Select, showToast } from '@ury/ui';
import { translateUom } from '@ury/core';
import { stockOverviewService } from '../../services/stockOverview';

type Kind = 'ingredient' | 'composed';

interface CreateItemInlineProps {
  kind: Kind;
  label: string;
  onCreated: (item: { name: string; stock_uom: string }) => void;
}

export function CreateItemInline({ kind, label, onCreated }: CreateItemInlineProps) {
  const [open, setOpen] = useState(false);
  const [uoms, setUoms] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [uom, setUom] = useState('');
  const [group, setGroup] = useState('');
  const [shelfLife, setShelfLife] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || uoms.length > 0) return;
    Promise.all([stockOverviewService.uoms(), stockOverviewService.itemGroups()]).then(([u, g]) => {
      setUoms(u);
      setGroups(g);
      setUom((prev) => prev || u.find((x) => x === 'Nos') || u[0] || '');
    });
  }, [open, uoms.length]);

  async function handleCreate() {
    if (!name.trim()) {
      showToast.error('Informe o nome do item.');
      return;
    }
    if (!uom) {
      showToast.error('Selecione uma unidade de medida.');
      return;
    }
    setSaving(true);
    try {
      const result = await stockOverviewService.createItem({
        item_name: name.trim(),
        kind,
        stock_uom: uom,
        item_group: group || undefined,
        shelf_life_in_days: kind === 'ingredient' && shelfLife ? Number(shelfLife) : undefined,
      });
      showToast.success(`"${result.item}" criado.`);
      onCreated({ name: result.item, stock_uom: result.stock_uom });
      setOpen(false);
      setName('');
      setShelfLife('');
    } catch {
      showToast.error('Não foi possível criar o item. Verifique se já existe um com esse nome.');
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
