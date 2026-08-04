// 远程文件传输 阶段3:模块级单例队列(仿 terminalRegistry.ts 的模块级单例先例),
// 不进 zustand——传输态高频更新(每块进度)+ 与「哪个 tab/哪次挂载」无关,进 store 只会
// 引来不必要的全局重渲染。UI 消费方(FilePanel)经 subscribe()(粗粒度:任意条目变化都通知)
// + useSyncExternalStore 接入。list(workspaceId) 是纯读(revision 缓存,详见工厂函数内注释
// ——早期「终态项在下次 list() 观测后即清」的读驱动设计撞过 useSyncExternalStore 的纯度
// 契约,引发过真实的无限重渲染,这里改用 TTL 定时器摘除终态项,教训留在注释里别再犯)。
//
// 队列语义:全局 FIFO,并发 1(同一时刻至多一个 runDownload/runUpload 在跑)——TRANSFER 常量
// 头注解释过分块大小的取舍,并发口径这里再收紧一层:传输走的是与 PTY/其它 RPC 共享的同一条
// 链路(embedded MessagePort 或 standalone WS/SSH 隧道),并发多路传输会互相抢带宽、抢隧道
// 头阻塞,不如老实串行——用户能接受「一个个来」,接受不了「全部卡顿」。
//
// 多文件上传(upload() 内部 beginOpen 多选)在同一批里生成多个 TransferItem(index/count
// 标记批次位置),天然靠同一条串行队列顺序处理——不需要额外的「批次」实体。

import type { HostClient } from './hostClient';
import {
  runDownload,
  runUpload,
  type TransferBridge,
  type TransferFailure,
  type TransferRpc,
} from './transferCore';
import { TRANSFER } from '../../shared/protocol';
import { basename } from '../state/pathLabel';

export type TransferState = 'queued' | 'running' | 'canceling' | 'done' | 'failed' | 'canceled';

export interface TransferItem {
  id: string;
  direction: 'download' | 'upload';
  workspaceId: string;
  hostId: string;
  name: string;
  /** download:远端源文件路径;upload:本次落地的目标目录(destDir)——isBusy() 据此按行路径匹配。 */
  remotePath: string;
  total: number;
  transferred: number;
  /** 批量上传(同次 upload() 选中多文件)内的位置,1-based;单文件/下载省略。 */
  index?: number;
  /** 批量上传的文件总数;单文件/下载省略。 */
  count?: number;
  state: TransferState;
  /** 终态为 failed/canceled 时的分类原因(TransferFailure 字面量,供 UI 映射文案)。 */
  error?: string;
  /**
   * 🔴 设计偏离(spec 未列此字段,评审可核):终态 done 时的产物路径——download=本机保存
   * 路径、upload=远端落地路径。「Saved to {path}」提示需要它,没有等价替代来源。
   */
  resultPath?: string;
}

export interface TransferManager {
  download(a: {
    client: HostClient;
    workspaceId: string;
    hostId: string;
    path: string;
    name: string;
    size: number;
  }): Promise<void>;
  /** 内部 beginOpen 弹多选对话框;选中的文件在同一条串行队列里逐个跑,共享 index/count。 */
  upload(a: { client: HostClient; workspaceId: string; hostId: string; destDir: string }): Promise<void>;
  cancel(id: string): void;
  isBusy(hostId: string, remotePath: string, direction: 'download' | 'upload'): boolean;
  /**
   * 该 workspace 的非终态条目 + 最近一条终态条目。纯读、同一 revision 内引用稳定
   * (useSyncExternalStore 契约);终态条目在落定后约 4s(TERMINAL_ITEM_TTL_MS)自动摘除,
   * 不依赖「被 list() 读过几次」。
   */
  list(workspaceId: string): TransferItem[];
  subscribe(cb: () => void): () => void;
  /**
   * 🔴 设计偏离(spec 给了 list()/subscribe() 两个信号,§3 末尾"简单为先,你定"授权此处
   * 自行选型):终态提示(showHint)选此回调而非「FilePanel 自行 diff list() 前后快照」——
   * 后者在多文件批量上传时会把每个文件的完成都误判成"新终态"抖出一条提示,这里由
   * manager 在条目真正落定终态的那一刻精确触发一次,FilePanel 零猜测。
   */
  onFinal(cb: (item: TransferItem) => void): () => void;
}

const TERMINAL_STATES: ReadonlySet<TransferState> = new Set(['done', 'failed', 'canceled']);
function isTerminal(state: TransferState): boolean {
  return TERMINAL_STATES.has(state);
}

interface Job {
  run(
    onProgress: (done: number) => void,
    isCanceled: () => boolean,
  ): Promise<
    | { ok: true; localPath?: string; remotePath?: string }
    | { ok: false; reason: TransferFailure; detail?: string }
  >;
  /**
   * 排队中(从未 run() 过)被取消/丢弃时的清理钩子。目前仅 upload job 用它:
   * beginOpen 在入队前就已开好本机读票,job 若从没跑起来(cancel 排队项 /
   * processQueue 的防御性丢弃分支),没人会走到 runUpload 的 finally 去释放
   * 那张票——不 dispose 就是让读票挂到 30min idleTtl 才被 sweepIdle 回收,
   * 8 张配额会被"排队又取消"的上传逐步锁死。
   */
  dispose?(): Promise<unknown> | void;
}

// 惰性访问 window.okwork.transfer(模块求值时机早于 preload 挂载完成的窗口不可假设已就绪;
// 每个方法体内才读,不在此处缓存引用)。
const defaultBridge: TransferBridge = {
  beginSave: (p) => window.okwork.transfer.beginSave(p),
  beginOpen: () => window.okwork.transfer.beginOpen(),
  write: (p) => window.okwork.transfer.write(p),
  read: (p) => window.okwork.transfer.read(p),
  finish: (p) => window.okwork.transfer.finish(p),
};

/**
 * 工厂函数(而非直接裸导出单例):允许单测构造隔离实例,注入 fake bridge/runDownload/
 * runUpload,不必污染真实模块级单例或 mock 掉整个 window.okwork。生产代码消费下方导出的
 * `transferManager` 单例(等价 `createTransferManager()`),行为与直接裸单例零差异。
 */
export function createTransferManager(overrides?: {
  bridge?: TransferBridge;
  runDownload?: typeof runDownload;
  runUpload?: typeof runUpload;
}): TransferManager {
  const bridge = overrides?.bridge ?? defaultBridge;
  const doRunDownload = overrides?.runDownload ?? runDownload;
  const doRunUpload = overrides?.runUpload ?? runUpload;

  const items = new Map<string, TransferItem>();
  const jobs = new Map<string, Job>();
  const queue: string[] = [];
  let runningId: string | null = null;
  let seq = 0;

  const listeners = new Set<() => void>();
  const finalListeners = new Set<(item: TransferItem) => void>();

  // 🔴 useSyncExternalStore 纯度红线(评审踩过的坑,原设计「终态项在下次 list() 观测后
  // 即清」在此处崩过——教训记下):getSnapshot(= list())在一次渲染里可能被 React 调用
  // 多次(渲染期一次、commit 后一致性核对至少再一次),必须每次都返回**同一份**结果,
  // 既不能有「调用本身改变下次返回值」的读副作用,也不能每次都造一个新数组(新引用会被
  // Object.is 判定为"变了",React 判定为撕裂 → 强制重渲染 → 下次又造新数组 → 无限循环,
  // 实测复现为「Maximum update depth exceeded」)。
  //
  // 修法:list() 改纯读——用 revision 计数器缓存每个 workspaceId 的上次计算结果,revision
  // 不变(= 上次 notify() 之后没有新变化)直接返回缓存的同一个数组引用;变了才重算。
  // 终态项的"不永久占着"改用 TTL 定时器(scheduleTerminalCleanup)在状态落定的那一刻起
  // 排一个延时摘除 + notify(),不再靠"被读了几次"这种读驱动的隐式协议。
  let revision = 0;
  const listCache = new Map<string, { revision: number; result: TransferItem[] }>();
  const TERMINAL_ITEM_TTL_MS = 4000;

  function newId(): string {
    seq += 1;
    return `xfer-${seq}`;
  }

  function notify(): void {
    revision += 1;
    for (const cb of listeners) cb();
  }

  function fireFinal(item: TransferItem): void {
    const snapshot = { ...item };
    for (const cb of finalListeners) cb(snapshot);
  }

  /** 条目落定终态(done/failed/canceled)后,给它一段可见窗口(TTL),到时摘除 + notify()。 */
  function scheduleTerminalCleanup(item: TransferItem): void {
    setTimeout(() => {
      if (items.get(item.id) === item) {
        items.delete(item.id);
        notify();
      }
    }, TERMINAL_ITEM_TTL_MS);
  }

  function bindRpc(client: HostClient): TransferRpc {
    return (method, params) => client.rpc(method, params);
  }

  /** 取出并摘除 id 对应的 job(若有),fire-and-forget 调用其 dispose()(错误吞掉——
   *  清理钩子失败不该阻塞队列推进/取消流程,bridge.finish 本身也已是 best-effort 语义)。 */
  function disposeJob(id: string): void {
    const job = jobs.get(id);
    jobs.delete(id);
    if (job?.dispose) {
      void Promise.resolve(job.dispose()).catch(() => undefined);
    }
  }

  function processQueue(): void {
    if (runningId !== null) return;
    const id = queue.shift();
    if (id === undefined) return;
    const item = items.get(id);
    if (!item) {
      // 防御性分支:item 已被摘除但 job 还挂着(理论不应发生)——job 若持有未释放
      // 的资源(如 upload 的读票),直接丢弃前必须走 dispose,否则票据永久泄漏。
      disposeJob(id);
      processQueue();
      return;
    }
    runningId = id;
    item.state = 'running';
    notify();
    void runItem(id).finally(() => {
      runningId = null;
      processQueue();
    });
  }

  async function runItem(id: string): Promise<void> {
    const item = items.get(id);
    const job = jobs.get(id);
    jobs.delete(id);
    if (!item || !job) return;

    const onProgress = (done: number): void => {
      if (items.get(id) !== item) return; // 防御:理论上运行期条目不会被摘除
      item.transferred = done;
      notify();
    };
    const isCanceled = (): boolean => items.get(id)?.state === 'canceling';

    let result: Awaited<ReturnType<Job['run']>>;
    try {
      result = await job.run(onProgress, isCanceled);
    } catch (err) {
      result = {
        ok: false,
        reason: 'remote-io',
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    if (!items.has(id)) return; // 防御:理论上不会在运行期被摘除
    if (result.ok) {
      item.state = 'done';
      item.transferred = item.total;
      item.resultPath = item.direction === 'download' ? result.localPath : result.remotePath;
    } else {
      item.state = result.reason === 'canceled' ? 'canceled' : 'failed';
      item.error = result.reason;
    }
    notify();
    fireFinal(item);
    scheduleTerminalCleanup(item);
  }

  function addRejectedItem(base: {
    id: string;
    direction: 'download' | 'upload';
    workspaceId: string;
    hostId: string;
    name: string;
    remotePath: string;
    total: number;
    index?: number;
    count?: number;
  }, reason: TransferFailure): void {
    const item: TransferItem = { ...base, transferred: 0, state: 'failed', error: reason };
    items.set(item.id, item);
    notify();
    fireFinal(item);
    scheduleTerminalCleanup(item);
  }

  async function download(a: {
    client: HostClient;
    workspaceId: string;
    hostId: string;
    path: string;
    name: string;
    size: number;
  }): Promise<void> {
    const { client, workspaceId, hostId, path, name, size } = a;
    const id = newId();

    // 前置校验(队列可能已积压,入队前贴近实际传输时刻再核一次;不信任调用方早先传入的
    // size——FilePanel 点击时已做过一次 fs.stat,这里是防御性复核,不是重复劳动的冗余)。
    let stat: { kind: 'file' | 'dir' | null; size?: number; mtimeMs?: number };
    try {
      stat = await client.rpc('fs.stat', { path });
    } catch {
      addRejectedItem(
        {
          id,
          direction: 'download',
          workspaceId,
          hostId,
          name,
          remotePath: path,
          total: size,
        },
        'remote-io',
      );
      return;
    }
    const finalSize = stat.size ?? size;
    if (stat.kind !== 'file' || finalSize > TRANSFER.maxFileBytes) {
      addRejectedItem(
        { id, direction: 'download', workspaceId, hostId, name, remotePath: path, total: finalSize },
        'too-large',
      );
      return;
    }

    const item: TransferItem = {
      id,
      direction: 'download',
      workspaceId,
      hostId,
      name,
      remotePath: path,
      total: finalSize,
      transferred: 0,
      state: 'queued',
    };
    items.set(id, item);
    jobs.set(id, {
      run: (onProgress, isCanceled) =>
        doRunDownload({
          rpc: bindRpc(client),
          bridge,
          path,
          name,
          size: finalSize,
          onProgress,
          isCanceled,
        }),
    });
    queue.push(id);
    notify();
    processQueue();
  }

  async function upload(a: {
    client: HostClient;
    workspaceId: string;
    hostId: string;
    destDir: string;
  }): Promise<void> {
    const { client, workspaceId, hostId, destDir } = a;
    let files: Awaited<ReturnType<TransferBridge['beginOpen']>>;
    try {
      files = await bridge.beginOpen();
    } catch (err) {
      // 打开对话框/开读票失败(含配额耗尽,main 侧已回滚已建票据)——静默吞掉会让用户
      // 以为点击没反应;记一条可见的 failed 终态,复用 addRejectedItem 走 onFinal/showHint。
      addRejectedItem(
        {
          id: newId(),
          direction: 'upload',
          workspaceId,
          hostId,
          name: basename(destDir),
          remotePath: destDir,
          total: 0,
        },
        'local-io',
      );
      return;
    }
    if (files.length === 0) return;
    const count = files.length;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const id = newId();
      const index = i + 1;

      if (f.size > TRANSFER.maxFileBytes) {
        // 超限跳过:不进运行队列,但仍记一条 failed 终态(批量上传里逐文件可见哪个被拒)。
        addRejectedItem(
          {
            id,
            direction: 'upload',
            workspaceId,
            hostId,
            name: f.name,
            remotePath: destDir,
            total: f.size,
            index,
            count,
          },
          'too-large',
        );
        void bridge.finish({ ticket: f.ticket, commit: false }).catch(() => undefined);
        continue;
      }

      const item: TransferItem = {
        id,
        direction: 'upload',
        workspaceId,
        hostId,
        name: f.name,
        remotePath: destDir,
        total: f.size,
        transferred: 0,
        index,
        count,
        state: 'queued',
      };
      items.set(id, item);
      jobs.set(id, {
        run: (onProgress, isCanceled) =>
          doRunUpload({
            rpc: bindRpc(client),
            bridge,
            destDir,
            file: { ticket: f.ticket, name: f.name, size: f.size },
            onProgress,
            isCanceled,
          }),
        // 排队中被取消/丢弃(从未 run())→ runUpload 的 finally 从没跑过,读票靠这里释放。
        dispose: () => bridge.finish({ ticket: f.ticket, commit: false }),
      });
      queue.push(id);
    }
    notify();
    processQueue();
  }

  function cancel(id: string): void {
    const item = items.get(id);
    if (!item) return;
    if (item.state === 'queued') {
      const idx = queue.indexOf(id);
      if (idx !== -1) queue.splice(idx, 1);
      disposeJob(id);
      item.state = 'canceled';
      item.error = 'canceled';
      notify();
      fireFinal(item);
      scheduleTerminalCleanup(item);
    } else if (item.state === 'running') {
      // 运行中不能就地掐断分块循环——isCanceled() 闭包在下一个块边界读到这个态即停,
      // runItem 落定后自然转 'canceled'(见 runItem 的 result.reason==='canceled' 分支)。
      item.state = 'canceling';
      notify();
    }
    // 其余态(canceling/终态)no-op:重复取消不应产生第二次通知或反直觉的状态跳变。
  }

  function isBusy(hostId: string, remotePath: string, direction: 'download' | 'upload'): boolean {
    for (const it of items.values()) {
      if (
        it.hostId === hostId &&
        it.remotePath === remotePath &&
        it.direction === direction &&
        !isTerminal(it.state)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * 纯读(useSyncExternalStore 契约,见上方 revision 缓存的注释):同一 revision 内多次
   * 调用恒返回同一个数组引用;终态项的生命周期由 scheduleTerminalCleanup 的 TTL 定时器
   * 管理,这里只负责"当前还在 items 里的,按 workspaceId 过滤 + 只留非终态 + 最近一条终态"。
   */
  function list(workspaceId: string): TransferItem[] {
    const cached = listCache.get(workspaceId);
    if (cached && cached.revision === revision) return cached.result;

    const all = [...items.values()].filter((it) => it.workspaceId === workspaceId);
    const active = all.filter((it) => !isTerminal(it.state));
    const terminal = all.filter((it) => isTerminal(it.state));
    const lastTerminal = terminal.length > 0 ? terminal[terminal.length - 1] : null;
    const result = lastTerminal ? [...active, lastTerminal] : active;

    listCache.set(workspaceId, { revision, result });
    return result;
  }

  function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }

  function onFinal(cb: (item: TransferItem) => void): () => void {
    finalListeners.add(cb);
    return () => {
      finalListeners.delete(cb);
    };
  }

  return { download, upload, cancel, isBusy, list, subscribe, onFinal };
}

export const transferManager: TransferManager = createTransferManager();
