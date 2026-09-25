import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import { call } from '@ury/core';
import { useAuth } from '../../store/useAuth';
import { reportsRegistry, groupReports } from '../../pages/Reports/reportsRegistry';
import { SidebarContainer, SidebarActiveIndicator, sidebarItemVariants, cn } from '@ury/ui';
import {
  LayoutDashboard,
  UtensilsCrossed,
  Building2,
  SlidersHorizontal,
  Users,
  ChevronDown,
  FileText,
  Settings,
  BarChart3,
  ArrowLeft,
  Grid,
  Flame,
  Package,
  Image,
  PanelLeft,
  ChefHat,
  Wallet
} from 'lucide-react';

interface NavItem {
  // Matches ury.ury.api.sidebar_settings.HIDEABLE_ITEMS - keep both in
  // sync by hand. "dashboard" has no key: it's never hideable.
  key?: string;
  label: string;
  path: string;
  icon: React.ElementType;
  // Tela de Cozinha (CONTEXT.md) is meant to be opened in its own tab,
  // never inside this SPA's own layout - a plain <a target="_blank">
  // instead of a router NavLink.
  openInNewTab?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Painel', path: '/dashboard', icon: LayoutDashboard },
  { key: 'caixa', label: 'Caixa', path: '/caixa', icon: Wallet },
  { key: 'kitchen', label: 'Tela de Cozinha', path: '/kitchen', icon: Flame, openInNewTab: true },
  { key: 'menu', label: 'Cardápio', path: '/menu', icon: UtensilsCrossed },
  { key: 'stock', label: 'Meu Estoque', path: '/stock', icon: Package },
  { key: 'bom', label: 'Receitas (BOM)', path: '/bom', icon: ChefHat },
  { key: 'branch', label: 'Filial', path: '/branch', icon: Building2 },
];

// Caixa's menu is reduced to Painel plus these keys (Configurações is
// Dono-only, hidden outright rather than filtered item-by-item).
const CASHIER_VISIBLE_KEYS = new Set<string>(['caixa', 'kitchen']);

const SETTINGS_ITEMS: NavItem[] = [
  { key: 'branding', label: 'Identidade Visual', path: '/branding', icon: Image },
  { key: 'pos-profile', label: 'Perfil POS', path: '/pos-profile', icon: SlidersHorizontal },
  { key: 'user', label: 'Usuário', path: '/user', icon: Users },
  { key: 'report-settings', label: 'Configurações de DRE Diária', path: '/report-settings', icon: FileText },
  { key: 'production-unit', label: 'Unidade de Produção', path: '/production-unit', icon: Grid },
  // Never hideable - it's the only way to undo hiding anything else here.
  { label: 'Menu Lateral', path: '/sidebar-settings', icon: PanelLeft },
];

const reportGroups = groupReports(reportsRegistry);
const reportGroupEntries = Object.entries(reportGroups);

const ReportsPanel: React.FC = () => (
  <nav className="flex-1 px-3 py-4 overflow-y-auto">
    <Link
      to="/dashboard"
      className={cn(sidebarItemVariants({ active: false }), 'mb-4')}
    >
      <div className="flex items-center gap-3 ms-1">
        <ArrowLeft className="w-4 h-4 text-gray-500 shrink-0" />
        <span>Voltar</span>
      </div>
    </Link>

    <div className="space-y-4">
      {reportGroupEntries.map(([group, reports], index) => (
        <div key={group} className={index > 0 ? 'pt-3 border-t border-gray-200' : undefined}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2 px-2">
            {group}
          </h3>
          <div className="space-y-1">
            {reports.map((report) => {
              const Icon = report.icon;
              return (
                <NavLink
                  key={report.id}
                  to={`/reports/${report.path}`}
                  className={({ isActive }) => sidebarItemVariants({ active: isActive })}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <SidebarActiveIndicator />}
                      <div className="flex items-center gap-3 ms-1">
                        <Icon className="w-4 h-4 text-gray-500 shrink-0" />
                        <span>{report.label}</span>
                      </div>
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  </nav>
);

const MainPanel: React.FC<{ isManager: boolean; isCashier: boolean }> = ({ isManager, isCashier }) => {
  const location = useLocation();
  const isSettingsPath = SETTINGS_ITEMS.some((item) => location.pathname.startsWith(item.path));
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(isSettingsPath);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  // Items render only once this resolves - hiddenKeys starts empty ("show
  // everything"), so rendering before the fetch settles means anything the
  // owner hid (e.g. Mesa/Sala for a delivery-only branch) flashes visible
  // on every cold load, the same race the dashboard's currency symbol had.
  const [hiddenKeysLoaded, setHiddenKeysLoaded] = useState(false);

  useEffect(() => {
    if (isSettingsPath) {
      setIsSettingsOpen(true);
    }
  }, [isSettingsPath]);

  useEffect(() => {
    call<any>('ury.ury.api.sidebar_settings.get_hidden_sidebar_items')
      .then((res) => setHiddenKeys(new Set((res?.message ?? res ?? []) as string[])))
      .catch((e) => console.error('Failed to load sidebar visibility settings', e))
      .finally(() => setHiddenKeysLoaded(true));
  }, []);

  let visibleNavItems = hiddenKeysLoaded ? NAV_ITEMS.filter((item) => !item.key || !hiddenKeys.has(item.key)) : [];
  let visibleSettingsItems = hiddenKeysLoaded ? SETTINGS_ITEMS.filter((item) => !item.key || !hiddenKeys.has(item.key)) : [];

  // Caixa never sees Configurações, and only sees the nav items called out
  // above (Painel always shows - it has no `key`, so it's exempt here too).
  if (!isManager && isCashier) {
    visibleNavItems = visibleNavItems.filter((item) => !item.key || CASHIER_VISIBLE_KEYS.has(item.key));
    visibleSettingsItems = [];
  }

  return (
    <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-1">
      {isManager && (
        <NavLink
          to="/reports"
          className={({ isActive }) => sidebarItemVariants({ active: isActive })}
        >
          {({ isActive }) => (
            <>
              {isActive && <SidebarActiveIndicator />}
              <div className="flex items-center gap-3 ms-1">
                <BarChart3 className="w-4 h-4 text-gray-500 shrink-0" />
                <span>Relatórios</span>
              </div>
            </>
          )}
        </NavLink>
      )}

      {visibleNavItems.map((item) => {
        const Icon = item.icon;

        if (item.openInNewTab) {
          return (
            <a
              key={item.path}
              // Plain <a href> bypasses React Router, which is what a new
              // tab needs - but that also means it never gets the
              // BrowserRouter basename="/ury" a NavLink adds for free.
              // Without prefixing it by hand, this opened the un-prefixed
              // root path (e.g. /kitchen), which the server 404s.
              href={`/ury${item.path}`}
              target="_blank"
              rel="noopener noreferrer"
              className={sidebarItemVariants({ active: false })}
            >
              <div className="flex items-center gap-3 ms-1">
                <Icon className="w-4 h-4 text-gray-500 shrink-0" />
                <span>{item.label}</span>
              </div>
            </a>
          );
        }

        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => sidebarItemVariants({ active: isActive })}
          >
            {({ isActive }) => (
              <>
                {isActive && <SidebarActiveIndicator />}
                <div className="flex items-center gap-3 ms-1">
                  <Icon className="w-4 h-4 text-gray-500 shrink-0" />
                  <span>{item.label}</span>
                </div>
              </>
            )}
          </NavLink>
        );
      })}

      {visibleSettingsItems.length > 0 && (
      <div>
        <button
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          className={sidebarItemVariants({ active: isSettingsPath })}
        >
          {isSettingsPath && <SidebarActiveIndicator />}
          <div className="flex items-center gap-3 ms-1">
            <Settings className="w-4 h-4 text-gray-500 shrink-0" />
            <span>Configurações</span>
          </div>
          <ChevronDown
            className={cn(
              "w-4 h-4 transition-transform duration-200",
              isSettingsOpen ? "rotate-180 text-blue-600" : "text-gray-400"
            )}
          />
        </button>

        {isSettingsOpen && (
          <div className="mt-1 pl-4 space-y-1">
            {visibleSettingsItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    cn(sidebarItemVariants({ active: isActive }), 'py-2 text-xs')
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <SidebarActiveIndicator />}
                      <div className="flex items-center gap-2.5 ms-1">
                        <Icon className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                        <span>{item.label}</span>
                      </div>
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        )}
      </div>
      )}
    </nav>
  );
};

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const { isManager, isCashier } = useAuth();
  const inReports = location.pathname.startsWith('/reports');

  return (
    <SidebarContainer>
      {inReports ? <ReportsPanel /> : <MainPanel isManager={isManager} isCashier={isCashier} />}
    </SidebarContainer>
  );
};

export default Sidebar;
