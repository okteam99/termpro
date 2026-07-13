// 协议版本区间兼容判定(客户端单方判定 · 闭区间重叠)。
// 每个端点声明自己能讲的闭区间 [minCompatible, protocolVersion];协商版本 =
// min(Vc, Vh)(新端向旧端降级),兼容 ⇔ 该协商版本同时落在双方闭区间内。
// 纯函数,无 IO,放 shared 便于两端与测试复用(TECH §数据结构 · QA-R3-2)。

import { HostInfo, PROTOCOL_MIN_COMPATIBLE, PROTOCOL_VERSION } from './protocol';

/**
 * 闭区间重叠判定。
 * @param clientVersion  Vc 客户端 protocolVersion
 * @param clientMin      Mc 客户端 minCompatible
 * @param hostVersion    Vh host protocolVersion
 * @param hostMin        Mh host minCompatible
 * @returns 协商版本 min(Vc,Vh) 是否同时落在双方闭区间内
 */
export function isProtocolCompatible(
  clientVersion: number,
  clientMin: number,
  hostVersion: number,
  hostMin: number,
): boolean {
  const negotiated = Math.min(clientVersion, hostVersion);
  // negotiated ≤ Vc 且 ≤ Vh 恒成立,故成员判定只剩下界;
  // 等价于 max(Mc, Mh) ≤ min(Vc, Vh)。
  return (
    clientMin <= negotiated &&
    negotiated <= clientVersion &&
    hostMin <= negotiated &&
    negotiated <= hostVersion
  );
}

/** host.info 缺省 minCompatible 时回落到 protocolVersion(TC-A02 / T-007)。 */
export function resolveHostMinCompatible(info: HostInfo): number {
  return info.minCompatible ?? info.protocolVersion;
}

export interface ProtocolIncompatibleDetail {
  code: 'PROTOCOL_INCOMPATIBLE';
  client: { v: number; min: number };
  host: { v: number; min: number };
}

/** 构造含双方四数的结构化不兼容错误(TC-A01 · 不兼容分支)。 */
export function buildIncompatibleDetail(
  clientVersion: number,
  clientMin: number,
  hostVersion: number,
  hostMin: number,
): ProtocolIncompatibleDetail {
  return {
    code: 'PROTOCOL_INCOMPATIBLE',
    client: { v: clientVersion, min: clientMin },
    host: { v: hostVersion, min: hostMin },
  };
}

/** 客户端侧:用本端常量对某个 host.info 判定兼容性。 */
export function checkHostInfoCompatible(info: HostInfo): {
  compatible: boolean;
  detail: ProtocolIncompatibleDetail;
} {
  const Vc = PROTOCOL_VERSION;
  const Mc = PROTOCOL_MIN_COMPATIBLE;
  const Vh = info.protocolVersion;
  const Mh = resolveHostMinCompatible(info);
  return {
    compatible: isProtocolCompatible(Vc, Mc, Vh, Mh),
    detail: buildIncompatibleDetail(Vc, Mc, Vh, Mh),
  };
}

/**
 * 应用版本点分数值比较(x.y.z;段数不等按缺段=0)。任一段非纯数字或输入为空 → null
 * (语义交由调用方决定;isHostAppOutdated 按「不可判定 = 过旧」fail-to-upgrade)。
 */
export function compareAppVersions(a: string, b: string): number | null {
  const pa = parseDottedVersion(a);
  const pb = parseDottedVersion(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function parseDottedVersion(v: string): number[] | null {
  const parts = v.trim().split('.');
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    nums.push(Number(p));
  }
  return nums.length > 0 ? nums : null;
}

/**
 * 服务端应用版本是否低于客户端(用户规则 2026-07-13:连接时服务端必须 ≥ 客户端,
 * 否则先升级服务端——在跑任务可以被关闭;彻底解决「服务端永不升级」)。
 * - host 未上报 appVersion(旧版 host)→ true(视为过旧)
 * - 任一版本不可解析 → true(不可判定按过旧处理,宁升级不滞留)
 * - host > client(多设备:旧客户端连新 host)→ false
 *   (只升不降:防新旧客户端各按己版反复替换服务端)
 */
export function isHostAppOutdated(
  hostAppVersion: string | undefined,
  clientAppVersion: string,
): boolean {
  if (!hostAppVersion) return true;
  const cmp = compareAppVersions(hostAppVersion, clientAppVersion);
  if (cmp === null) return true;
  return cmp < 0;
}

/** 不兼容时抛出的 Error(携带结构化 detail 供 UI/日志消费)。 */
export class ProtocolIncompatibleError extends Error {
  readonly detail: ProtocolIncompatibleDetail;
  constructor(detail: ProtocolIncompatibleDetail) {
    super(
      `PROTOCOL_INCOMPATIBLE: client v${detail.client.v}(min ${detail.client.min}) ` +
        `vs host v${detail.host.v}(min ${detail.host.min})`,
    );
    this.name = 'ProtocolIncompatibleError';
    this.detail = detail;
  }
}
