// 项目内 HTML 预览编排:选根 → 按 hostId 严格路由拿 host client → preview.ensure → 拼 URL →
// 内置浏览器开预览标签(出口钉死所属机器、不落盘、UI 禁用出口选择器——见 store.ts
// BrowserTabState.preview)。失败路径一律返回确定性 message,不静默(FilePanel 行内提示消费)。

import { hostRegistry } from './hostRegistry';
import { openBuiltinBrowser } from './openBuiltinBrowser';
import { pickPreviewRoot, buildPreviewUrl } from './previewUrl';
import { t } from '../../shared/i18n';

export async function openHtmlPreview(args: {
  filePath: string;
  workspaceRoot: string | null;
  effectiveRoot: string | null;
  hostId: string;
  terminalTabId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { filePath, workspaceRoot, effectiveRoot, hostId, terminalTabId } = args;

  const root = pickPreviewRoot({ filePath, workspaceRoot, effectiveRoot });
  if (!root) {
    return {
      ok: false,
      message: t('This file is outside the workspace — cannot start a preview'),
    };
  }

  // 🔴 forHostId(定向路由,未命中→null 绝不兜底 local):预览必须打到【文件所属机器】的
  // host——远程路径喂给本机 host 会静默起错 server(hostRegistry.ts 头注红线)。
  const client = hostRegistry.forHostId(hostId);
  if (!client) {
    return { ok: false, message: t('Target machine is not connected') };
  }

  let info;
  try {
    info = await client.rpc('preview.ensure', { root });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unknown rpc method')) {
      return {
        ok: false,
        message: t("This machine's host is too old for preview — upgrade it"),
      };
    }
    return { ok: false, message: t('Failed to start the preview server: {error}', { error: msg }) };
  }

  const url = buildPreviewUrl(info, filePath);
  if (!url) {
    return { ok: false, message: t('Failed to build the preview URL') };
  }

  openBuiltinBrowser(terminalTabId, url, { netHostId: hostId, preview: true });
  return { ok: true };
}
