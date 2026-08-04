// 在用出口合成账本(阶段3:查看器 HTML 预览铺路)。
//
// browserNetwork.syncExits 的「在用出口集合」契约专属主窗口(浏览器面板只在主窗
// 声明式上报),但查看器等非主窗也可能需要某远程出口的 SOCKS 代理存活(内嵌
// <webview> 走 browserPartition(DEFAULT_PROFILE_ID, hostId) 预览远程 HTML)。
// 本账本把「主窗声明式集合」与「各非主窗(按 webContents.id 记账)各自持有的
// hold 集合」取并集,作为喂给 browserNetwork.syncExits 的最终在用出口——两个
// 来源互不覆盖、互不吞并,任一来源仍在用都保代理活。
//
// 纯逻辑,零 Electron import,可单测;main.ts 按 webContents.id 落 hold/清 hold。
export class ExitHoldLedger {
  /** 主窗口经 syncExits 声明式上报的在用出口集合。 */
  private mainIds: string[] = [];
  /** 非主窗(查看器等)各自持有的出口集合;key = webContents.id。 */
  private readonly holds = new Map<number, string[]>();

  /** 覆盖主窗集合(每次 syncExits 调用整体替换,与既有 browserNetwork.syncExits 语义一致)。 */
  setMain(hostIds: string[]): void {
    this.mainIds = [...hostIds];
  }

  /** 覆盖某 key 的 hold 集合;空数组等价清除(与 dropHold 同效)。 */
  setHold(key: number, hostIds: string[]): void {
    if (hostIds.length === 0) {
      this.holds.delete(key);
      return;
    }
    this.holds.set(key, [...hostIds]);
  }

  /** 清除某 key 的 hold(窗口/webContents 销毁时调用)。 */
  dropHold(key: number): void {
    this.holds.delete(key);
  }

  /** 并集,去重,排序(排序只为输出稳定,便于比对/测试,无语义意义)。 */
  effective(): string[] {
    const set = new Set<string>(this.mainIds);
    for (const ids of this.holds.values()) {
      for (const id of ids) set.add(id);
    }
    return [...set].sort();
  }
}
