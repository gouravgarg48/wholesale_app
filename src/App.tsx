import { useState } from 'react';
import { InventoryList } from './features/inventory/InventoryList';
import { AddProductForm } from './features/inventory/AddProductForm';
import { RestockForm } from './features/inventory/RestockForm';
import { SaleForm } from './features/ledger/SaleForm';
import { RetailerForm } from './features/ledger/RetailerForm';
import { RetailerList } from './features/ledger/RetailerList';
import { PaymentForm } from './features/ledger/PaymentForm';
import { AgingReport } from './features/ledger/AgingReport';
import { SalesList } from './features/ledger/SalesList';

function App() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const refresh = () => setRefreshTrigger((n) => n + 1);

  return (
    <div>
      <RetailerForm onCreated={refresh} />
      <RetailerList refreshTrigger={refreshTrigger} />
      <AddProductForm onCreated={refresh} />
      <RestockForm onCreated={refresh} />
      <SaleForm onCreated={refresh} />
      <PaymentForm onCreated={refresh} />
      <AgingReport refreshTrigger={refreshTrigger} />
      <SalesList refreshTrigger={refreshTrigger} />
      <InventoryList refreshTrigger={refreshTrigger} />
    </div>
  );
}

export default App;