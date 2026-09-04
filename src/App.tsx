import { useState } from 'react';
import { InventoryList } from './features/inventory/InventoryList';
import { AddProductForm } from './features/inventory/AddProductForm';
import { RestockForm } from './features/inventory/RestockForm';

function App() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const refresh = () => setRefreshTrigger((n) => n + 1);

  return (
    <div>
      <AddProductForm onCreated={refresh} />
      <RestockForm onCreated={refresh} />
      <InventoryList refreshTrigger={refreshTrigger} />
    </div>
  );
}

export default App;