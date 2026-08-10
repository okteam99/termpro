// 浏览器 Profile 台账(browser-profiles.json · 权威在 main)。
// 存储走 SettingsStore 抽象(未来账号绑定换实现,本文件零改动);只存自定义
// profile——默认 profile(DEFAULT_PROFILE_ID)是虚拟实体,恒存在、不可删改。

import { randomUUID } from 'node:crypto';
import {
  BROWSER_PROFILE_DELETION_ERROR_CODES,
  DEFAULT_PROFILE_ID,
  PROFILE_ID_RE,
  isBrowserProfileActive,
  isBrowserProfileDeletionErrorCode,
  type BrowserProfile,
  type BrowserProfileDeletionErrorCode,
  type BrowserProfileInput,
} from '../shared/browserProfile';
import { t } from '../shared/i18n';
import type { SettingsStore } from './settingsStore';

/** UA 头长度上限(防超长头把请求打坏;正常 UA < 200 字符)。 */
const MAX_UA_LENGTH = 1024;
const MAX_NAME_LENGTH = 100;

/** 落盘数组的逐条形状校验(文档可能被手改/损坏;坏条目静默丢弃)。 */
function sanitize(raw: unknown): BrowserProfile[] {
  if (!Array.isArray(raw)) return [];
  const out: BrowserProfile[] = [];
  for (const item of raw) {
    const p = item as Partial<BrowserProfile> | null;
    if (!p || typeof p.id !== 'string' || !PROFILE_ID_RE.test(p.id)) continue;
    if (typeof p.name !== 'string' || !p.name.trim()) continue;
    if (out.some((x) => x.id === p.id)) continue;
    const deletionState =
      p.deletionState === 'deleting' || p.deletionState === 'delete_failed'
        ? p.deletionState
        : undefined;
    const deletionUpdatedAt =
      typeof p.deletionUpdatedAt === 'number' &&
      Number.isFinite(p.deletionUpdatedAt)
        ? p.deletionUpdatedAt
        : 0;
    const deletionErrorCode = isBrowserProfileDeletionErrorCode(
      p.deletionErrorCode,
    )
      ? p.deletionErrorCode
      : BROWSER_PROFILE_DELETION_ERROR_CODES.failed;
    out.push({
      id: p.id,
      name: p.name,
      ...(typeof p.userAgent === 'string' && p.userAgent
        ? { userAgent: p.userAgent.slice(0, MAX_UA_LENGTH) }
        : {}),
      createdAt:
        typeof p.createdAt === 'number' && Number.isFinite(p.createdAt)
          ? p.createdAt
          : 0,
      ...(deletionState
        ? {
            deletionState,
            deletionUpdatedAt,
            ...(deletionState === 'delete_failed' ? { deletionErrorCode } : {}),
          }
        : {}),
    });
  }
  return out;
}

export class BrowserProfileStore {
  constructor(private readonly settings: SettingsStore) {}

  /** 全部自定义 profile(不含虚拟默认;顺序 = 创建序)。 */
  list(): BrowserProfile[] {
    return sanitize(this.settings.read<unknown>([]));
  }

  get(id: string): BrowserProfile | null {
    return this.list().find((p) => p.id === id) ?? null;
  }

  /** 默认 Profile 恒 active；删除中/失败的自定义 Profile 均 inactive。 */
  isActive(id: string): boolean {
    if (id === DEFAULT_PROFILE_ID) return true;
    return isBrowserProfileActive(this.get(id));
  }

  listActive(): BrowserProfile[] {
    return this.list().filter(isBrowserProfileActive);
  }

  /** Migration provider import: preserve the stable id/timestamps after validation. */
  replaceProfile(profile: BrowserProfile): BrowserProfile {
    if (profile.id === DEFAULT_PROFILE_ID) {
      return {
        id: DEFAULT_PROFILE_ID,
        name: t('OkWork (built-in)'),
        createdAt: 0,
      };
    }
    if (!PROFILE_ID_RE.test(profile.id))
      throw new Error('BROWSER_PROFILE_INVALID_ID');
    const name = profile.name.trim().slice(0, MAX_NAME_LENGTH);
    if (!name) throw new Error(t('Profile name is required'));
    const userAgent = (profile.userAgent ?? '').trim().slice(0, MAX_UA_LENGTH);
    if (!Number.isFinite(profile.createdAt) || profile.createdAt < 0) {
      throw new Error('BROWSER_PROFILE_INVALID_CREATED_AT');
    }
    const imported: BrowserProfile = {
      id: profile.id,
      name,
      ...(userAgent ? { userAgent } : {}),
      createdAt: profile.createdAt,
    };
    const list = this.list();
    const index = list.findIndex((item) => item.id === imported.id);
    if (index >= 0) list[index] = imported;
    else list.push(imported);
    this.settings.write(list);
    return imported;
  }

  /** Migration source cleanup only; normal user deletion must use the deletion coordinator. */
  deleteForMigration(id: string): boolean {
    if (id === DEFAULT_PROFILE_ID) return false;
    const list = this.list();
    const next = list.filter((profile) => profile.id !== id);
    if (next.length === list.length) return false;
    this.settings.write(next);
    return true;
  }

  /** 新建(省略 id,自造 32 位 hex)或更新(id 命中既有);默认 profile 恒拒绝。 */
  save(input: BrowserProfileInput): BrowserProfile {
    if (input.id === DEFAULT_PROFILE_ID) {
      throw new Error(t('The built-in profile cannot be modified'));
    }
    const name = (input.name ?? '').trim().slice(0, MAX_NAME_LENGTH);
    if (!name) throw new Error(t('Profile name is required'));
    const userAgent = (input.userAgent ?? '').trim().slice(0, MAX_UA_LENGTH);

    const list = this.list();
    if (input.id !== undefined) {
      const idx = list.findIndex((p) => p.id === input.id);
      if (idx < 0) throw new Error(t('Browser profile not found'));
      if (!isBrowserProfileActive(list[idx])) {
        throw new Error('BROWSER_PROFILE_INACTIVE');
      }
      const updated: BrowserProfile = {
        ...list[idx],
        name,
        ...(userAgent ? { userAgent } : {}),
      };
      if (!userAgent) delete updated.userAgent; // 清空 UA = 回落系统默认
      list[idx] = updated;
      this.settings.write(list);
      return updated;
    }
    const created: BrowserProfile = {
      id: randomUUID().replace(/-/g, ''),
      name,
      ...(userAgent ? { userAgent } : {}),
      createdAt: Date.now(),
    };
    list.push(created);
    this.settings.write(list);
    return created;
  }

  /** active/delete_failed/deleting → deleting；必须先成功落盘，调用方才可开始清理。 */
  markDeleting(id: string, updatedAt = Date.now()): BrowserProfile {
    if (id === DEFAULT_PROFILE_ID) {
      throw new Error('BROWSER_PROFILE_DEFAULT_DELETE_FORBIDDEN');
    }
    const list = this.list();
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error('BROWSER_PROFILE_NOT_FOUND');
    const updated: BrowserProfile = {
      ...list[idx],
      deletionState: 'deleting',
      deletionUpdatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    };
    delete updated.deletionErrorCode;
    list[idx] = updated;
    this.settings.write(list);
    return updated;
  }

  /** deleting/delete_failed → delete_failed；errorCode 只能来自固定 union。 */
  markDeleteFailed(
    id: string,
    errorCode: BrowserProfileDeletionErrorCode,
    updatedAt = Date.now(),
  ): BrowserProfile {
    const list = this.list();
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error('BROWSER_PROFILE_NOT_FOUND');
    if (list[idx].deletionState === undefined) {
      throw new Error('BROWSER_PROFILE_DELETE_NOT_STARTED');
    }
    const updated: BrowserProfile = {
      ...list[idx],
      deletionState: 'delete_failed',
      deletionErrorCode: errorCode,
      deletionUpdatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    };
    list[idx] = updated;
    this.settings.write(list);
    return updated;
  }

  /**
   * 所有外部数据清理成功后的最后一步。active/delete_failed 不可直接移除，防止绕过协调器。
   */
  finalizeDeletion(id: string): boolean {
    if (id === DEFAULT_PROFILE_ID) return false;
    const list = this.list();
    const existing = list.find((p) => p.id === id);
    if (!existing || existing.deletionState !== 'deleting') return false;
    const next = list.filter((p) => p.id !== id);
    this.settings.write(next);
    return true;
  }
}
