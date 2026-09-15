import React, { useState, useEffect } from 'react';
import { useBranchContext } from '../../context/BranchContext';
import { Grid, Plus, Users, Square, List, Edit2, LayoutTemplate } from 'lucide-react';
import { Card, Button, Badge, Input, Spinner, showToast } from '@ury/ui';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { Switch } from '../../components/ui/switch';
import { dashboardService } from '../../services/dashboard';
import { call } from '@ury/core';
import SideDrawer from '../../components/layout/SideDrawer';
import TableLayoutView from './TableLayoutView';

interface UryTableRecord {
  name: string;
  table_name?: string;
  no_of_seats?: number;
  minimum_seating?: number;
  restaurant?: string;
  restaurant_room?: string;
  branch?: string;
  table_shape?: string;
  is_take_away?: boolean;
  status?: string;
}

export const TablePage: React.FC = () => {
  const { activeBranchId, activeBranch } = useBranchContext();
  const [tables, setTables] = useState<UryTableRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'layout'>('list');
  const [editingTable, setEditingTable] = useState<UryTableRecord | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  // Branch options from Branch doctype
  const [branches, setBranches] = useState<{ name: string }[]>([]);
  // Room options from URY Room doctype
  const [rooms, setRooms] = useState<{ name: string; room_name?: string }[]>([]);

  const [newTable, setNewTable] = useState({
    table_name: '',
    no_of_seats: '4',
    minimum_seating: '1',
    branch: '',
    restaurant_room: '',
    table_shape: 'Square',
    is_take_away: false,
  });

  const fetchBranches = async () => {
    try {
      const res = await dashboardService.getModuleRecords<{ name: string }>('Branch', 'all');
      setBranches(res || []);
    } catch {
      setBranches([]);
    }
  };

  const fetchRooms = async () => {
    try {
      const res = await dashboardService.getModuleRecords<{ name: string; room_name?: string }>('URY Room', activeBranchId);
      setRooms(res || []);
    } catch {
      setRooms([]);
    }
  };

  const fetchTables = async () => {
    setLoading(true);
    try {
      const records = await dashboardService.getModuleRecords<UryTableRecord>('URY Table', activeBranchId);
      setTables(records);
    } catch {
      setTables([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
    fetchRooms();
    fetchTables();
  }, [activeBranchId]);

  const openAddDrawer = () => {
    setEditingTable(null);
    setNewTable({
      table_name: '',
      no_of_seats: '4',
      minimum_seating: '1',
      branch: activeBranchId !== 'all' ? activeBranchId : '',
      restaurant_room: '',
      table_shape: 'Square',
      is_take_away: false,
    });
    setIsDrawerOpen(true);
  };

  const openEditDrawer = (table: UryTableRecord) => {
    setEditingTable(table);
    setNewTable({
      table_name: table.table_name || table.name || '',
      no_of_seats: table.no_of_seats?.toString() || '4',
      minimum_seating: table.minimum_seating?.toString() || '1',
      branch: table.branch || '',
      restaurant_room: table.restaurant_room || '',
      table_shape: table.table_shape || 'Square',
      is_take_away: !!table.is_take_away,
    });
    setIsDrawerOpen(true);
  };

  const handleSaveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTable.table_name) return;

    if (!newTable.restaurant_room || !newTable.restaurant_room.trim()) {
      showToast.warning('Selecione uma sala para a mesa');
      return;
    }

    setSaving(true);
    try {
      if (editingTable) {
        const original = {
          table_name: editingTable.table_name || editingTable.name || '',
          no_of_seats: parseInt(editingTable.no_of_seats as any) || 0,
          minimum_seating: parseInt(editingTable.minimum_seating as any) || 0,
          branch: editingTable.branch || '',
          restaurant_room: editingTable.restaurant_room || '',
          table_shape: editingTable.table_shape || 'Square',
          is_take_away: editingTable.is_take_away ? 1 : 0,
        };
        const current = {
          table_name: newTable.table_name || '',
          no_of_seats: parseInt(newTable.no_of_seats as any) || 0,
          minimum_seating: parseInt(newTable.minimum_seating as any) || 0,
          branch: newTable.branch || '',
          restaurant_room: newTable.restaurant_room || '',
          table_shape: newTable.table_shape || 'Square',
          is_take_away: newTable.is_take_away ? 1 : 0,
        };
        if (JSON.stringify(original) === JSON.stringify(current)) {
          showToast.warning('Nenhuma alteração no documento');
          setSaving(false);
          return;
        }

        let currentName = editingTable.name;
        const branchName = newTable.branch || activeBranchId;
        const uniqueTableName = `${newTable.table_name} - ${branchName}`;
        if (uniqueTableName !== editingTable.name) {
          await call('frappe.client.rename_doc', {
            doctype: 'URY Table',
            old_name: editingTable.name,
            new_name: uniqueTableName,
          });
          currentName = uniqueTableName;
        }

        await call('frappe.client.set_value', {
          doctype: 'URY Table',
          name: currentName,
          fieldname: {
            table_name: newTable.table_name,
            no_of_seats: parseInt(newTable.no_of_seats),
            minimum_seating: parseInt(newTable.minimum_seating),
            branch: newTable.branch,
            restaurant_room: newTable.restaurant_room,
            table_shape: newTable.table_shape,
            is_take_away: newTable.is_take_away ? 1 : 0,
          },
        });
      } else {
        let restaurantName = '';
        if (newTable.branch) {
          try {
            const resList = await call<any>('frappe.client.get_list', {
              doctype: 'URY Restaurant',
              filters: [['branch', '=', newTable.branch]],
              fields: ['name'],
              limit: 1
            });
            const records = resList.message || resList || [];
            if (records.length > 0) {
              restaurantName = records[0].name;
            }
          } catch (err) {
            console.error('Failed to fetch restaurant for branch', err);
          }
        }
        if (!restaurantName) {
          showToast.error('Nenhum URY Restaurant configurado para esta filial — configure um primeiro');
          return;
        }

        const branchName = newTable.branch || activeBranchId;
        const uniqueTableName = `${newTable.table_name} - ${branchName}`;

        await call('frappe.client.insert', {
          doc: {
            doctype: 'URY Table',
            name: uniqueTableName,
            table_name: newTable.table_name,
            restaurant: restaurantName,
            no_of_seats: parseInt(newTable.no_of_seats),
            minimum_seating: parseInt(newTable.minimum_seating),
            branch: newTable.branch || undefined,
            restaurant_room: newTable.restaurant_room,
            table_shape: newTable.table_shape,
            is_take_away: newTable.is_take_away ? 1 : 0,
          },
        });
      }
      showToast.success('Mesa salva');
      fetchTables();
      setIsDrawerOpen(false);
    } catch (err) {
      console.error('Failed to save URY Table', err);
      showToast.error(`Falha ao salvar mesa: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toolbar — Partition Style */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 pb-3 border-b border-gray-200 -mx-6 px-6 -mt-6 pt-6">
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
          >
            <Grid className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <Button
            variant="outline"
            onClick={() => setViewMode('layout')}
            className={`border-gray-300 text-gray-700 font-semibold flex items-center gap-1.5 ${viewMode === 'layout' ? 'bg-primary/10 border-primary/30 text-primary' : ''}`}
          >
            <LayoutTemplate className="w-4 h-4" />
            <span>Editar Layout</span>
          </Button>
          <Button
            onClick={openAddDrawer}
            className="bg-primary hover:bg-primary/90 text-white font-semibold flex items-center gap-1.5 shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Adicionar Mesa</span>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 flex items-center justify-center bg-white rounded-lg border border-gray-200">
          <Spinner className="w-8 h-8 text-primary" />
        </div>
      ) : tables.length === 0 ? (
        <Card className="p-12 flex flex-col items-center justify-center text-center rounded-lg border border-gray-200 shadow-sm bg-white">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Grid className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Nenhuma Mesa Configurada</h3>
          <p className="text-gray-500 mb-6 max-w-sm">
            Adicione mesas para configurar o layout do seu restaurante.
          </p>
          <Button
            onClick={openAddDrawer}
            className="bg-primary hover:bg-primary/90 text-white font-semibold flex items-center space-x-1.5 shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Adicionar Mesa</span>
          </Button>
        </Card>
      ) : viewMode === 'layout' ? (
        <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden h-[600px] relative">
          <TableLayoutView
            selectedRoom="All"
            tables={tables as any}
            onBackToGrid={() => setViewMode('list')}
            onRefresh={fetchTables}
          />
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {tables.map((t) => (
            <Card key={t.name} className="p-5 rounded-lg border border-gray-200 bg-white shadow-xs hover:shadow-md transition-all hover:border-primary/20 flex flex-col justify-between relative group cursor-pointer" onClick={() => openEditDrawer(t)}>
              <div>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary text-[10px]">
                    <Square className="w-3 h-3 mr-1" />
                    {t.table_shape || 'Square'}
                  </Badge>
                  <Badge variant={t.status === 'Occupied' ? 'warning' : 'success'} size="sm">
                    {t.status || 'Available'}
                  </Badge>
                </div>
                <h3 className="mt-3 text-xl font-bold text-gray-900 tracking-tight">{t.table_name || t.name}</h3>
                <p className="text-xs text-gray-500 mt-1 font-medium">{t.restaurant_room || 'Salão Principal'}</p>
              </div>
              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600 font-semibold">
                <span className="flex items-center">
                  <Users className="w-3.5 h-3.5 mr-1 text-primary" />
                  {t.no_of_seats || 4} Lugares
                </span>
                <span className="text-gray-400">Filial: {t.branch || 'Principal'}</span>
              </div>
              <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                <Edit2 className="w-6 h-6 text-primary" />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-500 font-semibold">
              <tr>
                <th className="px-6 py-4">Nome da Mesa</th>
                <th className="px-6 py-4">Sala</th>
                <th className="px-6 py-4">Lugares</th>
                <th className="px-6 py-4">Formato</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tables.map((t) => (
                <tr key={t.name} className="hover:bg-primary/10 transition-colors">
                  <td className="px-6 py-4 font-semibold text-gray-900">{t.table_name || t.name}</td>
                  <td className="px-6 py-4">{t.restaurant_room || 'Salão Principal'}</td>
                  <td className="px-6 py-4 font-mono">{t.no_of_seats || 4}</td>
                  <td className="px-6 py-4">
                    <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary text-[10px]">
                      {t.table_shape || 'Square'}
                    </Badge>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={t.status === 'Occupied' ? 'warning' : 'success'} size="sm">
                      {t.status || 'Available'}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEditDrawer(t)} className="text-gray-500 hover:text-primary">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit SideDrawer */}
      <SideDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={editingTable ? 'Editar Mesa' : 'Adicionar Mesa'}
      >
        <form onSubmit={handleSaveTable} className="space-y-5">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Nome da Mesa</label>
              <Input
                value={newTable.table_name}
                onChange={(e) => setNewTable({ ...newTable, table_name: e.target.value })}
                required
                className="w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Capacidade de Lugares</label>
                <Input
                  type="number"
                  value={newTable.no_of_seats}
                  onChange={(e) => setNewTable({ ...newTable, no_of_seats: e.target.value })}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Lugares Mín.</label>
                <Input
                  type="number"
                  value={newTable.minimum_seating}
                  onChange={(e) => setNewTable({ ...newTable, minimum_seating: e.target.value })}
                  className="w-full"
                />
              </div>
            </div>

            {/* Branch — Select from Branch doctype */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Filial</label>
              <SearchableSelect
                id="branch"
                value={newTable.branch}
                onChange={(_, value) => setNewTable({ ...newTable, branch: value })}
                options={[
                  { value: '', label: 'Selecione a Filial' },
                  ...branches.map(b => ({ value: b.name, label: b.name }))
                ]}
              />
            </div>

            {/* Room — Select from URY Room docs */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Sala</label>
              <SearchableSelect
                id="restaurant_room"
                value={newTable.restaurant_room}
                onChange={(_, value) => setNewTable({ ...newTable, restaurant_room: value })}
                options={[
                  { value: '', label: 'Selecione a Sala' },
                  ...rooms.map(r => ({ value: r.name, label: r.room_name || r.name }))
                ]}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Formato da Mesa</label>
              <SearchableSelect
                id="table_shape"
                value={newTable.table_shape}
                onChange={(_, value) => setNewTable({ ...newTable, table_shape: value })}
                options={[
                  { value: 'Square', label: 'Quadrado' },
                  { value: 'Rectangle', label: 'Retângulo' },
                  { value: 'Circle', label: 'Círculo' },
                ]}
              />
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Switch
                id="is_take_away"
                checked={newTable.is_take_away}
                onCheckedChange={(checked) => setNewTable({ ...newTable, is_take_away: checked })}
              />
              <label htmlFor="is_take_away" className="text-sm font-medium text-gray-700 cursor-pointer">
                É Mesa de Retirada
              </label>
            </div>
          </div>

          <div className="pt-6 flex justify-end gap-3 border-t border-gray-100">
            <Button type="button" variant="outline" onClick={() => setIsDrawerOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" className="bg-primary hover:bg-primary/90 text-white shadow-sm" disabled={saving}>
              {editingTable ? 'Salvar Alterações' : 'Salvar Mesa'}
            </Button>
          </div>
        </form>
      </SideDrawer>
    </div>
  );
};

export default TablePage;
