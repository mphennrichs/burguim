import React, { useEffect, useState } from 'react';
import { Card, Button, Spinner, showToast } from '@ury/ui';
import { call } from '@ury/core';
import { Switch } from '../../components/ui/switch';

// Keys and labels mirror Sidebar.tsx's NAV_ITEMS/SETTINGS_ITEMS exactly -
// keep both lists in sync by hand. "dashboard" and this page itself are
// intentionally absent: always visible, so nobody can hide their way into
// losing access to this screen.
const MAIN_ITEMS = [
  { key: 'kitchen', label: 'Tela de Cozinha' },
  { key: 'menu', label: 'Cardápio' },
  { key: 'stock', label: 'Meu Estoque' },
  { key: 'bom', label: 'Receitas (BOM)' },
  { key: 'branch', label: 'Filial' },
];

const SETTINGS_ITEMS = [
  { key: 'branding', label: 'Identidade Visual' },
  { key: 'pos-profile', label: 'Perfil POS' },
  { key: 'user', label: 'Usuário' },
  { key: 'report-settings', label: 'Configurações de DRE Diária' },
  { key: 'production-unit', label: 'Unidade de Produção' },
];

function ItemRow({
  label,
  visible,
  onChange,
}: {
  label: string;
  visible: boolean;
  onChange: (visible: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border last:border-b-0">
      <span className="text-sm text-foreground">{label}</span>
      <Switch checked={visible} onCheckedChange={onChange} />
    </div>
  );
}

export default function SidebarSettingsPage() {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await call<any>('ury.ury.api.sidebar_settings.get_hidden_sidebar_items');
        const items: string[] = res?.message ?? res ?? [];
        setHidden(new Set(items));
      } catch (e) {
        console.error('Failed to load sidebar settings', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setVisible = (key: string, visible: boolean) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await call('ury.ury.api.sidebar_settings.update_hidden_sidebar_items', {
        hidden_items: Array.from(hidden),
      });
      showToast.success('Menu lateral atualizado.');
    } catch (e) {
      console.error('Failed to save sidebar settings', e);
      showToast.error('Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Menu Lateral</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Escolha quais seções aparecem no menu para todo mundo — útil pra esconder o que seu
          restaurante não usa.
        </p>
      </div>

      <Card className="p-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
          Menu principal
        </h2>
        {MAIN_ITEMS.map((item) => (
          <ItemRow
            key={item.key}
            label={item.label}
            visible={!hidden.has(item.key)}
            onChange={(visible) => setVisible(item.key, visible)}
          />
        ))}
      </Card>

      <Card className="p-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
          Configurações
        </h2>
        {SETTINGS_ITEMS.map((item) => (
          <ItemRow
            key={item.key}
            label={item.label}
            visible={!hidden.has(item.key)}
            onChange={(visible) => setVisible(item.key, visible)}
          />
        ))}
      </Card>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Salvando...' : 'Salvar'}
      </Button>
    </div>
  );
}
