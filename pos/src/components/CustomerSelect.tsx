import { usePOSStore } from '../store/pos-store';
import { CustomerPicker } from './CustomerPicker';

interface CustomerSelectProps {
  disabled?: boolean;
}

export function CustomerSelect({ disabled }: CustomerSelectProps) {
  const { selectedCustomer, setSelectedCustomer, isUpdatingOrder } = usePOSStore();

  return (
    <CustomerPicker
      value={selectedCustomer}
      onChange={setSelectedCustomer}
      disabled={disabled || isUpdatingOrder}
    />
  );
}
