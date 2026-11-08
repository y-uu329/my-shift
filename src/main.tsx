import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SettingsProvider } from './settingsContext';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);

// 公開版だけ：オフラインでも開けるようにする仕組みを登録し、データを消されにくくするようお願いする
if (import.meta.env.PROD && window.isSecureContext && window.self === window.top) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 使えない環境では何もしない */
    });
  }
  navigator.storage?.persist?.().catch(() => {});
}
