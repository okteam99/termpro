// 远程机管理与 SSH 连接编排(BL-003)· 从设计预览工程移植的生产组件(ARCH-B6)。
// 移植源:docs/design/preview-project/src/main.jsx E 节(RemoteHostsModal/RemoteHostsPage · 第 1194 行起)。
// 与预览的关键差异:mock hostRuntime 定时器 → 真实 window.okwork.remoteHost.onEvent 事件驱动;
// mock manualHosts state → window.okwork.remoteHost.{list,save,delete} IPC 往返;
// stage 集合改用 shared/remoteHost.ts 单源(main 产 · renderer 派生,杜绝字面量漂移 · EXT-6)。
//
// 未新增路由(TECH §前端技术方案):本组件即弹层本体,由 SettingsEntry 的 Settings 菜单挂载/卸载,
// 交互模式对齐既有 AboutModal(backdrop + card + Esc 关闭 + 焦点归还)。

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import './RemoteHostsPage.css';
import {
  failReasonCopy,
  type AuthType,
  type FailReason,
  type RemoteEvent,
  type RemoteHostConfig,
  type RemoteHostConfigInput,
  type RemoteHostDependency,
  type RemoteStage,
} from '../../../shared/remoteHost';
import {
  compareAppVersions,
  ProtocolIncompatibleError,
} from '../../../shared/versionCompat';
import { hostRegistry } from '../../services/hostRegistry';
import { reconnectController } from '../../services/reconnectWiring';
import {
  useRemoteHostRuntimeStore,
  trackDisconnect,
  requestConnect,
  tryBeginHandshake,
  endHandshake,
} from '../../state/remoteHostStore';
import { t } from '../../../shared/i18n';

/**
 * 连接生命周期(AC-5)进行中各态的徽标文案;ready/failed/disconnected 另有专属徽标。
 * 调用期取词(模块级 t() 常量会被冻结在导入期语言,语言切换/持久化偏好均不生效)。
 * 🔴 镜像 `components/MachineGroup.tsx` 内同名函数的文案(见其注释);两处均由
 * shared/remoteHost.ts 的 RemoteStage 枚举驱动,英文原文须逐字一致,防措辞漂移。
 */
function connectStageLabel(stage: string): string {
  const labels: Record<string, string> = {
    connecting: t('Connecting…'),
    deploying: t('Deploying…'),
    starting: t('Starting host…'),
    claiming: t('Claiming…'),
    verifying: t('Verifying handshake…'),
  };
  return labels[stage] ?? t('Connecting…');
}

const ACTIVE_STAGES = new Set<RemoteStage>([
  'connecting',
  'deploying',
  'starting',
  'claiming',
  'verifying',
]);

function isActiveStage(stage: RemoteStage): boolean {
  return ACTIVE_STAGES.has(stage);
}

function hasProgressPanel(stage: RemoteStage): boolean {
  return (
    stage === 'deploying' ||
    stage === 'starting' ||
    stage === 'claiming' ||
    stage === 'verifying'
  );
}

/** dot 颜色修饰符(UI.md §状态徽标体系):idle/ready 为稳态,忙碌态为过渡态。 */
function hostDotModifier(
  runtime: RemoteEvent | undefined,
): 'connected' | 'disconnected' | 'active' | 'fail' {
  if (!runtime) return 'disconnected';
  if (runtime.stage === 'failed' || runtime.stage === 'disconnected')
    return 'fail';
  if (isActiveStage(runtime.stage)) return 'active';
  if (runtime.stage === 'ready') return 'connected';
  return 'disconnected';
}

/** 远端 host 上报的 app 版本(ready 徽标旁小字用);握手未完成/未上报 → undefined。
 *  forHostId 是只读路由(未命中不新建,不同于 getOrCreateRemote),纯读版本号安全。 */
function hostVersionOf(configId: string): string | undefined {
  return hostRegistry.forHostId(configId)?.info?.appVersion;
}

/** 远端 host 版本是否低于本机客户端版本(Update 按钮出现条件);不可比较 → 不判定为过旧。
 *  🔴 隐含不变量(评审 P2 钉死):此处 `undefined → false` 与 main 收养门闸的
 *  `isHostAppOutdated(undefined) → true` 口径【相反】,当前成立仅因「不上报 appVersion
 *  的 host 会在连接时被 reap 重部署,根本进不了 ready」——若未来放宽收养门闸或调整
 *  HOST_MIN_APP_VERSION 语义,这里必须同步复核,否则「host 过旧」引导会把用户带到
 *  一个没有升级按钮的页面。 */
function isHostOutdated(hostVersion: string | undefined): boolean {
  if (!hostVersion) return false;
  const cmp = compareAppVersions(hostVersion, window.okwork.version);
  return cmp !== null && cmp < 0;
}

/** 最近使用区的相对时间展示(AC-7);renderer 纯展示格式化,不影响持久化的 epoch ms 值。 */
function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return t('Just now');
  if (diff < hour)
    return t('{minutes} min ago', { minutes: Math.floor(diff / minute) });
  if (diff < day)
    return t('{hours} hr ago', { hours: Math.floor(diff / hour) });
  if (diff < 7 * day)
    return t('{days} d ago', { days: Math.floor(diff / day) });
  return new Date(ts).toLocaleDateString();
}

interface FormValues {
  alias: string;
  host: string;
  username: string;
  port: string;
  authType: AuthType;
  privateKeyPath: string;
  password: string;
  passphrase: string;
}

const EMPTY_FORM: FormValues = {
  alias: '',
  host: '',
  username: '',
  port: '22',
  authType: 'key',
  privateKeyPath: '',
  password: '',
  passphrase: '',
};

/** 编辑态密码回填占位(AC-3:永不回显明文,仅提示"钥匙串已有凭据") */
const SECRET_PLACEHOLDER = '••••••••';

type TestStatus = 'testing' | 'ok' | 'fail';

function omitKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  if (!(key in obj)) return obj;
  const next = { ...obj };
  delete next[key];
  return next;
}

export interface RemoteHostsPageProps {
  onClose(): void;
  onOpenBrowserProfiles?(): void;
}

/** 「远程机」管理弹层:最近使用快捷区(一键连接)+ 手动添加区(增/改/删/测试连接/连接生命周期)。 */
export function RemoteHostsPage({
  onClose,
  onOpenBrowserProfiles,
}: RemoteHostsPageProps) {
  const [configs, setConfigs] = useState<RemoteHostConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [testState, setTestState] = useState<Record<string, TestStatus>>({});
  const [testFailReason, setTestFailReason] = useState<
    Record<string, FailReason>
  >({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteDependencies, setDeleteDependencies] = useState<
    Record<string, RemoteHostDependency[]>
  >({});
  const [upgradeConfirmId, setUpgradeConfirmId] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null);
  const [formHostId, setFormHostId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM);
  /** save IPC 失败的表单内呈现(此前无 catch → 点 Save 静默无反应,0.3.59 实测踩雷) */
  const [formError, setFormError] = useState<string | null>(null);
  /** null=未知(查询在途);false → 常驻警示横幅(密码存不进也读不出,自救指引) */
  const [encryptionAvailable, setEncryptionAvailable] = useState<
    boolean | null
  >(null);

  const runtimeMap = useRemoteHostRuntimeStore((s) => s.runtime);
  const applyEvent = useRemoteHostRuntimeStore((s) => s.applyEvent);
  const clearRuntime = useRemoteHostRuntimeStore((s) => s.clear);
  const abandon = useRemoteHostRuntimeStore((s) => s.abandon);
  const resume = useRemoteHostRuntimeStore((s) => s.resume);
  const forget = useRemoteHostRuntimeStore((s) => s.forget);

  const refreshList = useCallback(async () => {
    const list = await window.okwork.remoteHost.list();
    setConfigs(list);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // 打开弹层即探测凭据加密可用性(钥匙串授权被拒 → 横幅明示自救,而非满屏误导性
  // 「认证失败」)。查询失败(老 main 无此通道等)按可用处理,不误伤正常路径。
  useEffect(() => {
    let cancelled = false;
    window.okwork.remoteHost
      .capabilities()
      .then((caps) => {
        if (!cancelled) setEncryptionAvailable(caps.encryptionAvailable);
      })
      .catch(() => {
        if (!cancelled) setEncryptionAvailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // main 前移探测已确认「我方 + 兼容」后才 emit verifying{tunnel};renderer 侧握手退化为
  // 版本二次确认(near-必成功)。resolve → ready(冒烟 fs.readdir · AC-6);
  // reject ProtocolIncompatibleError → failed·incompatible(罕见竞态兜底)。
  //
  // 🔴 A3 修复:握手必须由 verifying 事件本身直接驱动,不能靠一个采样 runtimeMap 的被动
  // useEffect。main 可能在同一同步栈里背靠背 emit verifying 紧跟 ready(例如认领快路径);
  // React 会把这两次 setState 批处理成一次渲染,被动 effect 只看得到"最终落地"的 ready,
  // 中间的 verifying 从未被观测到 → renderer 从不 connect({wsUrl})、从不冒烟、per-host
  // client 从未建立。改为在 onEvent 回调内逐条事件同步判定,不经渲染采样。
  // 🔴 E6 修复:用户在连接在途点「断开」时,handleDisconnect 立即本地清空 + drop 客户端,
  // 但 main 侧编排(部署/启动/握手)仍在跑,沿途 deploying/starting/verifying/ready 等残余
  // 事件仍会经 onEvent 抵达——若照单全收会把已清空的 runtime 瞬时"复活"到 ready(UI 抖动),
  // 且 verifying 事件还会对已 drop 的 client 重新触发握手。用共享的 isAbandoned(store 单源,
  // 跨订阅点共享·OKWORK-F260805033051)过滤:弃用期间整条事件一律吞掉。用户对该 configId
  // 重新点「连接」/「升级」时经 resume() 解除(见对应 handler)。

  // 事件驱动(AC-5):main 经 remoteHost:event 推送生命周期态。逐条事件到达时同步:
  // ① 写入极薄运行态切片(供渲染);② 若本条事件恰是 verifying{tunnel},立即触发握手——
  // 判定基于事件本身,不基于事后读到的 store 状态,故不受同栈后续事件覆盖影响(A3)。
  // beginHandshake 定义在 effect 内部:其依赖(applyEvent/refreshList)已在 deps 数组里,
  // 不存在闭包过期风险,也不需要额外的 exhaustive-deps 抑制。
  useEffect(() => {
    function beginHandshake(
      configId: string,
      tunnel: { localPort: number; token: string },
    ) {
      // 🔴 弃用闸②(OKWORK-F260805033051 · 与 Sidebar 同款):已放弃的机器绝不开新 ws。
      // 本页与 Sidebar 各有一份 beginHandshake(重复实现,尚未收敛),两处都要设闸。
      // 🔴 **先查弃用、后占去重槽**(REVIEW F2):反过来这条早退会漏掉刚占上的槽位。
      if (useRemoteHostRuntimeStore.getState().isAbandoned(configId)) return;
      // 去重槽已收进 remoteHostStore(模块级共享)—— 组件私有 ref 时 abandon/drop 够不着它,
      // 握手永不落定就会把槽位永久留下,新隧道的握手被自己挡在门外。
      if (!tryBeginHandshake(configId)) return;
      const { localPort, token } = tunnel;
      const wsUrl = `ws://127.0.0.1:${localPort}?token=${encodeURIComponent(token)}`;
      const client = hostRegistry.getOrCreateRemote(configId, wsUrl);
      // 🔴 E2(review-fix·硬门④ 另半边·同 Sidebar):verifying→握手改调 reconnect(单一 owner)而非
      // connect——重连时 main re-emit verifying{tunnel},走 connect() 会命中陈旧 connectPromise(hostClient
      // :227 早返)→ 新 ws 不开、假 ready 污染 UI(EXT-B-1)。reconnect() 复位 connectPromise 后开新 ws;
      // 初次连接 connectPromise=null 时复位是 no-op 等价 connect。
      client
        .reconnect({ wsUrl })
        .then(async (info) => {
          // 🔴 弃用闸③(与 Sidebar 同款):握手在途期间用户点了断开/取消。
          // store 的写入闸能挡住下面的 applyEvent,但挡不住**这条已经开出去的 ws**——
          // 不在这里 drop 就会留一条无人管理的活连接 + 心跳。
          if (useRemoteHostRuntimeStore.getState().isAbandoned(configId)) {
            // 🔴 REVIEW F3:对**捕获到的这个 client** 收尾 —— 按 id 查表有两种失灵:
            // 该 id 已被更早的 drop 删掉(no-op,该关的 ws 没人管),或表里已换新一代 client(误杀)。
            if (hostRegistry.forHostId(configId) === client)
              hostRegistry.drop(configId);
            else client.dispose();
            return;
          }
          try {
            await client.rpc('fs.readdir', { path: info.homedir });
          } catch {
            // 冒烟失败不阻断 ready —— 握手(host.info + 版本兼容)已是核心判据
          }
          applyEvent({ configId, stage: 'ready' });
          refreshList();
        })
        .catch((err: unknown) => {
          if (useRemoteHostRuntimeStore.getState().isAbandoned(configId)) {
            // 🔴 REVIEW F3:对**捕获到的这个 client** 收尾 —— 按 id 查表有两种失灵:
            // 该 id 已被更早的 drop 删掉(no-op,该关的 ws 没人管),或表里已换新一代 client(误杀)。
            if (hostRegistry.forHostId(configId) === client)
              hostRegistry.drop(configId);
            else client.dispose();
            return;
          }
          if (err instanceof ProtocolIncompatibleError) {
            applyEvent({
              configId,
              stage: 'failed',
              reason: 'incompatible',
              detail: err.message,
            });
          } else {
            applyEvent({
              configId,
              stage: 'failed',
              reason: 'internal',
              detail: err instanceof Error ? err.message : String(err),
            });
          }
        })
        .finally(() => {
          endHandshake(configId);
        });
    }

    const unsubscribe = window.okwork.remoteHost.onEvent((e) => {
      if (useRemoteHostRuntimeStore.getState().isAbandoned(e.configId)) {
        return; // E6:弃用闸——整条回调早退,不写 store 也不触发握手(TECH §两道闸)
      }
      applyEvent(e);
      if (e.stage === 'verifying' && e.tunnel) {
        beginHandshake(e.configId, e.tunnel);
      }
    });
    return unsubscribe;
  }, [applyEvent, refreshList]);

  // Esc 关闭(对齐既有 AboutModal 交互)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const recentHosts = useMemo(
    () =>
      configs
        .filter((c) => c.lastUsed)
        .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0)),
    [configs],
  );
  const showEmptyState = loaded && configs.length === 0 && !formMode;

  async function runTest(id: string) {
    setTestState((prev) => ({ ...prev, [id]: 'testing' }));
    const result = await window.okwork.remoteHost.test({ id });
    if (result.ok) {
      setTestState((prev) => ({ ...prev, [id]: 'ok' }));
    } else {
      setTestState((prev) => ({ ...prev, [id]: 'fail' }));
      setTestFailReason((prev) => ({ ...prev, [id]: result.reason }));
    }
  }

  /** 「连接」(AC-4/AC-5/AC-13):清掉过期测试徽标,发起 IPC connect,进度经 onEvent 呈现。 */
  function handleConnect(config: RemoteHostConfig) {
    setTestState((prev) => omitKey(prev, config.id));
    // 🔴 REVIEW F4:走与侧栏同一份排队原语。此前这里立即发 IPC,若某个入口刚点过断开
    // 且 main 仍在收尾(orchestrator.disconnect 最长等 5s),这条 connect 会被在途去重
    // 吞进那条正被拆掉的 promise —— AC-13 的「点了没反应」换个入口原样复现。
    // resume 由 requestConnect 在兑现点执行(与发 IPC 同步紧邻,见 F1)。
    requestConnect(config.id, () =>
      window.okwork.remoteHost.connect({ id: config.id }),
    );
  }

  /**
   * 「断开」(AC-5 · ready → idle,用户主动):本地立即回落 idle,IPC 通知 main 拆隧道。
   * E6:若此时 main 侧编排仍在途(部署/启动/握手中断开),标记该 configId 为"已弃"——
   * 沿途残余事件(deploying/starting/verifying/ready…)到达时被过滤,不会把已清空的
   * runtime 复活、也不会对已 drop 的 client 重新触发握手。
   * 🔴 用户意图 = 保持断开:重连编排若在途(退避计时器/在途尝试)必须一并终止,
   * 否则 reconnectController 会在退避后把连接重新拉起。
   */
  function handleDisconnect(id: string) {
    abandon(id);
    reconnectController.cancel(id);
    clearRuntime(id);
    hostRegistry.drop(id);
    // 🔴 REVIEW F4:本地拆除全部同步先行之后再发 IPC,并**登记进共享的断开在途表** ——
    // 不登记的话,侧栏那个入口看不见这次断开,紧接着点连接会直接发 IPC 撞上 main 的在途去重。
    // 换 disconnectAwait 只为拿到可等待的 promise;语义仍是即发即忘(不 await,TECH R4)。
    trackDisconnect(id, window.okwork.remoteHost.disconnectAwait({ id }));
  }

  /**
   * 「升级」确认后执行(过旧远端 host → 强制重部署当前版本 bundle):main 侧 forceRedeploy
   * 会先 reap 旧 host 进程,旧 client 随之作废——drop 掉(verifying 落地时 beginHandshake 会
   * getOrCreateRemote 重建);取消在途重连编排,防止与本次升级编排竞争重连;解除"已弃"标记
   * 保证升级沿途事件(deploying/starting/verifying…)不被 E6 过滤吞掉。
   * 🔴 不 clearRuntime:保留运行态让进度徽标接管呈现,不闪回"闲置"态。
   */
  function handleUpgrade(config: RemoteHostConfig) {
    setUpgradeConfirmId(null);
    resume(config.id);
    reconnectController.cancel(config.id);
    setTestState((prev) => omitKey(prev, config.id));
    hostRegistry.drop(config.id);
    // 🔴 REVIEW F2:drop 掉 client 后要等**新**隧道的握手,残留的去重槽会把它挡在门外
    // (abandon 会清槽,但升级路径走的是 resume,清不到)。显式释放。
    endHandshake(config.id);
    window.okwork.remoteHost.upgrade({ id: config.id });
  }

  function openAddForm() {
    setFormMode('add');
    setFormHostId(null);
    setFormValues(EMPTY_FORM);
    setFormError(null);
  }

  function openEditForm(config: RemoteHostConfig) {
    setFormMode('edit');
    setFormHostId(config.id);
    setFormError(null);
    setFormValues({
      alias: config.alias,
      host: config.host,
      username: config.username,
      port: String(config.port),
      authType: config.authType,
      privateKeyPath: config.privateKeyPath ?? '',
      password: config.hasPassword ? SECRET_PLACEHOLDER : '',
      passphrase: config.hasPassphrase ? SECRET_PLACEHOLDER : '',
    });
  }

  function cancelForm() {
    setFormMode(null);
    setFormHostId(null);
    setFormError(null);
  }

  /**
   * ipcRenderer.invoke 的 rejection 会被 Electron 包一层
   * "Error invoking remote method 'remoteHost:save': Error: <原文>"——
   * 表单内呈现只留 main 侧抛出的原文(已本地化,如 A9 的加密不可用文案)。
   */
  function ipcErrorMessage(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    return raw.replace(
      /^Error invoking remote method '[^']+':\s*(Error:\s*)?/,
      '',
    );
  }

  async function saveForm() {
    const port = parseInt(formValues.port, 10) || 22;
    const config: RemoteHostConfigInput = {
      id: formHostId ?? undefined,
      alias: formValues.alias.trim() || t('Untitled'),
      host: formValues.host.trim(),
      port,
      username: formValues.username.trim(),
      authType: formValues.authType,
      privateKeyPath:
        formValues.authType === 'key'
          ? formValues.privateKeyPath.trim() || undefined
          : undefined,
    };
    const payload: {
      config: RemoteHostConfigInput;
      password?: string;
      passphrase?: string;
    } = { config };
    // 未改动的占位密文不重发(AC-3:renderer 永不持有真实密文,只能靠"是否等于占位符"判断有无改动)
    if (
      formValues.authType === 'password' &&
      formValues.password &&
      formValues.password !== SECRET_PLACEHOLDER
    ) {
      payload.password = formValues.password;
    }
    if (
      formValues.authType === 'key' &&
      formValues.passphrase &&
      formValues.passphrase !== SECRET_PLACEHOLDER
    ) {
      payload.passphrase = formValues.passphrase;
    }
    // 🔴 0.3.59 实测:save 可能 reject(典型:钥匙串授权被拒 → A9 前置校验抛
    // 「加密不可用」)。此前无 catch → 表单不关、无提示,「点 Save 没反应」。
    // 失败必须留在表单内呈现原因;成功才关表单。
    try {
      await window.okwork.remoteHost.save(payload);
    } catch (err) {
      setFormError(ipcErrorMessage(err));
      return;
    }
    await refreshList();
    setFormMode(null);
    setFormHostId(null);
    setFormError(null);
  }

  function requestDelete(id: string) {
    setDeleteDependencies((previous) => omitKey(previous, id));
    setDeleteConfirmId(id);
  }

  function cancelDelete() {
    if (deleteConfirmId) {
      setDeleteDependencies((previous) => omitKey(previous, deleteConfirmId));
    }
    setDeleteConfirmId(null);
  }

  /** AC-14:删机随删清凭据(main 侧执行);renderer 同步清运行态/测试态,防孤儿展示态。 */
  async function confirmDelete(id: string) {
    const result = await window.okwork.remoteHost.delete({ id });
    if (result?.status === 'blocked') {
      setDeleteDependencies((previous) => ({
        ...previous,
        [id]: result.dependencies,
      }));
      return;
    }
    // 评审 P2-4:终止在途重连编排(controller 模块级容器不归 forget 管)——不撤则悬挂
    // 退避到点仍会对已删配置发起重连。
    reconnectController.cancel(id);
    // REVIEW F6:forget 已销毁全部痕迹(五张表 + 握手槽 + 排队意图),此前紧邻的 clear 成为冗余。
    forget(id);
    hostRegistry.drop(id);
    setTestState((prev) => omitKey(prev, id));
    setTestFailReason((prev) => omitKey(prev, id));
    setDeleteConfirmId(null);
    await refreshList();
  }

  function dependencyLabel(type: RemoteHostDependency['type']): string {
    const labels: Record<RemoteHostDependency['type'], string> = {
      current_storage: t('Current storage location'),
      migration_source: t('Migration source'),
      migration_target: t('Migration target'),
      delete_cleanup: t('Profile deletion cleanup'),
      source_cleanup: t('Previous location cleanup'),
    };
    return labels[type];
  }

  function renderStageBadge(config: RemoteHostConfig, runtime: RemoteEvent) {
    if (runtime.stage === 'failed') {
      const reason = failReasonCopy(runtime.reason);
      return (
        <span className="remote-hosts__badge remote-hosts__badge--fail">
          ✗ {reason.label}
        </span>
      );
    }
    if (runtime.stage === 'disconnected') {
      return (
        <span className="remote-hosts__badge remote-hosts__badge--lost">
          {t('⚠ Connection lost')}
        </span>
      );
    }
    if (runtime.stage === 'ready') {
      const hostVersion = hostVersionOf(config.id);
      const outdated = isHostOutdated(hostVersion);
      return (
        <>
          <span className="remote-hosts__badge remote-hosts__badge--ok">
            {t('✓ Connected')}
          </span>
          {hostVersion && (
            <span
              className={`remote-hosts__host-version${outdated ? ' remote-hosts__host-version--outdated' : ''}`}
            >
              v{hostVersion}
            </span>
          )}
        </>
      );
    }
    const label = connectStageLabel(runtime.stage);
    const pct =
      runtime.stage === 'deploying' && typeof runtime.percent === 'number'
        ? ` ${runtime.percent}%`
        : '';
    return (
      <span className="remote-hosts__badge remote-hosts__badge--active">
        <span className="add-ws__spinner add-ws__spinner--sm" />
        {label}
        {pct}
      </span>
    );
  }

  function renderActionButtons(
    config: RemoteHostConfig,
    stage: RemoteStage,
    compact: boolean,
  ) {
    const buttons: ReactNode[] = [];
    if (stage === 'ready') {
      // !compact 门(评审 P2):确认行只在「手动添加」区渲染,「最近使用」紧凑区若也给
      // 按钮,点击后确认行出现在视口外的另一区——当场表现为「点了没反应」。与
      // Edit/Delete/Test 同族只在完整区提供。
      if (!compact && isHostOutdated(hostVersionOf(config.id))) {
        buttons.push(
          <button
            key="update"
            className="remote-hosts__action remote-hosts__action--primary"
            onClick={() => setUpgradeConfirmId(config.id)}
          >
            {t('Update host')}
          </button>,
        );
      }
      buttons.push(
        <button
          key="disc"
          className="remote-hosts__action"
          onClick={() => handleDisconnect(config.id)}
        >
          {t('Disconnect')}
        </button>,
      );
    } else if (stage === 'failed') {
      buttons.push(
        <button
          key="retry"
          className="remote-hosts__action remote-hosts__action--primary"
          onClick={() => handleConnect(config)}
        >
          {t('Retry')}
        </button>,
      );
    } else if (stage === 'disconnected') {
      buttons.push(
        <button
          key="reconn"
          className="remote-hosts__action remote-hosts__action--primary"
          onClick={() => handleConnect(config)}
        >
          {t('Reconnect')}
        </button>,
      );
    } else if (isActiveStage(stage)) {
      // 连接在途(connecting/deploying/…):给 Cancel 终止本次尝试(handleDisconnect 会
      // cancel 重连编排 + disconnect + drop 客户端,不会退避后又自己拉起)
      buttons.push(
        <button
          key="cancel"
          className="remote-hosts__action"
          onClick={() => handleDisconnect(config.id)}
        >
          {t('Cancel')}
        </button>,
      );
    } else {
      buttons.push(
        <button
          key="conn"
          className="remote-hosts__action remote-hosts__action--primary"
          onClick={() => handleConnect(config)}
        >
          {t('Connect')}
        </button>,
      );
    }
    // 连接在途只给 Cancel;编辑/删除/测试等会干扰编排的动作不在 active 阶段显示
    if (!compact && !isActiveStage(stage)) {
      if (stage === 'idle' || stage === 'ready') {
        buttons.push(
          <button
            key="test"
            className="remote-hosts__action"
            onClick={() => runTest(config.id)}
          >
            {t('Test connection')}
          </button>,
        );
      }
      buttons.push(
        <button
          key="edit"
          className="remote-hosts__action"
          onClick={() => openEditForm(config)}
        >
          {t('Edit')}
        </button>,
      );
      buttons.push(
        <button
          key="del"
          className="remote-hosts__action remote-hosts__action--danger"
          onClick={() => requestDelete(config.id)}
        >
          {t('Delete')}
        </button>,
      );
    }
    return buttons;
  }

  /** 行内状态/动作区:连接生命周期(非闲置)优先于测试态;两者共用 failReasonCopy 口径(AC-2)。 */
  function renderStatusArea(
    config: RemoteHostConfig,
    runtime: RemoteEvent | undefined,
    compact: boolean,
  ) {
    if (runtime && runtime.stage !== 'idle') {
      // 连接在途(active)也渲染动作区:此前只显 badge → 连接卡住时无从取消。现随
      // badge 一并给 Cancel(renderActionButtons 的 active 分支)。
      return (
        <span className="remote-hosts__row-actions">
          {renderStageBadge(config, runtime)}
          {renderActionButtons(config, runtime.stage, compact)}
        </span>
      );
    }
    if (!compact) {
      const status = testState[config.id];
      if (status === 'testing') {
        return (
          <span className="remote-hosts__badge remote-hosts__badge--pending">
            <span className="add-ws__spinner add-ws__spinner--sm" />
            {t('Testing connection…')}
          </span>
        );
      }
      if (status === 'ok') {
        return (
          <span className="remote-hosts__badge remote-hosts__badge--ok">
            {t('✓ Reachable')}
          </span>
        );
      }
      if (status === 'fail') {
        const reason = failReasonCopy(testFailReason[config.id], 'auth');
        return (
          <span className="remote-hosts__badge remote-hosts__badge--fail">
            ✗ {reason.label}
            {reason.detail ? ` · ${reason.detail}` : ''}
          </span>
        );
      }
    }
    return (
      <span className="remote-hosts__row-actions">
        {renderActionButtons(config, 'idle', compact)}
      </span>
    );
  }

  /** 部署进度(AC-4):快路径(fastPath)呈现"认领驻留进程"单行提示;否则三段 stepper。 */
  function renderProgressPanel(runtime: RemoteEvent) {
    if (runtime.fastPath) {
      const verifying = runtime.stage === 'verifying';
      return (
        <div className="remote-hosts__progress-claim">
          <span className="add-ws__spinner add-ws__spinner--sm" />
          {verifying
            ? t('Claimed a running host process · Verifying handshake…')
            : t('Found a running host process · Claiming…')}
        </div>
      );
    }
    const steps = [
      { key: 'upload', label: t('Upload bundle') },
      { key: 'start', label: t('Start host') },
      { key: 'verify', label: t('Verify handshake') },
    ];
    const order: RemoteStage[] = ['deploying', 'starting', 'verifying'];
    const idx = order.indexOf(runtime.stage);
    return (
      <>
        {runtime.arch && (
          <div className="remote-hosts__progress-arch">
            {t('Detected remote arch · {arch}', { arch: runtime.arch })}
          </div>
        )}
        <div className="remote-hosts__progress">
          {steps.map((s, i) => {
            const state = i < idx ? 'done' : i === idx ? 'active' : 'pending';
            return (
              <Fragment key={s.key}>
                {i > 0 && <span className="remote-hosts__progress-connector" />}
                <span
                  className={`remote-hosts__progress-step remote-hosts__progress-step--${state}`}
                >
                  {state === 'done' && (
                    <span className="remote-hosts__progress-check">✓</span>
                  )}
                  {state === 'active' && (
                    <span className="add-ws__spinner add-ws__spinner--sm" />
                  )}
                  {state === 'pending' && (
                    <span className="remote-hosts__progress-dot-pending" />
                  )}
                  {s.label}
                  {state === 'active' &&
                    s.key === 'upload' &&
                    typeof runtime.percent === 'number' && (
                      <span className="remote-hosts__progress-percent">
                        {' '}
                        {runtime.percent}%
                      </span>
                    )}
                </span>
              </Fragment>
            );
          })}
        </div>
      </>
    );
  }

  function renderFailDetail(runtime: RemoteEvent) {
    const reason = failReasonCopy(runtime.reason);
    return (
      <div className="remote-hosts__fail-detail">
        <span className="remote-hosts__fail-detail-code">
          {runtime.detail ?? reason.detail}
        </span>
        {reason.guidance && <span>{reason.guidance}</span>}
      </div>
    );
  }

  function renderRow(config: RemoteHostConfig, compact: boolean) {
    const runtime = runtimeMap[config.id];
    // runtime ready 前置(评审 P2):确认行打开后机器可能断线/进入其它态——此时「在跑
    // 会话将被终止」的承诺已不成立,不能再放行升级;回落普通行(残留的 confirmId 无害,
    // 用户重新点 Update 时会重置)。
    if (
      !compact &&
      upgradeConfirmId === config.id &&
      runtime?.stage === 'ready'
    ) {
      return (
        <div key={config.id} className="remote-hosts__entry">
          <div className="remote-hosts__row">
            <span className="remote-hosts__confirm">
              <span className="remote-hosts__confirm-text">
                {t(
                  'Upgrade host on {alias} to v{version}? All running sessions on that machine (including background agents and sessions from other devices) will be terminated',
                  { alias: config.alias, version: window.okwork.version },
                )}
              </span>
              <button
                className="remote-hosts__action remote-hosts__action--primary"
                onClick={() => handleUpgrade(config)}
              >
                {t('Yes')}
              </button>
              <button
                className="remote-hosts__action"
                onClick={() => setUpgradeConfirmId(null)}
              >
                {t('No')}
              </button>
            </span>
          </div>
        </div>
      );
    }
    if (!compact && deleteConfirmId === config.id) {
      const dependencies = deleteDependencies[config.id] ?? [];
      const activeConn = !!runtime && runtime.stage !== 'idle';
      return (
        <div key={config.id} className="remote-hosts__entry">
          {dependencies.length > 0 ? (
            <div className="remote-hosts__dependency-block" role="alert">
              <strong>
                {t('{alias} is still used by Browser Profiles', {
                  alias: config.alias,
                })}
              </strong>
              <span>
                {t(
                  'Move or finish cleanup for these Profiles before deleting the Remote Host.',
                )}
              </span>
              <ul>
                {dependencies.map((dependency) => (
                  <li key={`${dependency.profileId}:${dependency.type}`}>
                    <b>{dependency.profileName}</b>
                    <span>{dependencyLabel(dependency.type)}</span>
                  </li>
                ))}
              </ul>
              <div className="remote-hosts__confirm-actions">
                {onOpenBrowserProfiles && (
                  <button
                    className="remote-hosts__action remote-hosts__action--primary"
                    onClick={onOpenBrowserProfiles}
                  >
                    {t('Open Browser Profiles')}
                  </button>
                )}
                <button className="remote-hosts__action" onClick={cancelDelete}>
                  {t('Close')}
                </button>
              </div>
            </div>
          ) : (
            <div className="remote-hosts__row">
              <span className="remote-hosts__confirm">
                <span className="remote-hosts__confirm-text">
                  {t(
                    'Delete {alias}? Stored credentials will also be removed',
                    {
                      alias: config.alias,
                    },
                  )}
                  {activeConn
                    ? t(' · Current connection will be disconnected first')
                    : ''}
                </span>
                <button
                  className="remote-hosts__action remote-hosts__action--danger"
                  onClick={() => confirmDelete(config.id)}
                >
                  {t('Yes')}
                </button>
                <button className="remote-hosts__action" onClick={cancelDelete}>
                  {t('No')}
                </button>
              </span>
            </div>
          )}
        </div>
      );
    }
    return (
      <div key={config.id} className="remote-hosts__entry">
        <div className="remote-hosts__row">
          <span
            className={`remote-hosts__dot remote-hosts__dot--${hostDotModifier(runtime)}`}
          />
          <span className="remote-hosts__alias">{config.alias}</span>
          <span className="remote-hosts__addr">
            {config.username}@{config.host}:{config.port}
          </span>
          <span className="remote-hosts__identity">
            {config.privateKeyPath || '—'}
          </span>
          <span className="remote-hosts__auth">
            {config.authType === 'password' ? t('Password') : t('Key')}
          </span>
          {compact && config.lastUsed && (
            <span className="remote-hosts__last-used">
              {formatRelativeTime(config.lastUsed)}
            </span>
          )}
          {renderStatusArea(config, runtime, compact)}
        </div>
        {!compact &&
          runtime &&
          hasProgressPanel(runtime.stage) &&
          renderProgressPanel(runtime)}
        {!compact &&
          runtime &&
          runtime.stage === 'failed' &&
          renderFailDetail(runtime)}
      </div>
    );
  }

  return (
    <div
      className="remote-hosts__backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="remote-hosts__card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="remote-hosts__header">
          <div>
            <div className="remote-hosts__title">{t('Remote Hosts')}</div>
            <div className="remote-hosts__subtitle">
              {t(
                'SSH key or password login · Passwords/passphrases stored in system keychain',
              )}
            </div>
          </div>
          <button
            className="remote-hosts__close"
            onClick={onClose}
            title={t('Close')}
          >
            ×
          </button>
        </div>

        <div className="remote-hosts__body">
          {encryptionAvailable === false && (
            <div className="remote-hosts__crypto-banner" role="alert">
              <div className="remote-hosts__crypto-banner-title">
                {t(
                  'Credential encryption unavailable — keychain access was denied',
                )}
              </div>
              <div>
                {t(
                  'Passwords cannot be saved or read in this session, so connections will fail as "Authentication failed". Quit and reopen the app, then choose "Always Allow" when the system asks for keychain access.',
                )}
              </div>
            </div>
          )}
          {showEmptyState ? (
            <div className="remote-hosts__empty">
              <div className="remote-hosts__empty-text">
                {t('No remote hosts yet · Click below to add one')}
              </div>
              <button
                className="remote-hosts__btn remote-hosts__btn--primary"
                onClick={openAddForm}
              >
                {t('Add remote host')}
              </button>
            </div>
          ) : (
            <>
              {recentHosts.length > 0 && (
                <div className="remote-hosts__section">
                  <div className="remote-hosts__section-title">
                    {t('Recently used')}
                  </div>
                  <div className="remote-hosts__list">
                    {recentHosts.map((config) => renderRow(config, true))}
                  </div>
                </div>
              )}

              <div className="remote-hosts__section">
                <div className="remote-hosts__section-title">
                  {t('Manually added')}
                </div>
                <div className="remote-hosts__list">
                  {configs.map((config) => renderRow(config, false))}
                  {configs.length === 0 && (
                    <div className="remote-hosts__section-empty">
                      {t('No manually added remote hosts yet')}
                    </div>
                  )}
                </div>
              </div>

              {formMode ? (
                <div className="remote-hosts__form">
                  <div className="remote-hosts__form-title">
                    {formMode === 'edit'
                      ? t('Edit remote host')
                      : t('Add remote host')}
                  </div>
                  <div className="remote-hosts__form-grid">
                    <label className="remote-hosts__field">
                      <span>{t('Name')}</span>
                      <input
                        value={formValues.alias}
                        onChange={(e) =>
                          setFormValues({
                            ...formValues,
                            alias: e.target.value,
                          })
                        }
                        placeholder="alias"
                      />
                    </label>
                    <label className="remote-hosts__field">
                      <span>{t('Host')}</span>
                      <input
                        value={formValues.host}
                        onChange={(e) =>
                          setFormValues({ ...formValues, host: e.target.value })
                        }
                        placeholder="192.168.1.10"
                      />
                    </label>
                    <label className="remote-hosts__field">
                      <span>{t('User')}</span>
                      <input
                        value={formValues.username}
                        onChange={(e) =>
                          setFormValues({
                            ...formValues,
                            username: e.target.value,
                          })
                        }
                        placeholder="root"
                      />
                    </label>
                    <label className="remote-hosts__field">
                      <span>{t('Port')}</span>
                      <input
                        value={formValues.port}
                        onChange={(e) =>
                          setFormValues({ ...formValues, port: e.target.value })
                        }
                        placeholder="22"
                      />
                    </label>
                    <div className="remote-hosts__field remote-hosts__field--wide">
                      <span>{t('Auth method')}</span>
                      <div className="file-panel__seg remote-hosts__auth-seg">
                        <button
                          type="button"
                          className={`file-panel__seg-btn${formValues.authType === 'key' ? ' file-panel__seg-btn--active' : ''}`}
                          onClick={() =>
                            setFormValues({ ...formValues, authType: 'key' })
                          }
                        >
                          {t('SSH Key')}
                        </button>
                        <button
                          type="button"
                          className={`file-panel__seg-btn${formValues.authType === 'password' ? ' file-panel__seg-btn--active' : ''}`}
                          onClick={() =>
                            setFormValues({
                              ...formValues,
                              authType: 'password',
                            })
                          }
                        >
                          {t('Password')}
                        </button>
                      </div>
                    </div>
                    {formValues.authType === 'password' ? (
                      <label className="remote-hosts__field remote-hosts__field--wide">
                        <span>{t('Password')}</span>
                        <input
                          type="password"
                          value={formValues.password}
                          onChange={(e) =>
                            setFormValues({
                              ...formValues,
                              password: e.target.value,
                            })
                          }
                        />
                        <span className="remote-hosts__field-hint">
                          {t(
                            'Password is stored in the system keychain, never written to disk in plaintext',
                          )}
                        </span>
                      </label>
                    ) : (
                      <>
                        <label className="remote-hosts__field remote-hosts__field--wide">
                          <span>{t('Private key path')}</span>
                          <input
                            value={formValues.privateKeyPath}
                            onChange={(e) =>
                              setFormValues({
                                ...formValues,
                                privateKeyPath: e.target.value,
                              })
                            }
                            placeholder={t('e.g. ~/.ssh/id_ed25519')}
                          />
                        </label>
                        <label className="remote-hosts__field remote-hosts__field--wide">
                          <span>{t('Private key passphrase (optional)')}</span>
                          <input
                            type="password"
                            value={formValues.passphrase}
                            onChange={(e) =>
                              setFormValues({
                                ...formValues,
                                passphrase: e.target.value,
                              })
                            }
                          />
                          <span className="remote-hosts__field-hint">
                            {t(
                              'Passphrase for the encrypted private key · stored in the system keychain, never written to disk in plaintext',
                            )}
                          </span>
                        </label>
                      </>
                    )}
                  </div>
                  {formError && (
                    <div className="remote-hosts__form-error" role="alert">
                      ✗ {formError}
                    </div>
                  )}
                  <div className="remote-hosts__form-actions">
                    <button className="remote-hosts__btn" onClick={cancelForm}>
                      {t('Cancel')}
                    </button>
                    <button
                      className="remote-hosts__btn remote-hosts__btn--primary"
                      onClick={saveForm}
                    >
                      {t('Save')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="remote-hosts__btn remote-hosts__btn--primary remote-hosts__add-btn"
                  onClick={openAddForm}
                >
                  {t('Add remote host')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default RemoteHostsPage;
