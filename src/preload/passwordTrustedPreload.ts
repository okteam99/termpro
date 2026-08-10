import { contextBridge, ipcRenderer } from 'electron';
import {
  PASSWORD_TRUSTED_CHANNELS,
  type TrustedPasswordAction,
  type TrustedPasswordActionGrant,
  type TrustedPasswordContext,
  type TrustedPasswordCopyResult,
  type TrustedPasswordRevealResult,
} from '../shared/passwordVault';

interface ArmedAction {
  action: TrustedPasswordAction;
  grant: Promise<TrustedPasswordActionGrant>;
}

let armedAction: ArmedAction | null = null;
let actionGeneration = 0;

// 明文动作必须来自这个隔离窗口中对应按钮的一次真实点击。renderer 无法伪造
// Event.isTrusted。capture 阶段向主进程申请一个 sender/action 绑定、短时且一次性的
// proof；renderer 只能在这次 click 分发完成前消费这个 Promise，proof 本身从不暴露。
// Electron 会在 isolated world 与 main world 的监听器之间执行 microtask checkpoint，
// 所以必须用下一次 macrotask 清理，不能用 queueMicrotask 提前撤销真实 React onClick。
document.addEventListener(
  'click',
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const action = target
      ?.closest<HTMLButtonElement>('button[data-password-action]')
      ?.dataset.passwordAction;
    if (!event.isTrusted || (action !== 'reveal' && action !== 'copy')) {
      armedAction = null;
      return;
    }
    const generation = ++actionGeneration;
    armedAction = {
      action,
      grant: ipcRenderer.invoke(PASSWORD_TRUSTED_CHANNELS.actionGrant, { action }),
    };
    setTimeout(() => {
      if (actionGeneration === generation) armedAction = null;
    }, 0);
  },
  true,
);

function consumeAction(action: TrustedPasswordAction): Promise<TrustedPasswordActionGrant> | null {
  if (armedAction?.action !== action) return null;
  const grant = armedAction.grant;
  armedAction = null;
  actionGeneration += 1;
  return grant;
}

contextBridge.exposeInMainWorld('passwordTrusted', {
  context(): Promise<TrustedPasswordContext> {
    return ipcRenderer.invoke(PASSWORD_TRUSTED_CHANNELS.context);
  },
  async reveal(): Promise<TrustedPasswordRevealResult> {
    const pendingGrant = consumeAction('reveal');
    if (!pendingGrant) return { ok: false, code: 'VAULT_FORBIDDEN' };
    const grant = await pendingGrant;
    if (!grant.ok || typeof grant.proof !== 'string') {
      return { ok: false, code: 'VAULT_FORBIDDEN' };
    }
    return ipcRenderer.invoke(PASSWORD_TRUSTED_CHANNELS.reveal, { proof: grant.proof });
  },
  async copy(): Promise<TrustedPasswordCopyResult> {
    const pendingGrant = consumeAction('copy');
    if (!pendingGrant) return { ok: false, code: 'VAULT_FORBIDDEN' };
    const grant = await pendingGrant;
    if (!grant.ok || typeof grant.proof !== 'string') {
      return { ok: false, code: 'VAULT_FORBIDDEN' };
    }
    return ipcRenderer.invoke(PASSWORD_TRUSTED_CHANNELS.copy, { proof: grant.proof });
  },
});
