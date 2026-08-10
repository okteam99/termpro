// remoteHost:* IPC 面(main handler)。加密敏感值只经 save 单向进 main,
// 永无 get-secret 通道(AC-3)——本文件注册的 handler 集合即 REMOTE_HOST_CHANNELS
// 全量,渲染层拿不到多出来的读凭据接口。

import { ipcMain } from 'electron';
import { REMOTE_HOST_CHANNELS } from '../../shared/remoteHost';
import { t } from '../../shared/i18n';
import type {
  RemoteHostConfigInput,
  RemoteHostDeleteResult,
} from '../../shared/remoteHost';
import type { RemoteHostOrchestrator } from './orchestrator';
import type { CredentialStore, HostConfigStore } from './credentialStore';
import type { RemoteHostDependencyQueryPort } from '../remoteProfileDependencies';

interface SavePayload {
  config: RemoteHostConfigInput;
  password?: string;
  passphrase?: string;
}

/**
 * 注册全部 remoteHost:* handler + event 推送;返回反注册函数(dispose/测试用)。
 *
 * @param getMainWindow 🔴 E8(安全)修复:`remoteHost:event` 里 `verifying` 阶段携带
 *   隧道 capability token——此前广播给 `BrowserWindow.getAllWindows()` 的**全部**
 *   窗口(文件查看器/git diff 窗口等与远程机管理毫无关系的窗口也会收到 token)。
 *   Settings/RemoteHostsPage 只存在于主窗口,故只需推给主窗口;调用方传入取「当前
 *   主窗口」的 getter(不能传入固定引用——注册时主窗口可能尚未创建,getter 保证
 *   每次事件触发时都取到最新值)。
 * @param isTunnelSenderAllowed 纵深防御(E8 同族):tunnel 查询的请求方归属校验——
 *   只有主窗口或「该 configId 自己的」查看器窗口该拿到 token,查看器窗口 A 不得
 *   拉取 host B 的 token。不匹配返回 null(与「未连接」不可区分,不泄露存在性)。
 *   缺省不校验 = 信任所有一方渲染进程(测试桩用;生产 main.ts 必须传)。
 */
export function registerRemoteHostIpc(
  orchestrator: RemoteHostOrchestrator,
  credentials: CredentialStore,
  configStore: HostConfigStore,
  getMainWindow: () => Electron.BrowserWindow | null | undefined,
  isTunnelSenderAllowed?: (
    sender: Electron.WebContents,
    configId: string,
  ) => boolean,
  /** 配置删除后的收尾钩子(main 用于浏览器出口回退等联动;缺省 no-op)。 */
  onConfigDeleted?: (configId: string) => void,
  /** 配置保存后的收尾钩子(main 用于浏览器远程分区黑洞预封;缺省 no-op)。 */
  onConfigSaved?: (configId: string) => void,
  /** BL-007：Profile catalog 依赖查询；main 注入，IPC 不认识 catalog 具体类。 */
  remoteProfileDependencies?: RemoteHostDependencyQueryPort,
): () => void {
  const unsubscribeEvents = orchestrator.onEvent((event) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(REMOTE_HOST_CHANNELS.event, event);
    }
  });

  ipcMain.handle(REMOTE_HOST_CHANNELS.list, () => configStore.list());

  // 凭据面能力查询:renderer 打开远程机管理时探测 safeStorage 是否真拿得到钥匙串
  // 密钥(启动时授权被拒 → false),据此挂常驻警示横幅(而非让 save 静默失败、
  // 连接报误导性的「认证失败」)。只回布尔,零敏感信息。
  ipcMain.handle(REMOTE_HOST_CHANNELS.capabilities, () => ({
    encryptionAvailable: credentials.isAvailable(),
  }));

  ipcMain.handle(REMOTE_HOST_CHANNELS.save, (_event, payload: SavePayload) => {
    const { config, password, passphrase } = payload;
    const hasPassword = typeof password === 'string' && password.length > 0;
    const hasPassphrase =
      typeof passphrase === 'string' && passphrase.length > 0;

    // 🔴 A9 修复:此前先落盘 config(hasPassword:true 等旗标)再 setSecret,若
    // safeStorage 不可用,setSecret 抛错但 config 已带着「密码已存」的误导性旗标
    // 落盘(实际从未写入密文)。改为落盘前置校验,凭据请求了加密但加密不可用时
    // 直接拒绝整个 save(不产生半成品配置)。
    if ((hasPassword || hasPassphrase) && !credentials.isAvailable()) {
      throw new Error(
        t(
          'Local credential encryption is unavailable — cannot store the password safely',
        ),
      );
    }

    const saved = configStore.save({
      ...config,
      hasPassword: hasPassword || undefined,
      hasPassphrase: hasPassphrase || undefined,
    });

    if (hasPassword)
      credentials.setSecret(`cred:${saved.id}:password`, password!);
    if (hasPassphrase)
      credentials.setSecret(`cred:${saved.id}:passphrase`, passphrase!);

    onConfigSaved?.(saved.id);
    return saved;
  });

  ipcMain.handle(
    REMOTE_HOST_CHANNELS.delete,
    async (_event, payload: { id: string }) => {
      // 删除门必须先于 disconnect/config/credential 的任何副作用。查询异常直接 reject，
      // fail-closed 保留 Host；绝不能因为依赖服务暂时不可读就当成「零依赖」。
      const dependencies = remoteProfileDependencies
        ? await remoteProfileDependencies.dependenciesForHost(payload.id)
        : [];
      if (dependencies.length > 0) {
        return {
          status: 'blocked',
          dependencies,
        } satisfies RemoteHostDeleteResult;
      }

      // AC-14:活跃连接先 best-effort 断开,再清配置+凭据(失败不阻断删除)
      await orchestrator.disconnect(payload.id).catch(() => undefined);
      configStore.delete(payload.id);
      credentials.deleteAllForConfig(payload.id);
      onConfigDeleted?.(payload.id);
      return { status: 'deleted' } satisfies RemoteHostDeleteResult;
    },
  );

  ipcMain.handle(
    REMOTE_HOST_CHANNELS.test,
    (_event, payload: { id: string }) => {
      return orchestrator.test(payload.id);
    },
  );

  // 🔴 编排 promise 必须接住(评审 P2):罕见竞态下 runConnect 可能以非法转移抛出收尾
  // (如 config 刚被删),`void` 裸放会成为 main 未处理拒绝(历史上曾触发弹窗事故,
  // 见 ssh.test.ts 回归用例)。吞掉但留日志。
  const swallow = (what: string) => (err: unknown) => {
    console.warn(`[remote] ${what} orchestration rejected:`, err);
  };

  ipcMain.on(
    REMOTE_HOST_CHANNELS.connect,
    (_event, payload: { id: string }) => {
      if (typeof payload?.id !== 'string') return;
      orchestrator.connect(payload.id).catch(swallow('connect'));
    },
  );

  ipcMain.on(
    REMOTE_HOST_CHANNELS.disconnect,
    (_event, payload: { id: string }) => {
      if (typeof payload?.id !== 'string') return;
      orchestrator.disconnect(payload.id).catch(swallow('disconnect'));
    },
  );

  // 可等待版本(需要排队/等待语义时用):不承载"已断开"语义(TECH R4)——
  // 真正的本地拆除在调用方 await 之前已同步完成。旧 `disconnect`(ipcMain.on)渲染层
  // 现已零调用点(评审 P2-3:设置页/Sidebar 与 reconnectController disconnect-first 均走
  // 本通道;2026-08-10 事故后者由即发即忘改来——与紧随的 connect 竞态 → 尝试蒸发/僵尸
  // 误杀),通道保留待用。
  ipcMain.handle(
    REMOTE_HOST_CHANNELS.disconnectAwait,
    (_event, payload: { id: string }) => {
      return orchestrator.disconnect(payload.id);
    },
  );

  // 用户显式升级服务端(Remote Hosts「Update」):forceRedeploy 连接——跳过 claim,
  // reap 旧 host 后重部署当前 app 版本 bundle。确认交互在 renderer 侧(弹窗明示
  // 在跑会话将被终止)。
  // 🔴 纵深防御(评审 P2):upgrade 是 remoteHost 通道里唯一会【终止用户远端在跑进程】
  // 的指令,而 preload 四窗共用——只信主窗口 sender(与 tunnel 通道的归属校验同族);
  // 裸 on 通道无 invoke 层校验,payload 门一并补上。
  ipcMain.on(REMOTE_HOST_CHANNELS.upgrade, (event, payload: { id: string }) => {
    if (typeof payload?.id !== 'string') return;
    const win = getMainWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    orchestrator
      .connect(payload.id, { forceRedeploy: true })
      .catch(swallow('upgrade'));
  });

  // 查看器窗口直连远程 host 的按需隧道查询(仅 ready 会话返回 localPort+token,
  // 其余 null)。与 E8 的口径互补:token 不随事件广播落无关窗口,由确要建连的
  // 窗口主动拉取;拿到 token 也只等价于「能连本机 127.0.0.1 转发端口」这一能力。
  ipcMain.handle(
    REMOTE_HOST_CHANNELS.tunnel,
    (event, payload: { id: string }) => {
      if (
        isTunnelSenderAllowed &&
        !isTunnelSenderAllowed(event.sender, payload.id)
      ) {
        return null;
      }
      return orchestrator.tunnelFor(payload.id);
    },
  );

  // 全部会话阶段快照(浏览器网络选择器列出可用出口)。零敏感信息(仅 configId→stage,
  // 与 list 同级),不做归属校验;选择器据此只列 ready 的机器可选。
  ipcMain.handle(REMOTE_HOST_CHANNELS.stages, () => orchestrator.stages());

  return () => {
    unsubscribeEvents();
    ipcMain.removeHandler(REMOTE_HOST_CHANNELS.list);
    ipcMain.removeHandler(REMOTE_HOST_CHANNELS.capabilities);
    ipcMain.removeHandler(REMOTE_HOST_CHANNELS.save);
    ipcMain.removeHandler(REMOTE_HOST_CHANNELS.delete);
    ipcMain.removeHandler(REMOTE_HOST_CHANNELS.test);
    ipcMain.removeHandler(REMOTE_HOST_CHANNELS.tunnel);
    ipcMain.removeHandler(REMOTE_HOST_CHANNELS.stages);
    ipcMain.removeHandler(REMOTE_HOST_CHANNELS.disconnectAwait);
    ipcMain.removeAllListeners(REMOTE_HOST_CHANNELS.connect);
    ipcMain.removeAllListeners(REMOTE_HOST_CHANNELS.disconnect);
    ipcMain.removeAllListeners(REMOTE_HOST_CHANNELS.upgrade);
  };
}
