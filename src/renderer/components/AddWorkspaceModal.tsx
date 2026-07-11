// 添加项目 modal(BL-004 · D-4/AC-3/AC-4)。移植自设计预览
// docs/design/preview-project/src/main.jsx L962-1163(AddWorkspaceModal)。
// 与预览的关键差异(D-4 已定):第一步只列「本机 + 已连接远程机」——未连接的远程机不可选
// (选机器发起完整连接编排出范围,归 Sidebar 组头「连接」入口 AC-8);目录浏览用真实
// hostRegistry.forHostId(configId).rpc('fs.readdir') 替代预览的静态 mock 树。
// 「添加远程机」入口不违背 D-4:它只是就地挂载 RemoteHostsPage(连接编排仍归该弹层),
// 关闭后刷新配置列表,新连上的机器即出现在「已连接远程机」组。

import './AddWorkspaceModal.css';
import { useEffect, useState } from 'react';
import { useAppStore, tildify } from '../state/store';
import { hostRegistry } from '../services/hostRegistry';
import { useRemoteHostRuntimeStore } from '../state/remoteHostStore';
import { RemoteHostsPage } from './settings/RemoteHostsPage';
import type { DirEntry } from '../../shared/protocol';
import type { RemoteHostConfig } from '../../shared/remoteHost';
import { t } from '../../shared/i18n';

function LocalMachineIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="11" height="7.5" rx="1.2" />
      <line x1="5" y1="12" x2="9" y2="12" />
      <line x1="7" y1="10" x2="7" y2="12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="7" y1="2.5" x2="7" y2="11.5" />
      <line x1="2.5" y1="7" x2="11.5" y2="7" />
    </svg>
  );
}

function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function joinPath(segments: string[]): string {
  return `/${segments.join('/')}`;
}

interface Crumb {
  label: string;
  path: string;
}

function buildCrumbs(path: string): Crumb[] {
  const segments = splitPath(path);
  const crumbs: Crumb[] = [{ label: '/', path: '/' }];
  let acc: string[] = [];
  for (const seg of segments) {
    acc = [...acc, seg];
    crumbs.push({ label: seg, path: joinPath(acc) });
  }
  return crumbs;
}

export interface AddWorkspaceModalProps {
  onClose(): void;
}

type Step = 'pick' | 'dir';

/**
 * 「添加项目」modal:第一步选机器(本机置顶 + 已连接远程机,D-4)→
 * 本机原生目录对话框 / 远程目录浏览器(加载/空/错误态,AC-3)→ 落该机组(AC-4)。
 */
export function AddWorkspaceModal({ onClose }: AddWorkspaceModalProps) {
  const addWorkspace = useAppStore((s) => s.addWorkspace);
  const creatingWorkspace = useAppStore((s) => s.creatingWorkspace);
  const runtimeMap = useRemoteHostRuntimeStore((s) => s.runtime);

  const [remoteConfigs, setRemoteConfigs] = useState<RemoteHostConfig[]>([]);
  const [step, setStep] = useState<Step>('pick');
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState('/');
  const [dirEntries, setDirEntries] = useState<DirEntry[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [remoteHostsOpen, setRemoteHostsOpen] = useState(false);
  // 「新建目录」内联编辑器(远程机浏览器专用;本机走原生对话框,自带新建)
  const [newDirOpen, setNewDirOpen] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  const [newDirBusy, setNewDirBusy] = useState(false);
  const [newDirError, setNewDirError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    window.termpro.remoteHost.list().then((list) => {
      if (alive) setRemoteConfigs(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Esc 关闭;RemoteHostsPage 叠层在上时让位——同一次 Esc 只关顶层(它自带 Esc 监听),
  // 本层 gate 在按键时刻的 remoteHostsOpen 上,不会被同一事件连带关掉。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !remoteHostsOpen) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, remoteHostsOpen]);

  function closeRemoteHosts() {
    setRemoteHostsOpen(false);
    // 弹层里可能刚增/删/连了机器:刷新配置列表(连接态走 runtime store,本就是活订阅)
    void window.termpro.remoteHost.list().then(setRemoteConfigs);
  }

  const connectedHosts = remoteConfigs.filter((h) => runtimeMap[h.id]?.stage === 'ready');
  const selectedHost = remoteConfigs.find((h) => h.id === selectedHostId) ?? null;

  // 🔴 hostId 显式传参(不读 selectedHostId state):selectHost 里 setSelectedHostId(id) 后
  // 紧接着同步调用 loadDir——此刻组件尚未重渲染,state 闭包仍是上一轮的旧值(经典 stale
  // closure),读 selectedHostId 会在"刚选中机器的第一次加载"上恒读到 null 而静默 no-op。
  function resetNewDir() {
    setNewDirOpen(false);
    setNewDirName('');
    setNewDirError(null);
  }

  async function loadDir(hostId: string, path: string) {
    const client = hostRegistry.forHostId(hostId);
    setCurrentPath(path);
    resetNewDir();
    if (!client) {
      // E8 同型:目录浏览期间目标机断开——不静默,呈现错误态(不兜底本机浏览远程路径)
      setDirLoading(false);
      setDirError(t('Target host is disconnected'));
      return;
    }
    setDirLoading(true);
    setDirError(null);
    try {
      const { entries } = await client.rpc('fs.readdir', { path });
      setDirEntries(entries.filter((e) => e.kind === 'dir'));
    } catch (err) {
      console.warn('[AddWorkspaceModal] fs.readdir failed:', hostId, path, err);
      setDirError(err instanceof Error ? err.message : String(err));
    } finally {
      setDirLoading(false);
    }
  }

  async function selectLocal() {
    if (creatingWorkspace) return;
    const path = await window.termpro.pickDirectory();
    if (!path) return;
    await addWorkspace(path);
    onClose();
  }

  function selectHost(id: string) {
    setSelectedHostId(id);
    setStep('dir');
    setDirEntries([]);
    setDirError(null);
    const client = hostRegistry.forHostId(id);
    const start = client?.info?.homedir ?? '/';
    void loadDir(id, start);
  }

  function backToPick() {
    setStep('pick');
    setSelectedHostId(null);
    setDirEntries([]);
    setDirError(null);
  }

  async function handleCreate() {
    if (!selectedHostId || dirLoading || !!dirError || creatingWorkspace) return;
    await addWorkspace(currentPath, selectedHostId);
    onClose();
  }

  async function handleMkdir() {
    const name = newDirName.trim();
    if (!name || !selectedHostId || newDirBusy) return;
    if (name === '.' || name === '..' || name.includes('/')) {
      setNewDirError(t('Directory name cannot be . / .. or contain /'));
      return;
    }
    const client = hostRegistry.forHostId(selectedHostId);
    if (!client) {
      setNewDirError(t('Target host is disconnected'));
      return;
    }
    setNewDirBusy(true);
    setNewDirError(null);
    const target = joinPath([...splitPath(currentPath), name]);
    try {
      await client.rpc('fs.mkdir', { path: target });
    } catch (err) {
      console.warn('[AddWorkspaceModal] fs.mkdir failed:', selectedHostId, target, err);
      setNewDirError(err instanceof Error ? err.message : String(err));
      setNewDirBusy(false);
      return;
    }
    setNewDirBusy(false);
    // 创建即进入新目录:底部路径落在新目录上,直接点「创建项目」即注册于此
    await loadDir(selectedHostId, target);
  }

  const crumbs = step === 'dir' ? buildCrumbs(currentPath) : [];
  const homedir = selectedHostId ? hostRegistry.forHostId(selectedHostId)?.info?.homedir : undefined;
  const pathDisplay = tildify(currentPath, homedir ?? undefined);

  return (
    <div
      className="add-ws__backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="add-ws__card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="add-ws__header">
          <div>
            <div className="add-ws__title">{t('Add Project')}</div>
            <div className="add-ws__subtitle">
              {t('Project registers on the selected host · visible after any device connects')}
            </div>
          </div>
          <button className="add-ws__close" onClick={onClose} title={t('Close')}>
            ×
          </button>
        </div>

        <div className="add-ws__body">
          {step === 'pick' && (
            <div className="add-ws__panel">
              <div className="add-ws__host-list add-ws__host-list--local">
                <button
                  className="add-ws__host-row"
                  onClick={() => void selectLocal()}
                  disabled={creatingWorkspace}
                >
                  <span className="add-ws__local-icon">
                    <LocalMachineIcon />
                  </span>
                  <span className="add-ws__host-alias">{t('Local')}</span>
                  <span className="add-ws__host-addr">
                    {t('{platform} · Local directory', { platform: window.termpro.platform })}
                  </span>
                  <span className="add-ws__host-chevron">›</span>
                </button>
              </div>
              {connectedHosts.length > 0 && (
                <div className="add-ws__host-group">
                  <div className="add-ws__host-group-title">{t('Connected remote hosts')}</div>
                  <div className="add-ws__host-list">
                    {connectedHosts.map((h) => (
                      <button
                        key={h.id}
                        className="add-ws__host-row"
                        onClick={() => selectHost(h.id)}
                      >
                        <span className="add-ws__host-dot add-ws__host-dot--connected" />
                        <span className="add-ws__host-alias">{h.alias}</span>
                        <span className="add-ws__host-addr">
                          {h.username}@{h.host}:{h.port}
                        </span>
                        <span className="add-ws__host-chevron">›</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="add-ws__host-list add-ws__host-list--add-remote">
                <button
                  className="add-ws__host-row add-ws__host-row--add"
                  onClick={() => setRemoteHostsOpen(true)}
                >
                  <span className="add-ws__local-icon">
                    <PlusIcon />
                  </span>
                  <span className="add-ws__host-alias">{t('Add remote host')}</span>
                  <span className="add-ws__host-addr">{t('SSH key or password login')}</span>
                  <span className="add-ws__host-chevron">›</span>
                </button>
              </div>
              {connectedHosts.length === 0 && (
                <div className="add-ws__hint">
                  {t(
                    'No connected remote hosts yet · Add and connect one to pick a remote directory here',
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'dir' && selectedHost && (
            <div className="add-ws__panel">
              <div className="add-ws__dirhead">
                <button className="add-ws__back" onClick={backToPick}>
                  {t('‹ Back')}
                </button>
                <span className="add-ws__machine-chip add-ws__machine-chip--connected">
                  <span className="add-ws__machine-dot" />
                  {selectedHost.alias}
                </span>
              </div>
              <div className="add-ws__breadcrumb">
                {crumbs.map((c, i) => (
                  <span key={c.path} className="add-ws__crumb-wrap">
                    {i > 0 && <span className="add-ws__crumb-sep">/</span>}
                    <button className="add-ws__crumb" onClick={() => void loadDir(selectedHost.id, c.path)}>
                      {c.label}
                    </button>
                  </span>
                ))}
              </div>
              {dirLoading ? (
                <div className="add-ws__dirlist add-ws__dirlist--loading">
                  <span className="add-ws__spinner add-ws__spinner--sm" />
                  <span>{t('Reading directory…')}</span>
                </div>
              ) : dirError ? (
                <div className="add-ws__dir-error">
                  <div className="add-ws__dir-error-text">{dirError}</div>
                  <button className="add-ws__btn" onClick={() => void loadDir(selectedHost.id, currentPath)}>
                    {t('Retry')}
                  </button>
                </div>
              ) : (
                <div className="add-ws__dirlist">
                  {dirEntries.length === 0 && <div className="add-ws__dir-empty">{t('(empty directory)')}</div>}
                  {dirEntries.map((entry) => (
                    <div
                      key={entry.name}
                      className="file-panel__row file-panel__row--dir"
                      onClick={() =>
                        void loadDir(selectedHost.id, joinPath([...splitPath(currentPath), entry.name]))
                      }
                    >
                      <span className="file-panel__arrow">▸</span>
                      <span className="file-panel__name">{entry.name}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="add-ws__pathrow">
                <input
                  className="file-panel__path-input add-ws__path-input"
                  value={pathDisplay}
                  readOnly
                />
              </div>
              <div className="add-ws__actions">
                {newDirOpen ? (
                  <div className="add-ws__newdir">
                    <input
                      className="add-ws__newdir-input"
                      placeholder={t('New directory name')}
                      value={newDirName}
                      autoFocus
                      disabled={newDirBusy}
                      onChange={(e) => {
                        setNewDirName(e.target.value);
                        setNewDirError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleMkdir();
                        if (e.key === 'Escape') {
                          // 只关内联编辑器,不让 document 层 Esc 监听连带关掉整个 modal
                          e.stopPropagation();
                          resetNewDir();
                        }
                      }}
                    />
                    <button
                      className="add-ws__btn"
                      onClick={() => void handleMkdir()}
                      disabled={newDirBusy || !newDirName.trim()}
                    >
                      {newDirBusy ? t('Creating…') : t('Create')}
                    </button>
                    <button className="add-ws__btn" onClick={resetNewDir} disabled={newDirBusy}>
                      ✕
                    </button>
                    {newDirError && <span className="add-ws__newdir-error">{newDirError}</span>}
                  </div>
                ) : (
                  <button
                    className="add-ws__btn add-ws__btn--newdir"
                    onClick={() => setNewDirOpen(true)}
                    disabled={dirLoading || !!dirError}
                    title={t('Create a new folder in the current directory')}
                  >
                    {t('+ New folder')}
                  </button>
                )}
                <button className="add-ws__btn" onClick={onClose}>
                  {t('Cancel')}
                </button>
                <button
                  className="add-ws__btn add-ws__btn--primary"
                  onClick={() => void handleCreate()}
                  disabled={dirLoading || !!dirError || creatingWorkspace}
                >
                  {t('Create project on {alias}', { alias: selectedHost.alias })}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* 「远程机」管理弹层就地叠加(同 z-index · DOM 靠后者在上);关闭后刷新配置列表 */}
      {remoteHostsOpen && <RemoteHostsPage onClose={closeRemoteHosts} />}
    </div>
  );
}
