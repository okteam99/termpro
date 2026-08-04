// 查看器渲染进程级 hold 引用计数(评审 P1-1)。
//
// browserNet.hold(hostIds) 对某 webContents 是【整集覆盖】语义,不是增量。同一查看器
// 窗口(同 webContents)可能同时开多个 HTML 预览 tab,若各自直接调
// hold([hostId])/hold([]),后卸载的 tab 会用空集把前一个仍在用的 hostId 也覆盖掉,
// 拆掉了其它 tab 的 SOCKS 代理(同窗多 html tab 互相拆台)。
//
// 本模块按 hostId 记引用计数,acquire/release 后一律上报【全集】(去重排序),而非
// 「这次变动了谁」——调用方(HtmlPreview)只管声明自己还在不在用某 hostId,不用关心
// 同窗其它 tab 的状态。上报失败只 console.warn,不抛(不该因为一次 IPC 失败打断预览
// 加载/卸载流程)。
const counts = new Map<string, number>();

function currentHoldSet(): string[] {
  const ids: string[] = [];
  for (const [id, n] of counts) {
    if (n > 0) ids.push(id);
  }
  return ids.sort();
}

async function report(): Promise<void> {
  try {
    await window.okwork.browserNet.hold(currentHoldSet());
  } catch (err) {
    console.warn('[viewer] browserNet.hold failed:', err);
  }
}

/** 某 hostId 的引用 +1,上报全集(含此次新增)。调用方应 await 完再挂 webview src——
 *  出口须先进 main 的在用集合,SOCKS 代理才会转发(见 HtmlPreview 头注同一红线)。 */
export function acquire(hostId: string): Promise<void> {
  counts.set(hostId, (counts.get(hostId) ?? 0) + 1);
  return report();
}

/** 某 hostId 的引用 -1(降到 0 则从计数表摘除),上报全集(不含已归零的 hostId)。 */
export function release(hostId: string): Promise<void> {
  const n = counts.get(hostId) ?? 0;
  if (n <= 1) counts.delete(hostId);
  else counts.set(hostId, n - 1);
  return report();
}

/** 仅供单测:清空模块级计数表,使多用例间互不干扰。 */
export function __resetExitHoldCounterForTest(): void {
  counts.clear();
}
