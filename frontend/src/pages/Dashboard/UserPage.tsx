import React, { useState, useEffect } from 'react';
import { useBranchContext } from '../../context/BranchContext';
import { Users, Plus, ShieldCheck, Edit2, Trash2, KeyRound } from 'lucide-react';
import { Card, Button, Badge, Input, Spinner, showToast } from '@ury/ui';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { Switch } from '../../components/ui/switch';
import { dashboardService } from '../../services/dashboard';
import { call, parseFrappeError } from '@ury/core';
import { useAuth } from '../../store/useAuth';
import SideDrawer from '../../components/layout/SideDrawer';

interface UserRecord {
  name: string;
  email: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  user_type?: string;
  enabled?: number;
  roles?: Array<{ role: string }>;
}

export const UserPage: React.FC = () => {
  const { activeBranchId } = useBranchContext();
  const { user: loggedInUser } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [passwordUser, setPasswordUser] = useState<UserRecord | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const [newUser, setNewUser] = useState({
    first_name: '',
    last_name: '',
    email: '',
    username: '',
    password: '',
    role: 'URY Cashier',
    enabled: true,
  });
  const [originalUser, setOriginalUser] = useState<any>(null);

  // Only the 2 papéis CONTEXT.md actually defines (Dono/Caixa) - not the raw
  // list of every Role in the system (was pulling in every core Frappe/
  // ERPNext role plus a stray "Administrator" Role record that looks like
  // it should grant full access but isn't the tested path useAuth.isManager
  // relies on - confirmed live: a user given that role could log in but got
  // "Acesso Negado" on every /ury screen. "URY Manager" is the real one.
  const STAFF_ROLE_OPTIONS: { value: string; label: string }[] = [
    { value: 'URY Manager', label: 'Dono' },
    { value: 'URY Cashier', label: 'Caixa' },
  ];
  const ROLE_LABEL: Record<string, string> = Object.fromEntries(
    STAFF_ROLE_OPTIONS.map((r) => [r.value, r.label]),
  );

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const records = await dashboardService.getModuleRecords<UserRecord>('User', activeBranchId);
      setUsers(records);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [activeBranchId]);

  const getDisplayRole = (user: UserRecord): string => {
    if (user.roles && Array.isArray(user.roles) && user.roles.length > 0) {
      const role = user.roles[0].role;
      return ROLE_LABEL[role] || role;
    }
    return 'Usuário';
  };

  const openAddDrawer = () => {
    setEditingUser(null);
    setNewUser({ first_name: '', last_name: '', email: '', username: '', password: '', role: 'URY Cashier', enabled: true });
    setIsDrawerOpen(true);
  };

  const openEditDrawer = async (user: UserRecord) => {
    setEditingUser(user);
    let userRole = 'URY Cashier';
    let username = '';

    try {
      const fullUserRes = await call('frappe.client.get', {
        doctype: 'User',
        name: user.name,
      });
      const fullUser = (fullUserRes as any).message || fullUserRes;

      if (fullUser.roles && Array.isArray(fullUser.roles) && fullUser.roles.length > 0) {
        userRole = fullUser.roles[0].role;
      }
      username = fullUser.username || '';
    } catch (err) {
      console.error('Failed to fetch user roles', err);
    }

    if (userRole === 'URY Cashier' && user.roles && Array.isArray(user.roles) && user.roles.length > 0) {
      userRole = user.roles[0].role;
    }

    const initialForm = {
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      email: user.email || '',
      username,
      password: '',
      role: userRole,
      enabled: user.enabled === 1,
    };
    setNewUser(initialForm);
    setOriginalUser(initialForm);
    setIsDrawerOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.email) return;

    if (editingUser && originalUser) {
      const original = {
        first_name: (originalUser.first_name || '').trim(),
        last_name: (originalUser.last_name || '').trim(),
        username: (originalUser.username || '').trim(),
        role: originalUser.role,
        enabled: originalUser.enabled ? 1 : 0,
      };
      const current = {
        first_name: (newUser.first_name || '').trim(),
        last_name: (newUser.last_name || '').trim(),
        username: (newUser.username || '').trim(),
        role: newUser.role,
        enabled: newUser.enabled ? 1 : 0,
      };
      if (JSON.stringify(original) === JSON.stringify(current)) {
        showToast.warning('Nenhuma alteração no documento');
        return;
      }
    }

    setSaving(true);
    try {
      if (editingUser) {
        await call('frappe.client.set_value', {
          doctype: 'User',
          name: editingUser.name,
          fieldname: {
            first_name: newUser.first_name,
            last_name: newUser.last_name,
            username: newUser.username || null,
            enabled: newUser.enabled ? 1 : 0,
          },
        });

        if (newUser.role) {
          const fullUserRes = await call('frappe.client.get', {
            doctype: 'User',
            name: editingUser.name,
          });
          const fullUser = (fullUserRes as any).message || fullUserRes;

          let updatedRoles = fullUser.roles && Array.isArray(fullUser.roles) ? [...fullUser.roles] : [];
          updatedRoles = [{ role: newUser.role }];

          await call('frappe.client.set_value', {
            doctype: 'User',
            name: editingUser.name,
            fieldname: 'roles',
            value: updatedRoles,
          });
        }
      } else {
        // O e-mail É o nome do documento User no Frappe - se já existir um
        // (mesmo desativado, mesmo que a exclusão dele tenha sido bloqueada
        // por ter histórico), o insert abaixo falha com um erro genérico de
        // "já existe". Checa antes pra dar uma mensagem clara sobre o motivo
        // real, em vez de deixar o Dono achar que a exclusão anterior "não
        // propagou" (delete no Frappe é síncrono - ou funciona por completo
        // na hora, ou é bloqueado por completo, nunca fica pela metade).
        const existing = await call<any>('frappe.client.get_list', {
          doctype: 'User',
          filters: { name: newUser.email },
          fields: ['name', 'enabled'],
          limit: 1,
        });
        const existingRecords = (existing as any)?.message || existing;
        if (Array.isArray(existingRecords) && existingRecords.length > 0) {
          const already = existingRecords[0];
          showToast.error(
            already.enabled
              ? 'Já existe um usuário ativo com esse e-mail. Edite-o na lista em vez de criar um novo.'
              : 'Já existe um usuário desativado com esse e-mail (provavelmente não pôde ser excluído por ter histórico). Edite-o na lista pra reaproveitá-lo, ou use outro e-mail.',
          );
          setSaving(false);
          return;
        }

        await call('frappe.client.insert', {
          doc: {
            doctype: 'User',
            email: newUser.email,
            first_name: newUser.first_name,
            last_name: newUser.last_name,
            username: newUser.username || undefined,
            // Só manda o e-mail de "defina sua senha" quando o Dono NÃO
            // definiu uma senha na hora (abaixo) - já fica pronta pra uso.
            send_welcome_email: newUser.password ? 0 : 1,
            enabled: newUser.enabled ? 1 : 0,
            roles: [{ role: newUser.role }],
          },
        });

        // new_password é permlevel 1 em User (somente leitura pra URY
        // Manager pelas permissões padrão) - frappe.client.insert não
        // consegue setá-lo mesmo vindo no doc. set_user_password() existe
        // exatamente pra isso: roda ignore_permissions=True no servidor.
        if (newUser.password) {
          await call('ury.ury.api.users.set_user_password', {
            user: newUser.email,
            new_password: newUser.password,
          });
        }
      }
      fetchUsers();
      setIsDrawerOpen(false);
      showToast.success(`Usuário ${editingUser ? 'atualizado' : 'adicionado'} com sucesso`);
    } catch (err: any) {
      console.error('Failed to save User', err);
      let errorMessage = 'Falha ao salvar Usuário';
      if (err._server_messages) {
        try {
          const messages = JSON.parse(err._server_messages);
          if (messages.length > 0) {
            const lastMessage = JSON.parse(messages[messages.length - 1]);
            if (lastMessage.message) {
              errorMessage = lastMessage.message.replace(/<[^>]*>?/gm, '');
            }
          }
        } catch (e) {}
      } else if (err.message) {
        errorMessage = err.message;
      } else if (err.exc) {
        errorMessage = 'Ocorreu um erro de entrada duplicada ou erro no servidor.';
      }
      showToast.error(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (user: UserRecord) => {
    if (confirmingDelete !== user.name) {
      setConfirmingDelete(user.name);
      return;
    }
    setDeleting(user.name);
    try {
      await call('ury.ury.api.users.delete_user', { user: user.name });
      showToast.success('Usuário excluído com sucesso');
      setConfirmingDelete(null);
      fetchUsers();
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível excluir o usuário.'));
    } finally {
      setDeleting(null);
    }
  };

  const openPasswordDrawer = (user: UserRecord) => {
    setPasswordUser(user);
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordUser) return;
    if (newPassword !== confirmPassword) {
      showToast.error('As senhas não coincidem.');
      return;
    }
    setChangingPassword(true);
    try {
      await call('ury.ury.api.users.set_user_password', {
        user: passwordUser.name,
        new_password: newPassword,
      });
      showToast.success('Senha alterada com sucesso');
      setPasswordUser(null);
    } catch (err) {
      showToast.error(parseFrappeError(err, 'Não foi possível alterar a senha.'));
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toolbar — no title, partition style */}
      <div className="flex flex-col md:flex-row items-center justify-end gap-4 pb-3 border-b border-gray-200 -mx-6 px-6 -mt-6 pt-6">
        <Button
          onClick={openAddDrawer}
          className="bg-primary hover:bg-primary/90 text-white font-semibold flex items-center space-x-1.5 shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>Adicionar Usuário</span>
        </Button>
      </div>

      {loading ? (
        <div className="py-16 flex items-center justify-center bg-white rounded-lg border border-gray-200">
          <Spinner className="w-8 h-8 text-primary" />
        </div>
      ) : users.length === 0 ? (
        <Card className="p-12 flex flex-col items-center justify-center text-center rounded-lg border border-gray-200 shadow-sm bg-white">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Users className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Nenhum Usuário Configurado</h3>
          <p className="text-gray-500 mb-6 max-w-sm">
            Adicione usuários da equipe e atribua funções para esta filial.
          </p>
          <Button
            onClick={openAddDrawer}
            className="bg-primary hover:bg-primary/90 text-white font-semibold flex items-center space-x-1.5 shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Adicionar Usuário</span>
          </Button>
        </Card>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-500 font-semibold">
              <tr>
                <th className="px-6 py-4">Usuário</th>
                <th className="px-6 py-4">ID do Usuário</th>
                <th className="px-6 py-4">Função</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => {
                const isSelfOrAdmin = user.name === loggedInUser || user.name === 'Administrator';
                return (
                <tr key={user.name} className="hover:bg-primary/10 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs uppercase shrink-0">
                        {(user.first_name || user.email || user.name || '?').charAt(0)}
                      </div>
                      <div className="font-semibold text-gray-900">
                        {user.first_name || user.full_name || user.name}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600 font-medium">
                    {user.email}
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary text-[10px]">
                      <ShieldCheck className="w-3 h-3 mr-1" />
                      {getDisplayRole(user)}
                    </Badge>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={user.enabled === 0 ? 'secondary' : 'success'} size="sm">
                      {user.enabled === 0 ? 'Inativo' : 'Ativo'}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditDrawer(user)} className="text-gray-500 hover:text-primary">
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openPasswordDrawer(user)} className="text-gray-500 hover:text-primary">
                        <KeyRound className="w-4 h-4" />
                      </Button>
                      {!isSelfOrAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deleting === user.name}
                          onClick={() => handleDeleteUser(user)}
                          className={confirmingDelete === user.name ? 'text-destructive' : 'text-gray-500 hover:text-destructive'}
                        >
                          <Trash2 className="w-4 h-4" />
                          {confirmingDelete === user.name && <span className="ml-1 text-xs">Confirmar?</span>}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit SideDrawer */}
      <SideDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={editingUser ? 'Editar Usuário' : 'Adicionar Usuário'}
      >
        <form onSubmit={handleSaveUser} className="space-y-5 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-gray-700 mb-1.5">Nome</label>
              <Input
                value={newUser.first_name}
                onChange={(e) => setNewUser({ ...newUser, first_name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block font-semibold text-gray-700 mb-1.5">Sobrenome</label>
              <Input
                value={newUser.last_name}
                onChange={(e) => setNewUser({ ...newUser, last_name: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-gray-700 mb-1.5">E-mail (login)</label>
            <Input
              type="email"
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              placeholder="nome@exemplo.com"
              required
              disabled={!!editingUser}
            />
            <p className="text-xs text-gray-500 mt-1">
              É com esse e-mail que o usuário faz login - precisa ser um e-mail de verdade.
            </p>
          </div>

          <div>
            <label className="block font-semibold text-gray-700 mb-1.5">Nome de usuário (opcional)</label>
            <Input
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
              placeholder="ex: fogo"
            />
            <p className="text-xs text-gray-500 mt-1">
              Se preenchido, também dá pra fazer login com esse nome, além do e-mail.
            </p>
          </div>

          {!editingUser && (
            <div>
              <label className="block font-semibold text-gray-700 mb-1.5">Senha (opcional)</label>
              <Input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="Deixe em branco para enviar convite por e-mail"
              />
              <p className="text-xs text-gray-500 mt-1">
                Se definir uma senha aqui, o usuário já pode logar direto - sem senha, ele recebe um
                e-mail pra criar a própria.
              </p>
            </div>
          )}

          <div>
            <label className="block font-semibold text-gray-700 mb-1.5">Função</label>
            <SearchableSelect
              id="role"
              value={newUser.role}
              onChange={(_, value) => setNewUser({ ...newUser, role: value })}
              options={STAFF_ROLE_OPTIONS}
            />
          </div>

          <div className="flex items-center gap-2 p-3 rounded-lg border border-gray-100 bg-gray-50/50">
            <Switch
              id="user-enabled"
              checked={newUser.enabled}
              onCheckedChange={(checked) => setNewUser({ ...newUser, enabled: checked })}
            />
            <label htmlFor="user-enabled" className="font-medium text-gray-700 cursor-pointer text-sm">
              Usuário ativo (desmarque para revogar o acesso sem excluir)
            </label>
          </div>

          <div className="pt-6 flex justify-end gap-3 border-t mt-4 border-gray-100">
            <Button type="button" variant="outline" onClick={() => setIsDrawerOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" className="bg-primary hover:bg-primary/90 text-white px-6 flex items-center gap-2" disabled={saving}>
              {editingUser ? 'Salvar Alterações' : 'Criar Usuário'}
            </Button>
          </div>
        </form>
      </SideDrawer>

      <SideDrawer
        isOpen={!!passwordUser}
        onClose={() => setPasswordUser(null)}
        title={`Trocar Senha — ${passwordUser?.first_name || passwordUser?.email || ''}`}
      >
        <form onSubmit={handleChangePassword} className="space-y-5 text-sm">
          <div>
            <label className="block font-semibold text-gray-700 mb-1.5">Nova senha</label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block font-semibold text-gray-700 mb-1.5">Confirmar nova senha</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <div className="pt-6 flex justify-end gap-3 border-t mt-4 border-gray-100">
            <Button type="button" variant="outline" onClick={() => setPasswordUser(null)} disabled={changingPassword}>
              Cancelar
            </Button>
            <Button type="submit" className="bg-primary hover:bg-primary/90 text-white px-6 flex items-center gap-2" disabled={changingPassword}>
              {changingPassword ? 'Salvando...' : 'Trocar Senha'}
            </Button>
          </div>
        </form>
      </SideDrawer>
    </div>
  );
};

export default UserPage;
