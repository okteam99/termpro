// Chrome 按「活着的 WebGL context 数」设每页上限(≈16):超限即对最老的 context 发
// webglcontextlost 强制回收——受害者往往是存活最久、正被用户盯着的可见终端,表现为
// 内容区黑屏/冻结残帧,且 resize 无效(context 已死,GL 调用全部空转;resize 反而把
// 残帧清成纯黑)。console 特征日志:`CONTEXT_LOST_WEBGL: loseContext: context lost`。
//
// 而 WebglAddon.dispose() 只移除 canvas、释放 JS 引用,GL context 本身要等 GC 才真正
// 消亡。tab 切换、图集合并重建(webglAtlasResync)是 dispose/新建成对发生的风暴场景:
// 旧 context 迟迟不消亡 + 新 context 成批创建,瞬时总数极易冲破上限。
// 这里在 dispose 后立即用 WEBGL_lose_context.loseContext() 把释放变成确定性动作。
//
// canvas 取自 addon 私有字段(_renderer._canvas,@xterm/addon-webgl@0.19)。升级若改
// 内部结构,仅退化为「等 GC」(与无此函数时一致),不影响功能正确性,故静默容错。

/** 结构化匹配 WebglAddon 的最小面(便于单测注入假对象)。 */
interface DisposableWebgl {
  dispose(): void;
}

/**
 * dispose WebglAddon 并立即强制释放其 WebGL context(机制见顶注)。
 * 必须先 dispose 再 loseContext:dispose 内部还有 GL 清理调用,
 * 先杀 context 会让它们全变成 INVALID_OPERATION 噪音。
 */
export function disposeWebglAddon(webgl: DisposableWebgl): void {
  const canvas = (webgl as unknown as { _renderer?: { _canvas?: HTMLCanvasElement } })
    ._renderer?._canvas;
  webgl.dispose();
  try {
    canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* context 已丢失等边缘情况:释放本就不再必要 */
  }
}
