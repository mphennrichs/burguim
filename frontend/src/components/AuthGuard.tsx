import { Spinner } from '@ury/ui';
import { useAuth } from '../store/useAuth';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, isLoading, error, isManager } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Spinner message="Carregando..." />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-red-600 text-xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Acesso Negado</h2>
          <p className="text-gray-600">
            {error || 'Faça login para acessar esta seção.'}
          </p>
        </div>
      </div>
    );
  }

  if (!isManager) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-amber-600 text-xl mb-4">🔒</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Permissão Necessária</h2>
          <p className="text-gray-600">Esta seção é restrita a Gerentes.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
