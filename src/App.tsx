import { useState } from 'react';
import { AddProductForm } from './features/inventory/AddProductForm';
import { InventoryList } from './features/inventory/InventoryList';
import { RestockForm } from './features/inventory/RestockForm';
import { PaymentForm } from './features/ledger/PaymentForm';
import { RetailerForm } from './features/ledger/RetailerForm';
import { RetailerList } from './features/ledger/RetailerList';
import { SaleForm } from './features/ledger/SaleForm';

function App() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const refresh = () => setRefreshTrigger((n) => n + 1);

  return (
    <div>
      <RetailerForm onCreated={refresh} />
      <RetailerList refreshTrigger={refreshTrigger} />
      <PaymentForm onCreated={refresh} />
      <AddProductForm onCreated={refresh} />
      <RestockForm onCreated={refresh} />
      <SaleForm onCreated={refresh} />
      <InventoryList refreshTrigger={refreshTrigger} />
    </div>
  );
}

export default App;