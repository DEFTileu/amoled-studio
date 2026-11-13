import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import App from './App';
import { browserClient } from './runtime/browserClient';
import type { RuntimeClient } from './runtime/client';

/** One UI, two transports: Tauri IPC inside the desktop webview, the browser adapter everywhere else. */
async function pickClient(): Promise<RuntimeClient> {
  return '__TAURI_INTERNALS__' in window ? (await import('./runtime/tauriClient')).tauriClient : browserClient;
}

pickClient().then((client) => createRoot(document.getElementById('root')!).render(<App client={client} />));
