import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@ury/ui';
import { Package, ChefHat } from 'lucide-react';

interface QuickAction {
  to: string;
  label: string;
  description: string;
  icon: React.ElementType;
}

const ACTIONS: QuickAction[] = [
  {
    to: '/stock',
    label: 'Meu Estoque',
    description: 'Compra, produção e validade',
    icon: Package,
  },
  {
    to: '/bom',
    label: 'Receitas (BOM)',
    description: 'Cadastrar o que cada item leva',
    icon: ChefHat,
  },
];

export const QuickActions: React.FC = () => {
  return (
    <section className="w-full">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        Ações Rápidas
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ACTIONS.map((action) => (
          <Link key={action.to} to={action.to} className="block outline-none">
            <Card className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-xs transition-all duration-200 hover:shadow-md hover:border-primary/20">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <action.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{action.label}</p>
                <p className="text-xs text-gray-500">{action.description}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
};

export default QuickActions;
