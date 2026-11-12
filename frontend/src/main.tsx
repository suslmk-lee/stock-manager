import React from 'react';
import ReactDOM from 'react-dom/client';
import Dashboard from './Dashboard';
import { AppearanceProvider, initAppearance } from './appearance/AppearanceContext';
import { AlertsProvider } from './components/alerts/AlertsProvider';
import { UpdateProvider } from './components/update/UpdateProvider';
import { markDesktopChrome } from './platform/desktop';
import CursorTrail from './components/effects/CursorTrail';
import CursorPointer from './components/effects/CursorPointer';
import CardTilt from './components/effects/CardTilt';
import './index.css';

initAppearance();
markDesktopChrome();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppearanceProvider>
      <CursorTrail />
      <CursorPointer />
      <CardTilt />
      <AlertsProvider>
        <UpdateProvider>
          <Dashboard />
        </UpdateProvider>
      </AlertsProvider>
    </AppearanceProvider>
  </React.StrictMode>
);
