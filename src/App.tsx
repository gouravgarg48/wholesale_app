import { useState } from 'react';
import { InventoryList } from './features/inventory/InventoryList';
import { AddProductForm } from './features/inventory/AddProductForm';
import './App.css';

function App() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  return (
    <div>
      <AddProductForm onCreated={() => setRefreshTrigger((n) => n + 1)} />
      <InventoryList refreshTrigger={refreshTrigger} />
    </div>
  );
}

export default App;