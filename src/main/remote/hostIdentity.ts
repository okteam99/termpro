// hostTag 派生(多设备同屏 TECH §A.1 · docs/features/multi-device-mirror.md)。
//
// 身份收敛的地基:hostTag = 服务端身份键(与 configId=客户端本地 UI 键分离)。
// 派生源 = (本次连接实握的 host key SHA-256 摘要, SSH 用户名)——与连接地址/端口
// 无关(用户前提 3:各端连接参数可不同仍收敛)。
//
// 🔴 hostTag 是【寻址键非鉴权】(TECH §5 安全清单 6):派生被污染最坏只导致路由到
// 错身份的端口目录,真屏障恒是 128-bit token 常量时间校验。
//
// 设计偏差备注:TECH 原文落 src/shared/(两端可引),实际仅 main 编排消费且依赖
// node:crypto(shared 约束零 Node import),故落 main/remote;两端复用需求出现时再迁。

import * as crypto from 'node:crypto';

const FP_DIGEST_LEN = 32;

/**
 * hostTag 派生纯函数(TECH §A.1 派生式 1:1):
 *   tag = 'id-' + SHA256( fpDigest(32B) ‖ utf8(username) ).base64url[:26]
 * - fpDigest 定长 32B 前缀 → 与任意 username 拼接单射,无需分隔符/HMAC;
 * - 'id-' 前缀与遗留随机 configId(无前缀)命名空间隔离,hosts/ 目录不撞;
 * - 截断 26 字符 ≈ 156 bit,单用户服务器量级下碰撞可忽略。
 */
export function deriveHostTag(fpDigest: Buffer, username: string): string {
  if (fpDigest.length !== FP_DIGEST_LEN) {
    // 定长是拼接单射的前提;长度异常说明调用方没喂 SHA-256 摘要,fail-fast 而非静默错派生
    throw new Error(`deriveHostTag: fpDigest must be ${FP_DIGEST_LEN} bytes, got ${fpDigest.length}`);
  }
  const material = Buffer.concat([fpDigest, Buffer.from(username, 'utf8')]);
  const tag = crypto.createHash('sha256').update(material).digest('base64url');
  return `id-${tag.slice(0, 26)}`;
}

export interface ResolveHostTagOptions {
  /** true=隔离模式(退化 tag==configId,现状行为);false=收敛(派生) */
  isolate: boolean;
  configId: string;
  username: string;
  /** ssh 连接实握的 host key SHA-256 摘要;null=未捕获(老 ssh2/桩)→ fail-safe 退隔离 */
  fpDigest: Buffer | null;
}

/**
 * 编排入口(TECH §A.4):isolate 或指纹缺失 → hostTag=configId(不收敛但不炸);
 * 否则派生收敛 tag。指纹长度异常同样退隔离(fail-safe,绝不半派生)。
 */
export function resolveHostTag(opts: ResolveHostTagOptions): string {
  if (opts.isolate || opts.fpDigest === null || opts.fpDigest.length !== FP_DIGEST_LEN) {
    return opts.configId;
  }
  return deriveHostTag(opts.fpDigest, opts.username);
}
