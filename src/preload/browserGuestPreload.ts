import { ipcRenderer } from 'electron';
import {
  MAX_PASSWORD_LENGTH,
  MAX_PASSWORD_USERNAME_LENGTH,
  PASSWORD_GUEST_CHANNELS,
  type PasswordGuestLookupResult,
  type PasswordGuestStatus,
} from '../shared/passwordVault';

const LOGIN_SETTLE_TIMEOUT_MS = 8_000;
const FAILURE_SELECTOR = [
  '[aria-invalid="true"]',
  '[role="alert"]',
  '.error',
  '.error-message',
  '.login-error',
  '.alert-danger',
].join(',');

interface LoginFields {
  form: HTMLFormElement | null;
  username: HTMLInputElement | null;
  password: HTMLInputElement;
}

let lookupGeneration = 0;
let lookupTimer: ReturnType<typeof setTimeout> | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let settleObserver: MutationObserver | null = null;
/** 提交那一刻页面上已有的告警节点——它们不是这次登录的结果,不能算失败证据 */
let failureBaseline = new WeakSet<Element>();

function sendStatus(status: PasswordGuestStatus): void {
  try {
    ipcRenderer.sendToHost(PASSWORD_GUEST_CHANNELS.statusToHost, status);
  } catch {
    // 弹窗子浏览器窗(Google 登录一类)不是 webview,没有 embedder 可送——
    // 那里没有状态条 UI,填充/捕获照常走 invoke,状态丢弃即可,不能抛断流程。
  }
}

function editable(input: HTMLInputElement): boolean {
  return !input.disabled && !input.readOnly && input.getClientRects().length > 0;
}

function findLoginFields(): LoginFields | null {
  const passwords = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')];
  const password = passwords.find(
    (input) =>
      editable(input) &&
      input.autocomplete !== 'new-password' &&
      !/confirm|repeat|new/i.test(`${input.name} ${input.id}`),
  );
  if (!password) return null;
  const form = password.form;
  const scope: ParentNode = form ?? document;
  const candidates = [...
    scope.querySelectorAll<HTMLInputElement>(
      'input[autocomplete="username"], input[autocomplete="email"], input[type="email"], input[type="text"]',
    ),
  ].filter(editable);
  const username =
    candidates.find((input) => input.autocomplete === 'username') ??
    candidates.find((input) => input.type === 'email' || input.autocomplete === 'email') ??
    candidates.filter((input) => input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1) ??
    null;
  return { form, username, password };
}

function emitInput(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillCredential(
  credential: Extract<PasswordGuestLookupResult, { kind: 'credential' }>,
  explicit: boolean,
): boolean {
  const fields = findLoginFields();
  if (!fields) return false;
  if (!explicit && fields.password.value) return false;
  if (
    !explicit &&
    fields.username?.value.trim() &&
    fields.username.value.trim() !== credential.username
  ) {
    return false;
  }
  if (fields.username && (explicit || !fields.username.value)) {
    emitInput(fields.username, credential.username);
  }
  if (explicit || !fields.password.value) emitInput(fields.password, credential.password);
  sendStatus(
    credential.usernames && credential.usernames.length > 1
      ? {
          kind: 'multiple',
          usernames: credential.usernames,
          selectedUsername: credential.username,
        }
      : { kind: 'filled', selectedUsername: credential.username },
  );
  return true;
}

async function lookupAndFill(): Promise<void> {
  const fields = findLoginFields();
  if (!fields) return;
  const generation = ++lookupGeneration;
  try {
    const result = (await ipcRenderer.invoke(PASSWORD_GUEST_CHANNELS.lookup, {
      pageUsername: fields.username?.value.trim() || undefined,
    })) as PasswordGuestLookupResult;
    if (generation !== lookupGeneration) return;
    if (result.kind === 'credential') {
      fillCredential(result, false);
    } else if (result.kind === 'multiple') {
      sendStatus({
        kind: 'multiple',
        usernames: result.usernames,
        selectedUsername: result.selectedUsername,
      });
    } else if (result.kind === 'unavailable' || result.kind === 'insecure_origin') {
      sendStatus({ kind: result.kind });
    }
  } catch {
    sendStatus({ kind: 'unavailable' });
  }
}

function scheduleLookup(): void {
  if (lookupTimer) clearTimeout(lookupTimer);
  lookupTimer = setTimeout(() => {
    lookupTimer = null;
    void lookupAndFill();
  }, 120);
}

/**
 * 🔴 失败证据必须苛刻(用户报告 2026-08-16:GitLab 登录成功却弹「登录失败」)。
 * 登录成功后落地的业务页几乎都带 role="alert"/.error 容器(GitLab 的 flash 条、
 * 各家的公告条),旧实现全文档扫一眼有文字就判失败,把成功当失败播报。
 * 现在三道闸:① 登录表单还在(表单没了就是走掉了,不可能是失败)
 * ② 节点可见 ③ 不是提交前就存在的旧告警。
 */
function freshFailureSignal(): boolean {
  if (!findLoginFields()) return false;
  for (const node of document.querySelectorAll<HTMLElement>(FAILURE_SELECTOR)) {
    if (failureBaseline.has(node) || node.getClientRects().length === 0) continue;
    if (node.getAttribute('aria-invalid') === 'true') return true;
    if ((node.textContent?.trim().length ?? 0) > 0) return true;
  }
  return false;
}

function clearSettlement(): void {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
  settleObserver?.disconnect();
  settleObserver = null;
}

function reportResult(
  nonce: string,
  result: 'success' | 'failed' | 'uncertain',
  reason: 'form_disappeared' | 'authenticated_state' | 'message' | 'timeout' | 'navigation',
): void {
  clearSettlement();
  void ipcRenderer.invoke(PASSWORD_GUEST_CHANNELS.result, { nonce, result, reason });
}

function watchLoginResult(nonce: string, submittedForm: HTMLFormElement | null): void {
  clearSettlement();
  const inspect = () => {
    // 先判「走掉了」再判「报错了」:表单消失/登录态达成一律算成功,
    // 页面上残留或新冒出来的告警条不再有机会把成功盖成失败。
    if (submittedForm && !document.contains(submittedForm)) {
      reportResult(nonce, 'success', 'form_disappeared');
    } else if (!findLoginFields() && document.readyState === 'complete') {
      reportResult(nonce, 'success', 'authenticated_state');
    } else if (freshFailureSignal()) {
      reportResult(nonce, 'failed', 'message');
    }
  };
  settleObserver = new MutationObserver(inspect);
  settleObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  settleTimer = setTimeout(() => reportResult(nonce, 'uncertain', 'timeout'), LOGIN_SETTLE_TIMEOUT_MS);
  setTimeout(inspect, 0);
}

function captureCandidate(event: Event): void {
  const fields = findLoginFields();
  if (!fields || (fields.form && event.target !== fields.form)) return;
  const username = fields.username?.value.trim() ?? '';
  const password = fields.password.value;
  if (
    !username ||
    !password ||
    username.length > MAX_PASSWORD_USERNAME_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return;
  }
  const nonce = crypto.randomUUID();
  failureBaseline = new WeakSet(
    document.querySelectorAll<HTMLElement>(FAILURE_SELECTOR),
  );
  void ipcRenderer
    .invoke(PASSWORD_GUEST_CHANNELS.candidate, { nonce, username, password })
    .then((accepted: boolean) => {
      if (accepted) watchLoginResult(nonce, fields.form);
    })
    .catch(() => sendStatus({ kind: 'unavailable' }));
}

function install(): void {
  document.addEventListener('submit', captureCandidate, true);
  scheduleLookup();
  const observer = new MutationObserver(scheduleLookup);
  observer.observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    if (lookupTimer) clearTimeout(lookupTimer);
    lookupTimer = null;
    clearSettlement();
  });
}

ipcRenderer.on(
  PASSWORD_GUEST_CHANNELS.fill,
  (_event, credential: Extract<PasswordGuestLookupResult, { kind: 'credential' }>) => {
    if (credential?.kind === 'credential') fillCredential(credential, true);
  },
);

ipcRenderer.on(PASSWORD_GUEST_CHANNELS.verify, (_event, payload: { nonce?: string }) => {
  const nonce = typeof payload?.nonce === 'string' ? payload.nonce : '';
  if (!nonce) return;
  // 导航后同样先看「登录表单还在不在」:不在 = 登录页已经走完,
  // 落地页上的告警条与这次登录无关(freshFailureSignal 里也再挡一次)。
  if (!findLoginFields()) reportResult(nonce, 'success', 'navigation');
  else if (freshFailureSignal()) reportResult(nonce, 'failed', 'message');
  else reportResult(nonce, 'uncertain', 'navigation');
});

ipcRenderer.on(PASSWORD_GUEST_CHANNELS.status, (_event, status: PasswordGuestStatus) => {
  if (status && typeof status.kind === 'string') sendStatus(status);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
