// 设置存储抽象(用户指令 2026-07-21):设置类数据的读写走统一契约——未来设置可能
// 与账号绑定(云同步/多端漫游),届时换注入实现即可,领域存储(browserProfileStore
// 等)零改动。新增设置域一律依赖本接口,不直接碰 fs;既有 state.json /
// remote-hosts.json 暂不回迁(避免范围膨胀,迁移另立里程碑)。

import * as fs from 'node:fs';
import * as path from 'node:path';

/** 一个设置域一份文档(读整取、写整存;实现负责原子性与损坏兜底)。 */
export interface SettingsStore {
  read<T>(fallback: T): T;
  write(value: unknown): void;
}

export interface JsonFileSettingsStoreDeps {
  /** userData 目录(可注入 · 测试用 fs.mkdtempSync)。 */
  userDataDir: () => string;
  /** 文档文件名(如 'browser-profiles.json')。 */
  file: string;
}

/** 本地实现:userData 下单 JSON 文档,原子写(tmp + rename),损坏/缺失回退 fallback。 */
export class JsonFileSettingsStore implements SettingsStore {
  constructor(private readonly deps: JsonFileSettingsStoreDeps) {}

  private filePath(): string {
    return path.join(this.deps.userDataDir(), this.deps.file);
  }

  read<T>(fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(this.filePath(), 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  write(value: unknown): void {
    const file = this.filePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  }
}
