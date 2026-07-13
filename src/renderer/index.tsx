import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ViewerWindow } from './components/viewer/ViewerWindow';
import type { ViewerPayload } from './components/viewer/ViewerWindow';
import { installSelectionGuard } from './terminal/selectionGuard';
import { setLocale } from '../shared/i18n';
import './index.css';

// 首帧前应用 main 已解析的生效 locale(argv 注入,含持久化偏好)——
// 覆盖 i18n 模块默认的 navigator 自检,主窗/查看窗一致且无语言闪换
const argLocale = window.termpro?.locale;
if (argLocale === 'en' || argLocale === 'zh-CN') setLocale(argLocale);

// 全局选区拖拽兜底:防 xterm「丢失 mouseup → 未按键却自动延展选区」(详见模块顶注)
installSelectionGuard();

// 同一渲染 bundle 双入口:带 ?viewer= 的窗口渲染独立查看器
function parseViewerPayload(): ViewerPayload | null {
  const raw = new URLSearchParams(window.location.search).get('viewer');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ViewerPayload;
  } catch {
    return null;
  }
}

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
const viewerPayload = parseViewerPayload();
createRoot(container).render(
  <React.StrictMode>
    {viewerPayload ? <ViewerWindow payload={viewerPayload} /> : <App />}
  </React.StrictMode>,
);
