import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ViewerWindow } from './components/viewer/ViewerWindow';
import type { ViewerPayload } from './components/viewer/ViewerWindow';
import './index.css';

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
