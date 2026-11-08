import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './state/store.jsx';
import App from './App.jsx';
import './styles/theme.css';
import './styles/app.css';
import './styles/auth.css';
import './styles/clean.css';

createRoot(document.getElementById('root')).render(
  <AppProvider><App /></AppProvider>
);
