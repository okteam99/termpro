// WebGL 字形图集(glyph atlas)采用分页纹理。大量不同字形(尤其中文 CJK)会把
// 页数推到上限(macOS 上 ~ min(32, MAX_TEXTURE_IMAGE_UNITS) ≈ 16),触发页合并/删页
// (TextureAtlas._createNewPage → _mergePages),重排被合并页里字形的 texturePage 索引。
//
// 真因(BUG-TERMPRO-B260615152207-001):addon 的 GPU 纹理上传是 version 门控的——
// GlyphRenderer.render() 仅当 `page.version !== _atlasTextures[i].version` 才重传该页纹理
// (GlyphRenderer.ts)。合并后被重排的页 version 是各页独立的小计数器(从 0 起、++),
// _pages 数组多轮 splice 后同一下标会被不同页复用,新页的低 version 可能与该纹理单元
// 残留的 version 碰撞 → 判等 → 跳过重传 → GPU 上还是旧页像素,而顶点的 a_texpage/坐标
// 已按合并后的新图集算 → 采样到错误字形 = CJK 串字乱码。会话越久、合并轮数越多,碰撞
// 概率越高(= 偶发、跑久了才乱)。
//
// 为何旧的两次兜底都没救它:
//   1) refresh(0,rows-1) / clearTextureAtlas 都只重写「顶点」与「渲染模型」,而顶点从来
//      是对的——坏的是 GPU 纹理页像素没被重传。version 门控那个 `if` 永远判 false。
//   2) clearTextureAtlas 从不重置 _atlasTextures[*].version,无法强制重传。
// 唯一可靠的恢复路径是让纹理「全量重传」:整窗 resize 能让乱码消失,正是因为它走
//   handleResize → _refreshCharAtlas → setAtlas(),而 setAtlas 把所有 _atlasTextures
//   的 version 置 -1 → 下一帧每页 `version(≥0) !== -1` 必然成立 → 全量重传。
//
// 修复(见 TerminalView.mountWebgl/remountWebgl):图集删页(合并)事件触发时,重建整个
// WebglAddon。全新 GlyphRenderer 的纹理 version 全为 -1,下一帧必然全量重传,version
// 碰撞从物理上不可能发生,一次性覆盖所有 desync 源(合并/换实例/DPR)。
//
// 注:**只订阅删页(remove)**——它仅由 _mergePages 在合并时发(TextureAtlas.ts:224)。
//   不订阅换图集(change):换实例自身已走 setAtlas 重置 version 自愈,无需处理;且全新
//   addon 初始化时 `_charAtlas` 由 undefined→实例会发一次 change,若订阅它会自激成
//   无限重建循环。也不订阅增页(add):正常填充每加一页都发,订阅会造成刷新风暴。

/** WebglAddon 暴露的子集:图集删页事件(结构化匹配 · 便于单测注入假对象)。 */
interface WebglAtlasEvents {
  onRemoveTextureAtlasCanvas(listener: () => void): { dispose(): void };
}

/**
 * 将「图集删页(合并)」接到 `onRearrange` 上(微任务去抖,一帧内多次合并合并成一次)。
 * `onRearrange` 应执行强制纹理全量重传的动作(本项目里 = 重建 WebglAddon)。
 * 返回停止函数解除订阅;WebglAddon dispose 时其事件发射器亦会释放监听,故组件侧即便
 * 不显式调用也不泄漏,但保留停止函数以便显式清理与单测。
 */
export function wireWebglAtlasResync(
  webgl: WebglAtlasEvents,
  onRearrange: () => void,
): () => void {
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      onRearrange();
    });
  };
  const disposables = [webgl.onRemoveTextureAtlasCanvas(schedule)];
  return () => {
    for (const d of disposables) d.dispose();
  };
}
