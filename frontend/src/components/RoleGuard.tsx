import React from 'react';
import { Card, Spinner } from '@ury/ui';
import { useAuth } from '../store/useAuth';

interface RoleGuardProps {
  children: React.ReactNode;
}

// Dono (URY Manager/Administrator/System Manager) and Caixa (URY Cashier)
// both use this SPA - access control beyond "can it open at all" is done
// by hiding menu items (Sidebar.tsx), not by blocking routes here (decided
// with the owner: hiding is enough, no separate per-route enforcement).
export const RoleGuard: React.FC<RoleGuardProps> = ({ children }) => {
  const { isManager, isCashier, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  if (!isManager && !isCashier) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <div className="p-6 text-center">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Acesso Negado</h2>
            <p className="text-gray-600">
              Você precisa ser Dono ou Caixa para acessar esta seção.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
};
