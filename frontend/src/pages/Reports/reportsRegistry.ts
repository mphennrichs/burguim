import type { LucideIcon } from 'lucide-react';
import {
  Sun,
  CalendarDays,
  Receipt,
  BarChart3,
  Clock,
  PieChart,
  Ban,
  Gauge,
  Package,
  ShoppingCart,
  Users,
  UserPlus,
  Repeat,
  UserCog,
  ClipboardList,
  Factory,
  Banknote,
} from 'lucide-react';

export interface ReportEntry {
  id: string;
  label: string;
  group: string;
  path: string;
  icon: LucideIcon;
}

// `label` matches each report page's own <h1> exactly - see the report's
// own .tsx file. `group` is this sidebar section's heading.
export const reportsRegistry: ReportEntry[] = [
  { id: 'today-sales', label: 'Vendas de Hoje', group: 'Resumo de Vendas', path: 'today-sales', icon: Sun },
  { id: 'daywise-sales', label: 'Vendas por Dia', group: 'Resumo de Vendas', path: 'daywise-sales', icon: CalendarDays },
  { id: 'daywise-invoices', label: 'Pedidos por Dia', group: 'Resumo de Vendas', path: 'daywise-invoices', icon: Receipt },
  { id: 'month-wise-sales', label: 'Vendas por Mês', group: 'Resumo de Vendas', path: 'month-wise-sales', icon: BarChart3 },
  { id: 'time-wise-sales', label: 'Vendas por Horário', group: 'Resumo de Vendas', path: 'time-wise-sales', icon: Clock },
  { id: 'service-wise-sales', label: 'Vendas por Tipo de Serviço', group: 'Resumo de Vendas', path: 'service-wise-sales', icon: PieChart },
  { id: 'cancelled-invoices', label: 'Pedidos Cancelados', group: 'Resumo de Vendas', path: 'cancelled-invoices', icon: Ban },
  { id: 'average-bill-value', label: 'Ticket Médio', group: 'Resumo de Vendas', path: 'average-bill-value', icon: Gauge },

  { id: 'item-wise-sales', label: 'Vendas por Item', group: 'Clientes e Itens', path: 'item-wise-sales', icon: Package },
  { id: 'item-wise-purchase-history', label: 'Histórico de Compras por Item', group: 'Clientes e Itens', path: 'item-wise-purchase-history', icon: ShoppingCart },
  { id: 'customer-data', label: 'Dados do Cliente', group: 'Clientes e Itens', path: 'customer-data', icon: Users },
  { id: 'daywise-customer-details', label: 'Detalhes de Clientes por Dia', group: 'Clientes e Itens', path: 'daywise-customer-details', icon: UserPlus },
  { id: 'repeated-customers', label: 'Clientes Recorrentes', group: 'Clientes e Itens', path: 'repeated-customers', icon: Repeat },

  { id: 'employee-sales', label: 'Vendas por Funcionário', group: 'Funcionários e Operações', path: 'employee-sales', icon: UserCog },
  { id: 'employee-item-wise-sales', label: 'Vendas por Item e Funcionário', group: 'Funcionários e Operações', path: 'employee-item-wise-sales', icon: ClipboardList },
  { id: 'completed-work-orders', label: 'Ordens de Produção Concluídas', group: 'Funcionários e Operações', path: 'completed-work-orders', icon: Factory },

  { id: 'daily-pnl', label: 'DRE Diário', group: 'Financeiro', path: 'daily-pnl', icon: Banknote },
];

export function groupReports(reports: ReportEntry[]): Record<string, ReportEntry[]> {
  return reports.reduce<Record<string, ReportEntry[]>>((acc, report) => {
    if (!acc[report.group]) {
      acc[report.group] = [];
    }
    acc[report.group].push(report);
    return acc;
  }, {});
}
