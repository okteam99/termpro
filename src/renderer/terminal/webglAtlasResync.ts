// WebGL 字形图集(glyph atlas)采用分页纹理。大量不同字形(尤其中文 CJK)会把
// 页数推到上限(macOS 上 ~ min(32, MAX_TEXTURE_IMAGE_UNITS) ≈ 16),触发页合并/删页,
// 重排所有字形的 texturePage 索引。已绘制单元格的 a_texpage / 纹理坐标若不与重排后的
// 图集同步重建,就会采样到错误的纹理页 → 画出与码点不符的字形 = CJK 错位/串字乱码
// (见 docs/features/TERMPRO-B260615152207/bugfix/BUG-TERMPRO-B260615152207-001.md)。
//
// 修复:图集发生删页(合并)或整体替换时,强制全量重绘整屏,让每个单元格的
// texturePage 索引与重排后的图集即时对齐。用微任务去抖,把一帧内多次图集变更合并成
// 一次 refresh,并防止 refresh 本身可能触发的图集变更造成同步重入。
//
// 注:仅订阅「删页(remove)」与「换图集(change)」—— 增页(add)不重排既有索引、
// 新字形会在自己下一帧正确绑定,无需重绘,订阅它只会在正常填充期造成无谓刷新风暴。

/** WebglAddon 暴露的图集事件子集(结构化匹配 · 便于单测注入假对象)。 */
interface AtlasEventSource {
  onRemoveTextureAtlasCanvas(listener: () => void): { dispose(): void };
  onChangeTextureAtlas(listener: () => void): { dispose(): void };
}

/** Terminal 的重绘子集。 */
interface Refreshable {
  readonly rows: number;
  refresh(start: number, end: number): void;
}

/**
 * 将「图集分页变更」接到「整屏重绘」上(微任务去抖)。
 * 返回停止函数,解除事件订阅;WebglAddon dispose 时其事件发射器亦会释放监听,
 * 故组件侧即便不显式调用也不泄漏,但保留停止函数以便显式清理与单测。
 */
export function wireWebglAtlasResync(
  webgl: AtlasEventSource,
  term: Refreshable,
): () => void {
  let scheduled = false;
  const scheduleResync = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      term.refresh(0, Math.max(0, term.rows - 1));
    });
  };
  const disposables = [
    webgl.onRemoveTextureAtlasCanvas(scheduleResync),
    webgl.onChangeTextureAtlas(scheduleResync),
  ];
  return () => {
    for (const d of disposables) d.dispose();
  };
}
