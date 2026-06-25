import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';

console.log('[Terminal] Starting...');

const rootEl = document.getElementById('root');
if (!rootEl) {
  document.body.innerHTML = '<div style="color:#e0e0f0;padding:40px;text-align:center;"><h2>启动失败</h2><p>未找到 #root 元素</p></div>';
} else {
  try {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
    console.log('[Terminal] React mounted');
  } catch (err) {
    console.error('[Terminal] Mount failed:', err);
    rootEl.innerHTML = `
      <div style="color:#e0e0f0;padding:40px;text-align:center;font-family:sans-serif;">
        <h2>⚠️ 应用初始化失败</h2>
        <pre style="color:#8888aa;margin-top:16px;font-size:14px;">${(err as Error).message}</pre>
        <button onclick="location.reload()" style="margin-top:16px;padding:8px 24px;background:#6c8cff;border:none;border-radius:8px;color:white;font-size:14px;cursor:pointer;">重新加载</button>
      </div>`;
  }
}
