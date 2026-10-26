import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ToastProvider } from './ui.jsx';
// Fuentes incluidas en el build: el panel se ve igual aunque no haya internet.
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-500.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import '@fontsource/pixelify-sans/latin-ext-400.css';
import '@fontsource/pixelify-sans/latin-ext-500.css';
import './styles.css';
import { registerServiceWorker } from './notify.js';
import { applyAnimated, applyBackground, applyTheme, getAnimated, getBackground, getTheme } from './theme.js';

applyTheme(getTheme());
applyBackground(getBackground());
applyAnimated(getAnimated());
registerServiceWorker();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);
