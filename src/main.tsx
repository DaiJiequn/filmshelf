import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { seedIfNeeded } from './db/seed-stocks';
import './styles/tokens.css';
import './styles/app.css';

async function boot() {
  try {
    await seedIfNeeded();
    // 尽量申请持久化存储，降低浏览器自动清理数据的概率
    await navigator.storage?.persist?.();
  } catch (e) {
    console.error('初始化失败', e);
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
boot();
