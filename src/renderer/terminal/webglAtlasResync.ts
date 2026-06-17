// WebGL 字形图集(glyph atlas)采用分页纹理。大量不同字形(尤其中文 CJK)会把
// 页数推到上限(macOS 上 ~ min(32, MAX_TEXTURE_IMAGE_UNITS) ≈ 16),触发页合并/删页,
// 重排所有字形的 texturePage 索引。已绘制单元格的顶点里仍存旧的 a_texpage / 纹理坐标,
// 与重排后的图集不再对应 → 采样到错误的纹理页,画出与码点不符的字形 = CJK 错位/串字乱码
// (见 docs/features/TERMPRO-B260615152207/bugfix/BUG-TERMPRO-B260615152207-001.md)。
//
// 关键:仅靠 term.refresh(0, rows-1) 不够。WebglRenderer._updateModel 会按「字符+属性」
// 与缓存模型逐格 diff,内容没变的格子直接 continue(addon-webgl WebglRenderer.ts:507);
// 而图集重排只改字形位置、不改单元格内容 → 可见 CJK 格全部被跳过,旧 a_texpage 原样留在
// 字形顶点缓冲里,refresh 对它们等于空操作,乱码会残留到该格内容被覆盖为止(= 偶发乱码)。
//
// 修复:图集删页(合并)或换图集时,改调 webgl.clearTextureAtlas()。它一次做三件
// refresh 做不到的事(addon-webgl WebglRenderer.ts:307-311):
//   1) charAtlas.clearTexture() —— 清空图集页与字形栅格缓存;
//   2) _clearModel(true) —— 清零渲染模型「与」整段字形顶点缓冲(真正抹掉旧 a_texpage);
//   3) _requestRedrawViewport() —— 触发整屏重绘,每格按新图集重新绑定。
// 用微任务去抖,把一帧内多次图集变更合并成一次清理。clearTextureAtlas 自身不发
// onRemove/onChange(二者仅由合并 / 换图集实例触发),故不会自激成重绘风暴。
//
// 注:仅订阅「删页(remove)」与「换图集(change)」—— 增页(add)不重排既有索引、
// 新字形会在自己下一帧正确绑定,无需清理,订阅它只会在正常填充期造成无谓刷新风暴。

/** WebglAddon 暴露的子集:图集分页事件 + 清空图集(结构化匹配 · 便于单测注入假对象)。 */
interface WebglAtlasControl {
  onRemoveTextureAtlasCanvas(listener: () => void): { dispose(): void };
  onChangeTextureAtlas(listener: () => void): { dispose(): void };
  /** 清空图集页 + 渲染模型 + 字形顶点缓冲,并请求整屏重绘 */
  clearTextureAtlas(): void;
}

/**
 * 将「图集分页变更」接到「清空图集 + 整屏重绘」上(微任务去抖)。
 * 返回停止函数,解除事件订阅;WebglAddon dispose 时其事件发射器亦会释放监听,
 * 故组件侧即便不显式调用也不泄漏,但保留停止函数以便显式清理与单测。
 */
export function wireWebglAtlasResync(webgl: WebglAtlasControl): () => void {
  let scheduled = false;
  const scheduleResync = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      webgl.clearTextureAtlas();
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
