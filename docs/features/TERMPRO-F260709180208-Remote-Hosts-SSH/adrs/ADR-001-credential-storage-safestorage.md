# ADR-001 · 远程机凭据存储采用 Electron safeStorage（而非钥匙串条目直存）

- **状态**：Accepted（用户拍板 · YOLO-PREFLIGHT §2#2 · 2026-07-10）
- **Feature**：TERMPRO-F260709180208-Remote-Hosts-SSH（BL-003）

## 背景

上游规划（Q-003 / ROADMAP BL-003 AC③ / WS-01-S3 AC③ / sitemap）原措辞为「凭据存**系统钥匙串**」。实现选型时有两条路：

- **A · Electron safeStorage**：OS 钥匙串仅存加密密钥，凭据**密文**落 userData 文件。Electron 内置、零 native 依赖、官方长期维护。
- **B · keytar 直存钥匙串条目**：凭据本体入 Keychain。但 keytar 已停止维护（archived），native 模块带来 Electron 版本升级矩阵负担。

## 决策

选 **A（safeStorage）**。用户已在 yolo 预研门决策表（明确列出「密文落 userData · 与『条目直存钥匙串』字面有差异 · keytar 已弃维护」）逐行知情拍板。

## 威胁模型说明（PL-CHALLENGE-1 关注点）

- 密文文件进入备份（如 Time Machine）时，解密密钥仍只在 OS 登录钥匙串——备份获得者拿到的是无密钥密文，**非明文暴露**。
- 「零明文」保证不变：配置文件、日志、仓库任何位置无凭据明文（AC-3 验收）。
- 与之区分的另一类 secret：host loopback capability token（一次性 · 按设计进入 renderer 的 ws URL）不属于 SSH 登录凭据，生命周期与信道见 PRD AC-8 / D-7。

## 影响

- 上游 4 处「仅存钥匙串」措辞已注记同步（业务规划 Q-003 / ROADMAP BL-003 / WS-01-S3 AC③ / sitemap remote-hosts 行），消除台账矛盾，防 BL-004/005 及后续读者误读。
- SSH 私钥不适用本 ADR：私钥仅按文件路径引用，内容永不入库（PRD Out of Scope）。
