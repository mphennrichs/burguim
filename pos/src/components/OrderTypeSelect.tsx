import { usePOSStore } from '../store/pos-store';
import { cn } from '@ury/ui';
import { Button } from '@ury/ui';
import { ORDER_TYPES, type OrderType } from '../data/order-types';
import { t } from '../i18n';

interface OrderTypeSelectProps {
  disabled?: boolean;
}

// Just Retirada (Take Away)/Entrega (Delivery) now - Dine In and its
// table-selection dialog were removed (docs/adr/0001, no salão/mesa in
// this business), and Phone In isn't a Modalidade of its own (CONTEXT.md).
const OrderTypeSelect = ({ disabled }: OrderTypeSelectProps) => {
  const { selectedOrderType, setSelectedOrderType, posProfile, isUpdatingOrder } = usePOSStore();

  const handleOrderTypeSelect = (type: OrderType) => {
    setSelectedOrderType(type);
  };

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-2 px-2">
        {ORDER_TYPES.map(({ value, icon: Icon }) => {
          let isUpdatingDisabled = isUpdatingOrder;
          if (isUpdatingOrder && posProfile?.edit_order_type) {
            const isCurrentTypeToggleable = selectedOrderType === 'Take Away' || selectedOrderType === 'Delivery';
            const isValueToggleable = value === 'Take Away' || value === 'Delivery';
            if (isCurrentTypeToggleable && isValueToggleable) {
              isUpdatingDisabled = false;
            }
          }

          const isDisabled = disabled || isUpdatingDisabled;

          return (
            <Button
              key={value}
              onClick={() => handleOrderTypeSelect(value)}
              variant={selectedOrderType === value ? 'default' : 'outline'}
              className={cn(
                'h-fit flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap bg-white border transition-colors',
                selectedOrderType === value
                ? 'text-primary-700 bg-primary-50 border-primary-600 hover:bg-primary-50'
                : 'text-gray-700 border-gray-200 hover:bg-gray-50',
                isDisabled && 'opacity-50 cursor-not-allowed'
              )}
              disabled={isDisabled}
            >
              <Icon className="w-4 h-4" />
              {t(`order_types.${value.toLowerCase().replace(/ /g, '_')}`)}
            </Button>
          );
        })}
      </div>
    </div>
  );
};

export default OrderTypeSelect;
