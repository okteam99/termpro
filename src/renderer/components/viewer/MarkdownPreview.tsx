// Markdown 预览(W2 由子代理实现:marked + DOMPurify + mermaid + 放大)。
interface Props {
  path: string;
  /** 编辑器有未保存内容时优先取它(无编辑器/未打开则 null → 读磁盘) */
  getEditorValue?: () => string | null;
}

export function MarkdownPreview({ path }: Props) {
  return <div className="viewer-message">Markdown 预览构建中…({path})</div>;
}
