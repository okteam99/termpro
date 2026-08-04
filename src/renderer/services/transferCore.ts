// 远程文件传输 阶段3:纯逻辑编排层(下载/上传的分块循环),零 UI/store 依赖——
// deps 里的 rpc/bridge 都是窄接口,单测用 mock 函数直喂,不依赖真实 HostClient/window.okwork。
//
// 下载:bridge(本机盘票据,见 types.d.ts window.okwork.transfer)开写票 → 循环
// rpc('fs.readFileRange') 分块拉远端内容 → bridge.write 落本机盘 → 全部读完(eof)→
// bridge.finish({commit:true}) 落地。
// 上传:rpc('fs.uploadBegin') 开传输 → 循环 bridge.read 分块读本机盘 → rpc('fs.uploadChunk')
// 推给远端 → 全部推完(eof)→ rpc('fs.uploadEnd',{commit:true}) 落地远端。
//
// 🔴 一致性口径(与 host/fsService.ts、main/localTransfer.ts 同款 TOCTOU 防线):
// 首块记录 size/mtimeMs 为基线,后续每块回报的 size/mtimeMs 与基线不等 → 判定源文件在
// 传输期间被改写,立即中止(file-changed),不把新旧内容拼进同一个产物。
//
// 🔴 清理保证(评审要点):任何失败/取消路径都必须释放本机票据(bridge.finish({commit:false}));
// 上传还须额外 best-effort 收尾远端半成品(rpc('fs.uploadEnd',{commit:false}))。两处都用
// try/finally 的 committed/released 标记实现,不靠散落各分支手写 cleanup 调用(漏一个就泄漏
// fd / 留 .part 临时文件)。

import { TRANSFER, type RpcMethodName, type RpcMethods } from '../../shared/protocol';

export type TransferFailure =
  | 'canceled'
  | 'file-changed'
  | 'link-lost'
  | 'too-large'
  | 'offset-mismatch'
  | 'local-io'
  | 'remote-io';

/**
 * host RPC 调用契约:与 HostClient.prototype.rpc 签名逐字段一致(可直接传
 * `client.rpc.bind(client)` 或 `(m, p) => client.rpc(m, p)`),单测可传任意匹配签名的 mock 函数。
 */
export type TransferRpc = <M extends RpcMethodName>(
  method: M,
  params: RpcMethods[M]['params'],
) => Promise<RpcMethods[M]['result']>;

/** 本机盘票据通道契约:与 window.okwork.transfer 逐字段一致(见 renderer/types.d.ts)。 */
export interface TransferBridge {
  beginSave(payload: {
    suggestedName?: string;
    size?: number;
  }): Promise<{ ticket: string; name: string } | null>;
  beginOpen(): Promise<Array<{ ticket: string; name: string; size: number; path: string }>>;
  write(payload: { ticket: string; offset: number; base64: string }): Promise<{ written: number }>;
  read(payload: {
    ticket: string;
    offset: number;
    length: number;
  }): Promise<{ base64: string; bytes: number; eof: boolean; size: number; mtimeMs: number }>;
  finish(payload: { ticket: string; commit: boolean }): Promise<{ path: string | null }>;
}

export type TransferResult<PathField extends string> =
  | ({ ok: true } & Record<PathField, string>)
  | { ok: false; reason: TransferFailure; detail?: string };

export type DownloadResult = TransferResult<'localPath'>;
export type UploadResult = TransferResult<'remotePath'>;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * rpc reject 按 message 归类:链路层拒绝(hostClient.ts 的几种确定性文案 + rpc 超时)
 * → link-lost;其余(host 侧 fsService/UploadRegistry 抛出的业务错误,如「not a regular
 * file」「upload exceeds declared size」等)→ remote-io。
 */
function classifyRpcError(err: unknown): TransferFailure {
  const msg = errMessage(err).toLowerCase();
  if (
    msg.includes('host connection lost') ||
    msg.includes('host not connected') ||
    msg.includes('host process exited') ||
    msg.includes('rpc timeout')
  ) {
    return 'link-lost';
  }
  return 'remote-io';
}

/** 首块记基线,后续块的 size/mtimeMs 与基线不等 → 源文件传输期间被改写。 */
function fileChanged(
  baseline: { size: number; mtimeMs: number } | null,
  block: { size: number; mtimeMs: number },
): boolean {
  return baseline !== null && (block.size !== baseline.size || block.mtimeMs !== baseline.mtimeMs);
}

/**
 * 下载:远端文件 → 本机盘(经系统保存对话框产生的写票)。
 * beginSave 返回 null(用户在保存对话框里取消)→ 零 RPC 副作用,直接判 canceled。
 */
export async function runDownload(deps: {
  rpc: TransferRpc;
  bridge: TransferBridge;
  path: string;
  name: string;
  size: number;
  onProgress: (done: number) => void;
  isCanceled: () => boolean;
}): Promise<DownloadResult> {
  const { rpc, bridge, path, name, size, onProgress, isCanceled } = deps;

  const saved = await bridge.beginSave({ suggestedName: name, size });
  if (!saved) return { ok: false, reason: 'canceled' };
  const { ticket } = saved;

  let committed = false;
  try {
    let offset = 0;
    let baseline: { size: number; mtimeMs: number } | null = null;

    while (true) {
      let block: RpcMethods['fs.readFileRange']['result'];
      try {
        block = await rpc('fs.readFileRange', { path, offset, length: TRANSFER.chunkBytes });
      } catch (err) {
        return { ok: false, reason: classifyRpcError(err), detail: errMessage(err) };
      }

      if (baseline === null) {
        baseline = { size: block.size, mtimeMs: block.mtimeMs };
      } else if (fileChanged(baseline, block)) {
        return { ok: false, reason: 'file-changed' };
      }

      if (block.bytes > 0) {
        try {
          await bridge.write({ ticket, offset, base64: block.base64 });
        } catch (err) {
          return { ok: false, reason: 'local-io', detail: errMessage(err) };
        }
        offset += block.bytes;
        onProgress(offset);
      }

      if (isCanceled()) return { ok: false, reason: 'canceled' };
      if (block.eof) break;
    }

    const finished = await bridge.finish({ ticket, commit: true });
    committed = true;
    if (!finished.path) {
      return { ok: false, reason: 'local-io', detail: 'save did not return a path' };
    }
    return { ok: true, localPath: finished.path };
  } finally {
    // 任何失败/取消路径(含上面各 return 与意外抛出)都落到这里:提交未完成 → 释放写票
    // (放弃并清理 .part 临时文件)。成功路径 committed=true,不重复 finish。
    if (!committed) {
      await bridge.finish({ ticket, commit: false }).catch(() => undefined);
    }
  }
}

/**
 * 上传:本机盘(经系统打开对话框产生的读票,已由调用方 beginOpen 拿到)→ 远端目录。
 * file.ticket 的生命周期归本函数管——无论成败,finally 里恒释放该读票的 fd
 * (读票 commit 值本就被 bridge.finish 忽略,只做「释放」语义)。
 */
export async function runUpload(deps: {
  rpc: TransferRpc;
  bridge: TransferBridge;
  destDir: string;
  file: { ticket: string; name: string; size: number };
  onProgress: (done: number) => void;
  isCanceled: () => boolean;
}): Promise<UploadResult> {
  const { rpc, bridge, destDir, file, onProgress, isCanceled } = deps;

  let transferId: string;
  try {
    const begun = await rpc('fs.uploadBegin', { destDir, name: file.name, size: file.size });
    transferId = begun.transferId;
  } catch (err) {
    await bridge.finish({ ticket: file.ticket, commit: false }).catch(() => undefined);
    return { ok: false, reason: classifyRpcError(err), detail: errMessage(err) };
  }

  let committed = false;
  try {
    let offset = 0;
    let baseline: { size: number; mtimeMs: number } | null = null;

    while (true) {
      let block: Awaited<ReturnType<TransferBridge['read']>>;
      try {
        block = await bridge.read({ ticket: file.ticket, offset, length: TRANSFER.chunkBytes });
      } catch (err) {
        return { ok: false, reason: 'local-io', detail: errMessage(err) };
      }

      if (baseline === null) {
        baseline = { size: block.size, mtimeMs: block.mtimeMs };
      } else if (fileChanged(baseline, block)) {
        return { ok: false, reason: 'file-changed' };
      }

      if (block.bytes > 0) {
        let result: RpcMethods['fs.uploadChunk']['result'];
        try {
          result = await rpc('fs.uploadChunk', { transferId, offset, base64: block.base64 });
        } catch (err) {
          return { ok: false, reason: classifyRpcError(err), detail: errMessage(err) };
        }
        // host 强制顺序到达:received 须等于「进入本块前的 offset + 本块字节数」,
        // 否则乱序/丢块——立即停(不猜测重试,重试属更高层策略)。
        if (result.received !== offset + block.bytes) {
          return { ok: false, reason: 'offset-mismatch' };
        }
        offset = result.received;
        onProgress(offset);
      }

      if (isCanceled()) return { ok: false, reason: 'canceled' };
      if (block.eof) break;
    }

    const ended = await rpc('fs.uploadEnd', { transferId, commit: true });
    committed = true;
    if (!ended.path) {
      return { ok: false, reason: 'remote-io', detail: 'upload commit returned no path' };
    }
    return { ok: true, remotePath: ended.path };
  } finally {
    // 失败/取消路径:best-effort 收尾远端半成品传输(未提交则放弃 + 清理 .part)。
    if (!committed) {
      await rpc('fs.uploadEnd', { transferId, commit: false }).catch(() => undefined);
    }
    // 读票释放与远端提交状态无关,任何路径(含成功)都要放,否则 fd 泄漏。
    await bridge.finish({ ticket: file.ticket, commit: false }).catch(() => undefined);
  }
}
