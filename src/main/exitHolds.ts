// 在用出口合成账本(阶段3:查看器 HTML 预览铺路)。
//
// browserNetwork.syncExits 的「在用出口集合」契约专属主窗口(浏览器面板只在主窗
// 声明式上报),但查看器等非主窗也可能需要某远程出口的 SOCKS 代理存活(内嵌
// <webview> 走 browserPartition(DEFAULT_PROFILE_ID, hostId) 预览远程 HTML)。
// 本账本把「主窗声明式集合」与「各非主窗(按 webContents.id 记账)各自持有的
// hold 集合」取并集,作为喂给 browserNetwork.syncExits 的最终在用出口——两个
// 来源互不覆盖、互不吞并,任一来源仍在用都保代理活。
//
/**
 * browserNet:hold 请求闸的纯逻辑部分(评审 P2-6 + 评审盲区1):把请求的 hostId 列表收紧
 * 到 ⊆ {ownHostId}——查看器窗口只能持有它自己所服务的那台机器的出口,不许声称持有别的
 * 窗口(另一台机器)的出口。main.ts 侧反查该 sender 所属窗口在 fileWins(hostId→窗口)
 * 里的 hostId 传作 ownHostId;ownHostId 为 null(sender 不是任何已知查看器窗口)时一律
 * 返回空。非法元素(非字符串/空串)一并在此过滤掉。
 *
 * 只做「窗口只能碰自己的机器」这道纯逻辑判定;remoteHostConfigStore 存在性校验(hostId
 * 是否是一个真实配置过的远程机)仍留在 main.ts——那一步碰运行时状态,不适合搬进纯函数。
 */
export function filterHoldRequest(
  requested: string[],
  ownHostId: string | null,
): string[] {
  if (!ownHostId) return [];
  return requested.filter((id) => typeof id === 'string' && id === ownHostId);
}

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

  /** 移除某 hostId(评审 P2-5:远程机被删除时调用)——从主窗集合与所有非主窗 hold 集合
   *  里一并摘除该 hostId,防止已删除的远程机残留在 effective() 里,让 syncExits 继续为
   *  一台不存在的机器保活 SOCKS 代理/隧道。只动这一个 hostId,其余 id 与其它 key 的
   *  hold 集合不受影响。 */
  purge(hostId: string): void {
    this.mainIds = this.mainIds.filter((id) => id !== hostId);
    for (const [key, ids] of this.holds) {
      if (!ids.includes(hostId)) continue;
      const next = ids.filter((id) => id !== hostId);
      if (next.length === 0) this.holds.delete(key);
      else this.holds.set(key, next);
    }
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
