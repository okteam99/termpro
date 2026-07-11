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
// 修复(见 TerminalView.mountWebgl):图集删页(合并)事件触发时,直接调 GlyphRenderer.
// setAtlas(现图集)(forceAtlasReupload,经 addon 私有面)——即上面「整窗 resize 生效」
// 的同一条路径:全部纹理 version 置 -1,下一帧必然全量重传,version 碰撞从物理上不可能。
// 且**保留图集像素与 GL 上下文**:代价仅是 ≤16 页纹理的一次 GPU 重传(几 ms)。
//
// ⚠️ 不可用「重建整个 WebglAddon」做常规路径(2026-07 滚动卡顿/重影根因,
// BUG-TERMPRO 滚动性能):重建会清空整个字形图集 → 快速滚过高多样性内容
// (truecolor 渐变 + CJK,现代 TUI 的常态)时,刚栅格化的字形全部作废、页很快again填满
// → 再合并 → 再重建……自馈风暴。实测一次快划触发 8 次重建、单帧最长 66ms
// (稳态 8.3ms/120Hz),表现为滚动卡顿 + 换画布瞬间旧帧闪烁(重影),停稳后无新字形
// 才恢复。重建仅保留为 forceAtlasReupload 因 addon 升级改内部结构而失败时的兜底。
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
 * WebglAddon 私有面(@xterm/addon-webgl@0.19):_renderer(WebglRenderer)→
 * _glyphRenderer(MutableDisposable<GlyphRenderer>).value + _charAtlas。
 * 升级若改内部结构,forceAtlasReupload 返回 false,调用方兜底整体重建
 * (与 webglContextRelease 的私有面容错策略一致)。
 */
interface AtlasReuploadable {
  _renderer?: {
    _glyphRenderer?: { value?: { setAtlas?: unknown } };
    _charAtlas?: unknown;
  };
}

/**
 * 强制字形图集纹理全量重传(合并后 version 碰撞的最小代价救法,机制见顶注):
 * GlyphRenderer.setAtlas(现图集) 把全部 _atlasTextures[*].version 置 -1 →
 * 下一帧逐页重传。保留图集像素与 GL 上下文,不触发任何重新栅格化。
 * 返回 false = 私有面对不上/调用抛错,调用方须退回整体重建。
 */
export function forceAtlasReupload(webgl: unknown): boolean {
  const renderer = (webgl as AtlasReuploadable)._renderer;
  const glyph = renderer?._glyphRenderer?.value;
  const atlas = renderer?._charAtlas;
  if (!glyph || !atlas || typeof glyph.setAtlas !== 'function') return false;
  try {
    (glyph.setAtlas as (a: unknown) => void)(atlas);
    return true;
  } catch {
    return false;
  }
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
