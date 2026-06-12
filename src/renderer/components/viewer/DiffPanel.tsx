// U3 占位:diff 面板由子代理实现(变更文件列表 + Monaco diff)。
interface Props {
  toplevel: string;
  baseRef: string | null;
}

export function DiffPanel({ toplevel, baseRef }: Props) {
  return (
    <div className="viewer-body">
      <div className="viewer-message">
        Diff 面板建设中({toplevel}
        {baseRef ? ` vs ${baseRef}` : ' · 未提交变更'})
      </div>
    </div>
  );
}
