import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, Spinner, showToast } from '@ury/ui';
import { formatCurrency } from '@ury/core';
import { caixaService, type OrderDetail, type CaixaOrderType } from '../../services/caixa';

const ORDER_TYPE_LABEL: Record<CaixaOrderType, string> = {
  'Take Away': 'Retirada',
  Delivery: 'Entrega',
};

function formatDateTime(ts: string): string {
  const then = new Date(ts.replace(' ', 'T'));
  if (Number.isNaN(then.getTime())) return ts;
  return then.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface OrderDetailDialogProps {
  /** The invoice to show, or null to keep the dialog closed. Shared by
   * every screen that lists Pedidos (Caixa's Histórico de Vendas,
   * Clientes' per-customer history) so there's exactly one detail
   * modal/fetch implementation instead of one per caller. */
  invoice: string | null;
  onClose: () => void;
}

export const OrderDetailDialog: React.FC<OrderDetailDialogProps> = ({ invoice, onClose }) => {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!invoice) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setDetail(null);
    caixaService
      .orderDetail(invoice)
      .then(setDetail)
      .catch(() => showToast.error('Não foi possível carregar o detalhe do pedido.'))
      .finally(() => setLoading(false));
  }, [invoice]);

  return (
    <Dialog open={!!invoice} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Pedido {invoice}</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-6 space-y-4 text-sm overflow-y-auto max-h-[70vh]">
          {loading || !detail ? (
            <Spinner message="Carregando pedido..." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{detail.customer_name}</span>
                {detail.contact_mobile && <span className="text-muted-foreground">{detail.contact_mobile}</span>}
                <span className="text-muted-foreground">
                  · {ORDER_TYPE_LABEL[detail.order_type as CaixaOrderType] || detail.order_type}
                </span>
              </div>
              {detail.shipping_address && <p className="text-muted-foreground">{detail.shipping_address}</p>}

              <div>
                <h3 className="font-semibold text-gray-700 mb-1.5">Itens</h3>
                <div className="space-y-1">
                  {detail.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span>
                        {item.item_name} × {item.qty}
                      </span>
                      <span className="tabular-nums">{formatCurrency(item.amount)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between border-t pt-2 mt-2 font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrency(detail.grand_total)}</span>
                </div>
              </div>

              {detail.notes && (
                <div>
                  <h3 className="font-semibold text-gray-700 mb-1.5">Observações</h3>
                  <p className="rounded-md bg-muted p-2 italic text-muted-foreground">{detail.notes}</p>
                </div>
              )}

              <div>
                <h3 className="font-semibold text-gray-700 mb-1.5">Linha do tempo</h3>
                <div className="space-y-1">
                  {detail.status_history.map((entry, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span>{entry.status}</span>
                      <span className="text-muted-foreground tabular-nums">{formatDateTime(entry.changed_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OrderDetailDialog;
