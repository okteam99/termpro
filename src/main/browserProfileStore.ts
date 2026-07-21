// 浏览器 Profile 台账(browser-profiles.json · 权威在 main)。
// 存储走 SettingsStore 抽象(未来账号绑定换实现,本文件零改动);只存自定义
// profile——默认 profile(DEFAULT_PROFILE_ID)是虚拟实体,恒存在、不可删改。

import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PROFILE_ID,
  PROFILE_ID_RE,
  type BrowserProfile,
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
    out.push({
      id: p.id,
      name: p.name,
      ...(typeof p.userAgent === 'string' && p.userAgent
        ? { userAgent: p.userAgent.slice(0, MAX_UA_LENGTH) }
        : {}),
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
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

  /** 删除;默认 profile / 不存在 → false(幂等,无副作用)。 */
  delete(id: string): boolean {
    if (id === DEFAULT_PROFILE_ID) return false;
    const list = this.list();
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) return false;
    this.settings.write(next);
    return true;
  }
}
