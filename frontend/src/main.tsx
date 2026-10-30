import React from 'react';
import ReactDOM from 'react-dom/client';
import Dashboard from './Dashboard';
import { AppearanceProvider, initAppearance } from './appearance/AppearanceContext';
import { AlertsProvider } from './components/alerts/AlertsProvider';
import CursorTrail from './components/effects/CursorTrail';
import './index.css';

initAppearance();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppearanceProvider>
      <CursorTrail />
      <AlertsProvider>
        <Dashboard />
      </AlertsProvider>
    </AppearanceProvider>
  </React.StrictMode>
);
