import React from 'react';
import ReactDOM from 'react-dom/client';
import Dashboard from './Dashboard';
import { AppearanceProvider, initAppearance } from './appearance/AppearanceContext';
import './index.css';

initAppearance();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppearanceProvider>
      <Dashboard />
    </AppearanceProvider>
  </React.StrictMode>
);
