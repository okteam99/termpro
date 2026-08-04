// 项目内 HTML 预览:纯逻辑(选根 + 拼 URL),与 host/previewServer.ts 的 URL 约定配对
// (见该文件头注)——`http://127.0.0.1:<port>/<token>/<相对 root 路径>`。零副作用,可单测。

import type { PreviewInfo } from '../../shared/protocol';
import { isInsideOrEqual, relativeParts } from '../filepanel/pathContainment';

/** 文件名是否可预览(.html/.htm,大小写不敏感)。 */
export function isPreviewable(fileName: string): boolean {
  return /\.html?$/i.test(fileName);
}

/**
 * 选预览根:file 在 workspaceRoot 下 → workspaceRoot;否则在 effectiveRoot 下 → effectiveRoot;
 * 都不在(越界 / 两者皆缺)→ null。绝不猜根——猜错根会把预览 server 錯误地钉在无关目录,
 * 且越权暴露该目录外的文件(host 侧 containment 只保证不逃出所给 root,根本身选错则形同虚设)。
 */
export function pickPreviewRoot(args: {
  filePath: string;
  workspaceRoot: string | null | undefined;
  effectiveRoot: string | null | undefined;
}): string | null {
  const { filePath, workspaceRoot, effectiveRoot } = args;
  if (workspaceRoot && isInsideOrEqual(filePath, workspaceRoot)) return workspaceRoot;
  if (effectiveRoot && isInsideOrEqual(filePath, effectiveRoot)) return effectiveRoot;
  return null;
}

/**
 * PreviewInfo(preview.ensure 的返回)+ 绝对文件路径 → 可直接喂给 <webview src> 的预览 URL。
 * file 不在 info.root 下 → null(绝不吐一个注定 404 的 URL——例如 root 是 realpath 而
 * filePath 途经符号链接,复用既有 pathContainment 工具做字符串层面的包含判定)。
 * 逐段 encodeURIComponent 而非整段编码:'/' 分隔符必须保留,只编码段内字符
 * (空格 → %20,中文 → UTF-8 百分号编码,# → %23,? → %3F,否则请求行截断/参数被吞)。
 */
export function buildPreviewUrl(info: PreviewInfo, absFilePath: string): string | null {
  if (!isInsideOrEqual(absFilePath, info.root)) return null;
  const parts = relativeParts(absFilePath, info.root);
  const encoded = [info.token, ...parts].map(encodeURIComponent).join('/');
  return `http://127.0.0.1:${info.port}/${encoded}`;
}
