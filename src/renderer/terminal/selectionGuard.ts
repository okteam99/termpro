// xterm 选区拖拽兜底:防「没按住鼠标却自动选中」。
//
// 机制:xterm 的 SelectionService 在左键 mousedown 时把 mousemove/mouseup 监听挂到
// document 上,仅当收到 mouseup 才调 _removeMouseDownListeners() 卸载。而其
// _handleMouseMove **不校验 event.buttons** —— 只要监听还在,任何 mousemove(无论是否
// 按键)都会延展选区。因此一旦某次 mouseup 没送达 document(拖拽中途窗口失焦、在内容
// 区外松手、被原生右键菜单吞掉等),监听残留,之后普通移动就被误判为拖拽,选区自动蔓延。
//
// 兜底:窗口级捕获阶段跟踪「有过一次左键按下、却还没等到对应的松开」。当检测到
//   (a) 仍处于该拖拽态、但鼠标移动时左键位已抬起((buttons & 1) === 0,说明松开事件丢了),
//   (b) 拖拽中途窗口失焦,或
//   (c) 仍处于该拖拽态时窗口重新获得焦点 / 文档转为隐藏(跨应用切换),
// 就向 document 合成派发一个 mouseup,逼 xterm 走正常清理路径终止失控选区。合成事件对
// 未在选区中的 xterm 实例是无害 no-op(SelectionService 与 link 的 mouseup 处理都对
// 「无进行中选区」安全返回),且只卸掉残留监听、不清除已选文本。
//
// 为何需要 (c):拖选时把鼠标拖出窗口、在别的应用(如浏览器)上松手,本窗口收不到那次
// mouseup,Chromium 会把 buttons 一直卡在 1(幻影按键)。切回来后即便不按键移动,
// e.buttons 仍报 1 → 基于 buttons 的 (a) 路径永久失效,选区随移动疯狂蔓延。focus /
// visibilitychange 跃迁与 buttons 取值无关,是切回场景下唯一可靠的收尾时机;且 bug 能
// 一路活到「切回」恰恰意味着此刻 leftButtonDown 仍为 true(清它的两条路径都已被幻影按键
// 废掉),故用它当门控既精准命中又不会在每次获焦时空转。
//
// 用捕获阶段:我们的 mousemove 处理先于 xterm 的 document 级(冒泡)mousemove 跑;合成
// mouseup 在本次 move 抵达 document 前就已移除 xterm 的 mousemove 监听 → 零额外延展。

let installed = false;

/**
 * 安装选区守卫。幂等(重复调用是 no-op),返回卸载函数。
 * 全局只需一份:同一 document 上所有 xterm 实例共享这道兜底。
 */
export function installSelectionGuard(target: Window = window): () => void {
  if (installed) return () => undefined;
  installed = true;

  // 是否有一次左键按下尚未等到松开
  let leftButtonDown = false;

  const endStuckDrag = (): void => {
    leftButtonDown = false;
    target.document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0 }),
    );
  };

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) leftButtonDown = true;
  };
  const onMouseUp = (): void => {
    leftButtonDown = false;
  };
  const onMouseMove = (e: MouseEvent): void => {
    // 自以为在拖拽,却左键位已抬起 → 松开事件丢了,补发收尾
    if (leftButtonDown && (e.buttons & 1) === 0) endStuckDrag();
  };
  const onBlur = (): void => {
    // 拖拽中途失焦(切窗/通知抢焦点/窗外松手)→ 立即收尾,别等下次移动
    if (leftButtonDown) endStuckDrag();
  };
  const onFocus = (): void => {
    // 跨应用切回时仍自以为在拖拽 → 对应 mouseup 在切换中丢了(常伴 buttons 幻影卡 1),
    // 与 buttons 取值无关地强制收尾,赶在用户移动鼠标前卸掉残留监听
    if (leftButtonDown) endStuckDrag();
  };
  const onVisibility = (): void => {
    if (target.document.visibilityState === 'hidden' && leftButtonDown) {
      endStuckDrag();
    }
  };

  target.addEventListener('mousedown', onMouseDown, true);
  target.addEventListener('mouseup', onMouseUp, true);
  target.addEventListener('mousemove', onMouseMove, true);
  target.addEventListener('blur', onBlur);
  target.addEventListener('focus', onFocus);
  target.document.addEventListener('visibilitychange', onVisibility);

  return () => {
    installed = false;
    target.removeEventListener('mousedown', onMouseDown, true);
    target.removeEventListener('mouseup', onMouseUp, true);
    target.removeEventListener('mousemove', onMouseMove, true);
    target.removeEventListener('blur', onBlur);
    target.removeEventListener('focus', onFocus);
    target.document.removeEventListener('visibilitychange', onVisibility);
  };
}
