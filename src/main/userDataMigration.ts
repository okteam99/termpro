// 品牌改名(TermPro → OkWork)的一次性 userData 迁移:旧目录整体 rename 到
// 新路径,布局存档/远程机台账/查看器偏好全部延续。必须在一切 userData 读写
// 之前执行——单实例锁文件就落在 userData 里,晚于 requestSingleInstanceLock
// 就会先把新目录建出来。
//
// 已知不可迁移:remote-hosts.secrets.json 的密文由 safeStorage 加密,macOS
// 钥匙串条目名随应用名走("TermPro Safe Storage" → "OkWork Safe Storage"),
// 旧密文改名后解不开;CredentialStore.getSecret 解密失败返回 null,连接流程
// 按「无凭据」提示重输,非密文配置(remote-hosts.json)不受影响。

import * as fs from 'node:fs';

export function migrateLegacyUserData(
  legacyDir: string,
  currentDir: string,
  log: Pick<Console, 'log' | 'error'> = console,
): void {
  try {
    if (!fs.existsSync(legacyDir)) return;
    if (fs.existsSync(currentDir)) {
      // 新目录已被(如 Electron 首访)建出来:空则让位;非空视为已迁移或
      // 已产生新数据,绝不覆盖,旧目录原地保留可人工恢复
      if (fs.readdirSync(currentDir).length > 0) return;
      fs.rmdirSync(currentDir);
    }
    // rename 同卷原子:不存在半迁移状态
    fs.renameSync(legacyDir, currentDir);
    log.log(`[migration] userData 已迁移: ${legacyDir} -> ${currentDir}`);
  } catch (err) {
    // 迁移失败不致命:本次以全新 userData 启动,旧数据原地保留
    log.error('[migration] userData 迁移失败:', err);
  }
}
