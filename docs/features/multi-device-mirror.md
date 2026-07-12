# TECH — 多设备同 SSH 账号 · 会话多端同屏(镜像)

> PENDING-011 · M1(身份收敛)+ M2(多订阅镜像)。M3(tab 布局服务端化)defer。
> 用户拍板 2026-07-12。作者:架构设计师(重推理阶段)。不改任何源代码,仅设计。

---

## 0. 目标与前提

### 0.1 需求(用户拍板)

1. 同一 SSH 账号的多台客户端设备连同一服务器 → 收敛到**同一个**服务端 Host 进程(消互踢)。
2. 会话输出**同时**推给所有在线设备(镜像同屏);任一端可输入。
3. **SSH 连接信息(地址/端口)不参与身份判定**——身份 = `(服务器 host key 指纹 + SSH 用户名)` 派生;各端连接参数可不同。
4. 保留现行「隔离模式」(每端独立 configId/Host)为可选。
5. 向后兼容:旧客户端/旧 Host 不炸,能力位协商(沿用 BL-005 `session.resume` 惯例,`PROTOCOL_VERSION=1` 不 bump,向后兼容追加)。

### 0.2 现状关键事实(读码结论,附行号)

- **身份当前 = `configId`**:`HostConfigStore.save` 用 `generateId()`(`credentialStore.ts:208`,`crypto.randomBytes(9)` base64url,~12 字符,**随机、per UI 条目**)。`configId` 贯穿:`--host-tag`(`orchestrator.ts:207`)→ 端口文件 `hostTag` 字段(`host.ts:119`)→ reap 双验 `cmdlineMatchesHostTag`(`residency.ts:49-57`)→ token 键 `hosttoken:<configId>`(`orchestrator.ts:111`)→ 数据目录 `hosts/<configId>/`(`orchestrator.ts:198-199`)。
- **token 当前 = 各设备本地生成**:`generateToken()`(`orchestrator.ts:115,631`)在 main 侧生成,存本地 `credentialStore`(`orchestrator.ts:679`),经 `--token-stdin` 注入 host(`orchestrator.ts:207` + `token.ts:111`)。**设备 B 无从得知设备 A 的 token** → 现架构下 B 探测 A 的 host 必失败 → 走 reap → **互踢**。这是 M1 要根治的核心。
- **host key 指纹当前不可得**:`SshConnection.connect`(`ssh.ts:171-180`)**未设 `hostVerifier`**——ssh2 完全不校验也不暴露 host key。`@types/ssh2` 有 `ConnectConfig.hostVerifier: HostVerifier=(key:Buffer,verify)=>void`(`index.d.ts:707,726`),这是拿指纹的最小接缝。`SshConnectionLike`(`ssh.ts:36-59`)**未暴露指纹**,需最小追加。
- **ptyPool 单 owner**:`Session.send` 是**单个函数**(`ptyPool.ts:26`),`unacked`/`paused`/`attached` 均单值(`ptyPool.ts:32-33`)。输出只回归属方(`session.send` @ `ptyPool.ts:117,165,174,185`)。`detach` 摘单 owner(`ptyPool.ts:245-255`)。`reattach` 换单 send + 回放(`ptyPool.ts:263-300`)。这是 M2 要改造的核心。
- **last-attach-wins 三步原子转移**:`hostCore.ts:300-338` —— ① 从其余 client 的 `sessions` 集摘 sid(`303-305`)② `reattach` 换 send(`307`)③ 加入本 client(`334`)。M2 改为「订阅」语义。
- **pty:input/resize/ack 门控**:`client.sessions.has(sessionId)`(`hostCore.ts:115-129`)。多连接下防 A 打 B 的会话。M2 下「归属」= 「订阅者」。
- **端口文件 O_EXCL**:`fs.openSync(portFile,'wx',0o600)`(`host.ts:111`),陈旧即 `exit(1)`。这是并发首启互斥的现成原子原语,但**语义粗糙**(后到者自杀,不认领)。
- **部署锁**:`bundle/.deploying-<v>` 用 `mkdir` O_EXCL 等价互斥 + 陈旧 break-and-reacquire + `waitForReady` 轮询(`deploy.ts:115-147,193-209`)。M1 首启锁复用此**成熟模式**。
- **residency reap 安全性质②③**:仅杀 cmdline `--host-tag` **全等** configId 的进程(`residency.ts:86-89`);pid 死/tag 不匹配 → `cleanStaleThenDeploy` 绝不 kill(`residency.ts:91-95`)。迁移期新旧 tag 并存**天然不误杀**(tag 全等才 kill)。
- **workspaces 跨进程竞态**:所有 host 共享 `TERMPRO_HOST_DATA_DIR`(`hostCore.ts:86-88`),各 host 各持一个 `WorkspaceService` 读写**同一** registry 文件 → 今有跨进程写覆盖竞态。收敛为单 Host 后,单 `WorkspaceService` → 竞态自动消失(红利)。
- **ring 回放**:`RingBuffer.sliceFrom(offset)` 据 `absoluteOffset`/`startOffset` 产增量或整缓冲(`ringBuffer.ts:84-101`);默认 256 KiB(`ringBuffer.ts:10`)。M2 每订阅者复用同一 ring,各持独立游标。
- **renderer 收养**:`renderedBytes` 同步累加(`terminalRegistry.ts:280-299`),`adoptInst` attach 换 `resumeOffset=renderedBytes`(`terminalRegistry.ts:363-387`),`readoptHost` 双路径(`415-497`),`bindRestoredSessionTab`(`509-526`)。M2 下每设备是**独立订阅者持独立 renderedBytes**,这些逻辑**原样成立**(见 §B7)。

### 0.3 核心概念:`configId` 与 `hostTag` 分离(本设计的地基)

| 键 | 语义 | 作用域 | 生成 | 用途 |
|---|---|---|---|---|
| `configId` | UI/客户端本地条目键 | 单设备内 | 随机(现状不变) | orchestrator sessions Map 键、UI 列表、隧道实例、本地凭据键 |
| `hostTag` | **服务端身份键** | 跨设备(同服务器+同用户全等) | **派生**:`hash(fp + username)`(隔离模式退化 = configId) | 远端数据目录 `hosts/<hostTag>/`、`--host-tag`、端口文件、reap 比对、身份 token 文件、启动锁 |

> 关键洞见:两台**不同设备**、甚至同设备的两条**不同 config**(不同地址指向同一 server+user),都派生出**同一 `hostTag`** → 收敛到同一 Host。`configId` 仍是各自的 UI/隧道键。**收敛发生在 `hostTag` 层,不在 `configId` 层。**

---

## 1. M1 — 身份收敛

### A.1 hostTag 派生式 + 指纹获取

#### 决策:派生式

```
fpDigest  = SHA-256( rawHostKeyBytes )              // 32 bytes;ssh2 hostVerifier 的 key:Buffer
material  = Buffer.concat([ fpDigest, utf8(username) ])   // fpDigest 定长 32B → 拼接单射,无需分隔符
tag       = SHA-256( material ).base64url            // 43 字符
hostTag   = 'id-' + tag.slice(0, 26)                 // 'id-' 前缀 + 26 字符 ≈ 156 bit
```

- **`'id-' 前缀`**:与遗留随机 configId(无前缀、12 字符)命名空间隔离,便于迁移期人肉辨识 + 端口目录不撞;隔离模式下 `hostTag = configId`(无前缀),路径天然分家。
- **截断 156 bit**:单用户名下服务器数量量级极小,碰撞概率可忽略;短 tag 利于路径/日志可读。
- **`fpDigest` 而非原始 key 入 hash**:定长 32B 保证与 username 拼接单射(username 可含任意字节,直接拼接会有边界歧义;用定长前缀消歧,不引 HMAC/分隔符,YAGNI)。
- **纯函数** `deriveHostTag(fpDigest: Buffer, username: string): string` 落 `src/shared/hostIdentity.ts`(零 Node/Electron,可两端引 + 纯单测)。

**备选与否决:**
| 备选 | 否决理由 |
|---|---|
| `hash(host+port+username)` | 违反前提 3:各端地址/端口可不同 → 派生不出同一 tag,收敛失效 |
| 用 SSH 服务器返回的 `session-id` | 每次连接不同,非稳定身份 |
| 用 `~/.ssh/known_hosts` 指纹 | 客户端本地文件,跨设备不一致、可能缺失;应取**本次连接实握的 host key** |
| HMAC(secret, ...) | 无 secret 可托管(secret 本身又是跨设备一致性难题),且 tag 非安全边界(真屏障是 token),多余 |

#### 决策:指纹从 ssh2 `hostVerifier` 捕获(最小改动)

现状 `ssh.ts` 未设 `hostVerifier`,host key 既不校验也不暴露。最小改动:

```ts
// ssh.ts —— SshConnection 内新增字段 + connect 配置追加
private hostKeyDigest: Buffer | null = null;

client.connect({
  ...,
  hostHash: undefined,                     // 不用 ssh2 的 hex 摘要,要原始 key 自算 SHA-256
  hostVerifier: (key: Buffer) => {
    this.hostKeyDigest = crypto.createHash('sha256').update(key).digest();
    return true;                            // 🔴 恒接受:不引入 host-key pinning(TOFU 是独立安全特性,超本 RD 范围)
  },
});
```

`SshConnectionLike` 追加:
```ts
/** 本次连接握到的 host key 的 SHA-256 摘要(hostTag 派生源);未握到 → null。 */
hostKeyFingerprint(): Buffer | null;
```

- **恒 `return true`**:严格保持现状行为(现在就没有任何 host key 校验)。**本 RD 不改变信任模型**,只是「顺路捕获指纹」。是否引入 TOFU/pinning 另立 issue。
- **测试**:DI 桩 `SshConnectionLike` 直接返回预置 Buffer;`deriveHostTag` 纯单测(确定性、fp 敏感、username 敏感、隔离退化)。
- **降级**:`hostKeyFingerprint()===null`(ssh2 未回调 / 老 ssh2)→ 无法派生 → **回退隔离模式**(`hostTag=configId`),不收敛但不炸(fail-safe)。

### A.2 token 服务端托管

#### 问题

收敛要求**所有设备对共享 host 出示同一 token**。现状各设备本地生成 token(`orchestrator.ts:631`)→ 设备 B 不知 A 的 token → 探测失败 → 误 reap → 互踢。

#### 决策:Host 进程自写身份 token 文件(0600),排序先于端口文件

```
${dataDir}/identity/${hostTag}/token       # 0600,内容 = 128-bit base64url token(无换行)
${dataDir}/identity/${hostTag}/            # 0700
${dataDir}/                                 # 0700(收紧,现状隐式创建未限权)
```

| 决策点 | 裁决 | 理由 |
|---|---|---|
| **谁写** | **Host 进程自写**(它已从 `--token-stdin` 持有 token) | 客户端 sftp 写会引入「谁的 token 权威」竞态 + 明文过 sftp;host 自写就地 0600,单一权威 |
| **何时写** | Host 启动**先写 token 文件(原子替换)→ 再写端口文件** | 建立 happens-before:任何设备**看到端口文件 ⇒ token 文件已完整可读**,消 TOCTOU 半读 |
| **原子性** | 写 `token.tmp-<pid>` → `fs.renameSync` → `token` | 替换陈旧 token 无半读窗口;新 host 覆盖旧身份 token |
| **权限** | 文件 0600、目录 0700;`mkdir -p -m 700`(orchestrator 建 hostDir 时同建 identity 目录) | 同机他用户不可读(与 loopback+token 同威胁模型) |
| **读取** | 设备用自己的 sftp(**同一 SSH 用户**)读 → 权威 `storedToken` | 跨用户读不到(0700 目录);同用户各设备读到同一 token |
| **读失败降级** | 读不到/权限异常 → 视作「无可认领 host」→ 走首启锁竞争(fail-closed,绝不臆造 token) | 不 fail-open 击穿端口闸 |
| **轮换时机** | 仅随 **host 进程重启**(协议不兼容重部署 / 陈旧清理后新起)自然轮换;无周期轮换 | token 生命周期 = host 进程生命周期,YAGNI;新 host 原子替换 token 文件 + `cleanStale` 清端口文件 |
| **与 `--token-stdin` 关系** | 启动路径**不变**:赢家仍经 `--token-stdin` 注入生成的 token(off argv/ps);host **额外**落盘身份文件供他设备认领 | 复用现成 off-ps 通道;仅新增 host 侧「落盘一份」 |

**host.ts 改动**:新增 env `TERMPRO_HOST_IDENTITY_FILE=${dataDir}/identity/${hostTag}/token`;host 解析出 token 后(`resolveToken` 之后、`startWsServer` 之前),若该 env 存在则原子写入 0600,写在端口文件之前。

**residency 改动**:`storedToken` 输入源从「本地 credentialStore」改为「**sftp 读服务端身份文件**」(`orchestrator.ts:564` 的 `getSecret(tokenKey)` → 新增 `sftpReadFile(identity/<hostTag>/token)`)。本地 credentialStore 仍可缓存(键改 `hosttoken:<hostTag>`)供心跳/快速重连,但**服务端文件为权威**。

> **PENDING-003 关联**:token 落盘扩大了暴露面(文件 vs 仅 stdin)。缓解与 PENDING-003 `--token-file 0600` 同口径(`token.ts:88-100` 已有 0600 强校验的先例);目录 0700 + 原子替换 + 排序先于端口文件,消 token-file TOCTOU。**本 RD 一并交付 PENDING-003 的 token-file 运维面收口。**

### A.3 双设备并发首启竞态

#### 问题

设备 A、B 同时发现无 host → 双双部署 + 启动。若不互斥,B 的 host 撞端口文件 `wx` EEXIST → `exit(1)`(`host.ts:113-115`),但 B 设备的 `pollPortFile` 会读到 A 的端口文件、**却持 B 自己的 token** → 探测 A 失败 → **误 reap A(杀 A 的运行中 host)**。这是最危险的回归。

#### 决策:首启锁(复用 deploy.ts 成熟锁模式)

新增**主机启动锁** `${dataDir}/hosts/${hostTag}/.starting`(mkdir O_EXCL 等价互斥 + 陈旧 break-and-reacquire + `waitForReady` 轮询端口文件):

```
                       ┌─ acquired(赢家)→ execDetached 起 host → host 写 token 文件 → 写端口文件 → 释放锁
mkdir .starting ──────┤
                       └─ EEXIST 未陈旧(输家)→ waitForPortFile(轮询端口文件出现)
                                              → sftp 读服务端 token 文件 → 建隧道 probe(server token)→ claim
```

| 决策点 | 裁决 | 理由 |
|---|---|---|
| 互斥原语 | **复用 deploy.ts `acquireLock`/`waitForReady` 锁模式**(mkdir O_EXCL + meta.json{ts} + 陈旧阈值 break-and-reacquire) | 该模式已在部署路径经 A5/E2/R1 多轮加固(`deploy.ts:92-147`),久经考验;不重造原语 |
| 锁粒度 | per-`hostTag`(`hosts/<hostTag>/.starting`) | 收敛后同 tag 全设备竞同一锁;隔离模式 tag=configId 天然分锁 |
| 输家行为 | **等端口文件 → 读 server token → 认领**(非自杀) | 消除「输家持己 token 误 reap 赢家」;输家的 host 进程根本不起(锁没抢到) |
| 端口文件 `wx` | **保留**为纵深(万一双赢家) | O_EXCL 二道防线;正常路径由启动锁挡在前,不再走到 `exit(1)` |
| 陈旧锁 | 阈值(默认 120s,env 可调)break-and-reacquire | 持锁设备中途 SSH 断/进程亡 → 锁不永久 wedge(deploy.ts 同款) |

**为何不直接复用部署锁**:部署锁是 **per-version**(`bundle/.deploying-<v>`),语义是「上传 bundle 互斥」;首启锁是 **per-hostTag**「拉起进程互斥」,粒度/生命周期不同,**不可合一**。复用其**代码模式**(抽出 `mkdirLock(ssh, lockDir, opts)` 通用助手),不复用其锁对象。

### A.4 迁移 + 隔离模式开关

#### 存量 per-configId Host 处置

- 旧客户端未升级:继续用旧 configId 作 tag,行为不变。
- 新客户端连旧机:派生新 `hostTag`(`id-*`),数据目录 `hosts/id-xxx/` 与旧 `hosts/<configId>/` **不撞**。旧 host 成孤儿(idle 自然老死 / 由仍在用它的旧设备管理)。
- **reap 安全性质②③天然保住**:新设备的 reap 只认 cmdline `--host-tag == 新 hostTag`;旧 host 的 cmdline 是旧 configId → **全等比对不匹配 → 绝不 kill**(`residency.ts:86-89`)。新旧 tag 并存期**零误杀**,无需额外防护。
- **可选清理(非 M1 必需)**:新客户端收敛成功后,若探测到「本设备自己的旧 configId host」仍在跑(cmdline tag == 本 configId,属本设备,杀之安全),best-effort reap 之以省资源。**默认不做**,列为 M1+ 增强。

#### 隔离模式开关

| 决策点 | 裁决 |
|---|---|
| 存放 | `RemoteHostConfig.isolate?: boolean`(`remoteHost.ts` 追加,存 remote-hosts.json) |
| 默认值 | `undefined`/`false` → **收敛**(用户明确要的新默认);`true` → 隔离(hostTag=configId,退化现状) |
| 生效点 | orchestrator 连接后:`isolate ? configId : deriveHostTag(fp, username)` |
| 指纹缺失兜底 | 派生失败(`hostKeyFingerprint()===null`)→ 无论 isolate 与否都退化 configId(fail-safe) |

#### residency 决策表(M1 修订版)

输入变更:`storedToken` = **服务端身份 token 文件内容**(sftp 读);`portRaw.hostTag` 与 `hostTag`(而非 configId)比对;reap cmdline 比对 `hostTag`。

| # | portRaw | serverToken | probe(serverToken) | pid 存活 | cmdline tag==hostTag | 决策 | kill |
|---|---|---|---|---|---|---|---|
| 1 | 有效且 hostTag 匹配 | 非空 | ok 且 compatible | — | — | **claim**(认领共享 host) | 否 |
| 2 | 有效 | 非空/空 | 失败/不兼容 | 是 | **是** | reapThenDeploy | **是** |
| 3 | 有效 | — | 失败 | 是 | 否(兄弟/无关) | cleanStaleThenDeploy | 否 |
| 4 | 有效 | — | 失败 | 否 | — | cleanStaleThenDeploy | 否 |
| 5 | 无 | — | — | — | — | freshDeploy(经首启锁) | 否 |

- 与 `decideResidency`(`residency.ts:74-95`)结构一致,仅 `candidateEligible` 的 token 源、tag 比对基准改为 hostTag。**纯决策函数签名不变,穷举分支测试沿用。**
- **#2 是唯一 kill 分支**:probe 用 **server token** 都失败 + pid 活 + tag 全等本 hostTag ⇒ 确是「本身份的坏死 host」,可回收。收敛后正常路径永远走 #1(认领),不再 #2 互踢。

### 时序:双设备收敛(happy path)

```
设备A                          远端 (hostTag=id-abc)                    设备B
  │ connect                                                              │ connect(稍后)
  │─ssh, 派生 hostTag=id-abc                                             │─ssh, 派生 hostTag=id-abc
  │─sftp 读 identity/id-abc/token → 空                                   │
  │─mkdir hosts/id-abc/.starting → acquired ✅                           │
  │─execDetached 起 host ──────────▶ host: resolveToken(stdin)           │
  │                                  写 identity/id-abc/token(0600,原子) │
  │                                  写 hosts/id-abc/host.port(wx)        │
  │─pollPortFile ✅ ◀────────────────┘                                   │
  │─释放 .starting 锁                                                     │
  │─建隧道→probe(token)✅→ready                                          │
  │  (host: subscriber={A})                                              │
  │                                                                       │─sftp 读 identity/id-abc/token → 命中同一 token ✅
  │                                    mkdir .starting → EEXIST? 否(已释放)│
  │                                    portRaw 有效 + serverToken 非空     │
  │                                  ◀─建隧道→probe(server token)✅────────│
  │                                    decideResidency → claim ✅          │
  │                                    (host: subscriber={A,B}) ──ready──▶│  无互踢
```

竞态变体(A、B 同时抢锁):赢家(A)起 host;输家(B)mkdir EEXIST 未陈旧 → `waitForPortFile` → 读 server token → claim。**两设备最终都认领同一 host,零 kill。**

---

## 2. M2 — 多订阅镜像

### B.1 ptyPool 数据结构:单 owner → 订阅者集合

```ts
interface Subscriber {
  id: number;                     // = client.id(hostCore 分配)
  send: (msg: HostMessage) => void;
  unacked: number;                // 该订阅者已发未确认字节(独立流控)
  cursor: number;                 // 该订阅者已确认到的 absoluteOffset(ack 推进)
  desync: boolean;                // 落后超 ring → 退出流控参与,待 full-resync
  cols: number; rows: number;     // 该订阅者视口(min-size 政策用)
}

interface Session {
  // ...(id/pty/scanner/tracker/mode/status/ring/absoluteOffset/... 不变)
  subscribers: Map<number, Subscriber>;   // 取代单 send/unacked/paused/attached
  paused: boolean;                          // PTY 级(由订阅者集合派生,见 B2)
  // attached 派生为 getter: subscribers.size > 0
}
```

- **ring + absoluteOffset 单一共享**(`ptyPool.ts:35-37,152-153`):PTY 输出仍只入一份 ring;每订阅者持独立 `cursor` 从同一 ring 取增量(复用 `sliceFrom`,`ringBuffer.ts:84`)。
- `spawn` 时的 `send` → 初始 subscribers = `{ ownerClient }`(单元素,等价现状)。

### B.2 流控(零回归是硬约束)

> **🔴 v2 修订(收尾评审 P2-2/P2-3,2026-07-13)**:本节原稿的多订阅 pause 公式与
> 内存上界在默认常量下不可达且自相矛盾(highWatermark 512KiB > ring 256KiB;且暂停
> 共享 PTY 必然耦合全体订阅者,与「快端不受慢端拖累」冲突)。实装口径:
> - **单订阅(size===1)**:pause/resume 高低水位,与旧单 owner 逐字节一致(零回归);
> - **多订阅(size>1)**:【免 pause】,唯一背压 = desync 驱逐,阈值
>   `DESYNC_UNACKED = 2×highWatermark = 1MiB`(解耦 ring 容量——256KiB 会误伤健康
>   高 RTT 端);被驱逐者收 `session:desynced` 事件 → renderer 立即 mirror re-attach
>   全量重同步(不静默冻屏);
> - 单订阅期憋停的 pause 在第二订阅者 mirror attach 时立即释放(maybeResume
>   多订阅政体恒放行,否则新健康端被旧卡死端饿死);
> - 内存上界:每活跃订阅者 unacked ≤ 1MiB 即被驱逐,ring 有界 → 总量有界。
> 下方原稿公式保留作历史,以实装口径为准。

**PTY pause 判据(派生,原稿·已被 v2 修订取代):**

```
需要 pause ⇔ ∃ 非 desync 订阅者 s: s.unacked > FLOW.highWatermark
可以 resume ⇔ ∀ 非 desync 订阅者 s: s.unacked < FLOW.lowWatermark
```

**单订阅者 = 现行为完全等价(零回归证明):**
- 恰一个订阅者且正常 ack:`unacked` 受水位约束,pause/resume 触发点与今**逐字节一致**(`ptyPool.ts:157-164,198-201`)。
- **desync 驱逐仅在 `subscribers.size > 1` 时启用**。`size==1` 时**永不 desync**,一个卡死订阅者照今天一样 pause 并保持(`ptyPool.ts` 单 owner 卡死语义原样)。→ 单订阅者健康路径与卡死路径**双双 byte-identical**。

**多订阅者慢消费者策略:**
- 每订阅者独立 `unacked`。
- 订阅者落后越过**硬顶**(`RING 容量`,即其 `cursor` 距 `absoluteOffset` 超过 ring 已无法增量回放)→ 标记 `desync`:
  1. 停发增量 `pty:data`(不再堆其发送队列);
  2. `unacked` 不再计入 pause 判据(**单一慢端不得憋停 PTY**);
  3. 调度**强制 full-resync**:下次该订阅者 attach(或主动补发)时 `sliceFrom(cursor)` 必返 `full=true` → renderer `term.reset()` 全量。
- pause 只被**健康**订阅者驱动;desync 端被剔除出流控 → 快端不受慢端拖累。

**内存上界推演:**
```
上界 ≈ ring容量 C + (健康订阅者数 H) × (highWatermark + 单 chunk)
     = 256KiB + H × ~512KiB
```
desync 订阅者不持增量队列(改从 ring 全量重同步)→ 不进上界。H 为「跟得上的活跃端」数,量级个位数 → 上界受控。**关键性质:任意慢端都不能让 PTY 无界产出**(ring 有界 + 慢端 desync 后 PTY 由健康端流控)。

### B.3 attach 语义:mirror 订阅 vs 独占接续

`session.attach` 追加参数(向后兼容):
```ts
'session.attach': {
  params: { sessionId; resumeOffset; cols; rows; mode?: 'mirror' | 'exclusive' };  // 🔴 mode 新增
  result: SessionAttachResult;   // 不变
};
```

| mode | 语义 | last-attach-wins? |
|---|---|---|
| `'mirror'`(新客户端默认) | **加入/刷新订阅**,不摘除其他订阅者 → 多端同屏 | 否(窗口内多订阅并存) |
| `'exclusive'`(旧客户端省略 → 默认) | 摘除**所有**其他订阅者(它们收 `session:takenover` 事件)→ 本端独占 | **是**(等价 `hostCore.ts:300-338` 现行三步转移) |

- **默认 `exclusive`**:旧客户端 attach 不带 `mode` → host 判独占 → **与今 last-attach-wins 完全一致**(零回归)。
- 新客户端(mirror-aware)显式传 `mode:'mirror'`。
- **last-attach-wins 保留层次**:退化为「**exclusive attach 内部的语义**」——即某端主动要独占时的转移原语;镜像模式下**不触发**转移,而是并存订阅。旧客户端混入时经由「exclusive attach 摘除他人」这条既有路径实现「抢占」,与今行为同。

**新旧混连兼容矩阵:**

| 客户端 | Host | attach 行为 | 对镜像订阅者的表现 |
|---|---|---|---|
| 新(mirror) | 新(有 `session.mirror` 能力) | `mode:'mirror'` → 订阅 | 全员同屏,输入任一端 |
| 旧(无 mirror) | 新 | 省略 mode → `exclusive` → 摘除他人 | 现有 mirror 订阅者被摘 → 收 `session:takenover` → UI 提示「已在别处独占接管·点击取回」→ 点击 = 重新 `mode:'mirror'` attach 补屏(ring 全量) |
| 新(mirror) | 旧(无 mirror 能力) | 能力位缺失 → renderer 降级发 `exclusive`(等价 BL-005 单 owner 收养) | 旧 host 不识 mode(忽略)→ 走其单 owner reattach(`ptyPool.ts:263`)→ 退化为接续模式,不同屏但不炸 |
| 旧 | 旧 | 现状 | 现状(单 owner) |

- 能力位:`host.info.capabilities` 追加 `'session.mirror'`(`protocol.ts:42`,与 `'session.resume'` 并列)。renderer `supportsSessionMirror()`(仿 `hostClient.ts:152`)。缺失 → 只发 exclusive attach,零破坏。

### B.4 断连清理

```
连接 close(hostCore port 'close' · hostCore.ts:136-151):
  standalone: for sid in client.sessions: pool.unsubscribe(sid, client.id)   // 🔴 只摘该订阅者
```

- `unsubscribe(sid, subId)`:从 `subscribers` 删该项。
- **全部订阅者掉光** → `subscribers.size===0` → **等价现 `detach`**(`ptyPool.ts:245-255`):
  - `attached`(派生)=false → 旁路流控(不 pause 憋停);
  - 若 PTY 已 paused,`resume()`(解已 paused,防无 owner 永不 resume,`ptyPool.ts:249-252` 同款);
  - ring 续录(断开续跑,AC-1 不变)。
- 单订阅者 close → 直接空集 → 与今 detach **逐行等价**(零回归)。

### B.5 resize 政策

#### 决策:min-size(tmux 式)

PTY 尺寸 = `min(所有订阅者 cols) × min(所有订阅者 rows)`。订阅者 join/leave/resize 时重算,变化才 `pty.resize`。

| 决策点 | 裁决 | 理由 |
|---|---|---|
| 政策 | **min-size** | M2 本质是「同时显示」;尺寸溢出最小视口会**损毁该端 TUI 渲染**(vim/htop 错行不可读)。min 保证内容在**所有**屏可读,大屏留白可接受 |
| 触发 | 任一订阅者 resize / 订阅者增减 → 重算 min → 变则 `pty.resize` | 订阅者离开可能放大 min(最小屏走了)→ 需重算 |
| 记账 | 每订阅者 `cols/rows` 存 Subscriber | 已在 attach/resize 报文携带(`protocol.ts` resize 已有 cols/rows) |

**备选与否决:**
| 备选 | 否决理由 |
|---|---|
| last-writer-wins | 双端主动 resize 时抖动;更糟——非活跃端视口若小于 PTY,其 TUI 溢出损毁不可读(镜像的核心失败态) |
| 各端独立尺寸(不共享 PTY 尺寸) | PTY 只有一个尺寸,物理不可能;伪各端需重排版渲染层,超范围 |

> 注:min-size 是每订阅者 cols/rows 的纯函数,新增状态极少(每订阅者两个整数),重算是 O(订阅者数)。

### B.6 session:event / pty:exit / pty:title / badge 广播 + ack 门控

- **广播**:`session.send({...})` 的**所有**调用点(`ptyPool.ts:117` session:event、`165` pty:data、`174/185` pty:exit、`362` pty:title)改为 `for (s of subscribers) s.send({...})`。pty:data 额外过流控 + desync 门(见 B2)。
- **ack 门控从「归属方」→「订阅者」安全推演**:
  - `pty:input`/`pty:resize`/`pty:ack` 门控由 `client.sessions.has(sid)`(`hostCore.ts:115-129`)改为「client 是该 session 的订阅者」(等价:client.sessions 仍作为「本 client 订阅的会话集」,unsubscribe 时移除)。
  - **ack 独立性(安全关键)**:每订阅者 ack 只推进**自己的** `Subscriber.unacked/cursor`,**不触及他人**。→ 一个订阅者(误/恶)ack 无法替他人推进游标、无法伪造他人流控。多连接下 A 的 ack 不影响 B 的补屏正确性。
  - **input 权限**:任一订阅者可 input(单租户 token 闸后同一用户,可接受;镜像的语义就是「任一端可打」)。input 写共享 PTY,天然汇流。
  - **resize 权限**:任一订阅者 resize → 触发 min 重算(B5),不直接抢占 PTY 尺寸。

### B.7 renderer 最小适配面

| 现有逻辑 | 订阅语义下 | 结论 |
|---|---|---|
| `renderedBytes` 同步累加(`terminalRegistry.ts:297`) | 每设备是独立订阅者,持**本设备**的 renderedBytes | **原样成立**——本就是「本端已渲染字节」,与他端无关 |
| `adoptInst` attach `resumeOffset=renderedBytes`(`terminalRegistry.ts:372`) | host 据**本订阅者** cursor 从共享 ring 算 gap(`sliceFrom`) | **原样成立**——每 attach 独立算切片,ring 共享不冲突;仅新增 `mode:'mirror'` 参数 |
| `readoptHost` 路径①闪断(`terminalRegistry.ts:448-462`) | 重连 = 重新订阅(mirror attach),而非抢占 | **原样成立**——found/full/nextOffset 语义不变;不再摘他端 |
| `readoptHost` 路径②重建 | 同上 | 原样成立 |
| `bindRestoredSessionTab`(`terminalRegistry.ts:509-526`) | 恢复 tab 预绑定 → wireLiveSession → 收养 = 订阅 | 原样成立 |
| live `pty:data` 分发(`hostClient.ts:483-492`) | host 广播给所有订阅者,各 renderer 独立 `ingestPtyData` | 原样成立 |

**净改动**:①`session.attach` 加 `mode:'mirror'`(默认发 mirror,能力缺失降 exclusive);②新增 `session:takenover` 事件消费(exclusive 被抢时提示「点击取回」);③`supportsSessionMirror()`。**核心记账/回放/游标逻辑零改动**——这是订阅模型「白送」的直接收益(每订阅者独立游标本就与 BL-005 单端收养同构)。

### 时序:两端镜像(输出同屏 + 任一端输入)

```
设备A(订阅者)         Host session s(subscribers={A,B})        设备B(订阅者)
   │                    PTY.onData("ls\r\n...")                    │
   │                    ├ ring.push · absoluteOffset+=            │
   │                    ├ A.unacked+= · pause?(A over hi)         │
   │◀───pty:data────────┤ B.unacked+= · pause?(B over hi)         │
   │  renderedBytes+=   └──────────────pty:data───────────────────▶│ renderedBytes+=
   │──pty:ack(A)───────▶ A.unacked-= / cursor=                    │
   │                     ◀──────────────pty:ack(B)─────────────────│ B.unacked-=
   │                                                               │
   │                     ◀──pty:input("vim\r")──(B 打字)──────────│
   │                     PTY.write("vim\r") → 输出广播回 A 和 B     │
   │◀═══同屏═══════════════════════════════════════════════════════▶│
```

慢端 desync:B 长时间不 ack、cursor 落后越 ring → B.desync=true → 停发 B 增量、B 不计入 pause → A 照常流控推进;B 恢复时 attach(mirror)→ `full=true` → `term.reset()` 全量补屏。

---

## 3. 兼容矩阵(汇总)

### 能力位协商(不 bump PROTOCOL_VERSION)

| capability | 含义 | host 侧 | renderer 侧判定 |
|---|---|---|---|
| `session.resume`(既有) | 断线重连回放收养 | standalone 填(`hostCore.ts:182`) | `supportsSessionResume()`(`hostClient.ts:152`) |
| `session.mirror`(**新**) | 多订阅同屏 + `mode` 参数 | standalone 且 M2 已部署时填 | `supportsSessionMirror()`(新增,仿上) |

### 客户端×Host 全矩阵

| 客户端能力 | Host 能力 | 身份收敛 | 会话共享形态 |
|---|---|---|---|
| 新(M1+M2) | 新(M1+M2) | ✅ 收敛(hostTag) | 镜像同屏 |
| 新(M1+M2) | 新(仅 M1,`session.resume` 无 `session.mirror`) | ✅ 收敛 | 降级接续(exclusive last-attach-wins) |
| 新 | 旧(无 `session.resume`) | ❌ 不收敛(退隔离) | 每端 new spawn(现状) |
| 旧(仅 `session.resume`) | 新(M1+M2) | 部分——旧客户端仍用 configId 作 tag(不派生)→ **不与新客户端收敛**;需要旧客户端也升级到 M1 才收敛 | 旧客户端 exclusive 接续;新客户端间镜像 |
| 旧 | 旧 | 现状 | 现状 |

> **重要边界**:身份收敛需**客户端侧**具备 M1(派生 hostTag)。旧客户端连新 host 时仍用随机 configId 作 tag → 落 `hosts/<configId>/`,不与新客户端的 `hosts/id-*/` 收敛。这是可接受的渐进迁移:**先升级客户端**才享收敛,旧客户端保持隔离不炸。

---

## 4. 阶段拆分(每阶段独立三绿可提交)

> 节奏:tsc + vitest + 冒烟三绿才进下一阶段(CLAUDE.md 流程纪律)。

### Phase 1 — 身份派生地基(纯 plumbing,零行为变化)
- ssh.ts 加 `hostVerifier` 捕获指纹 + `SshConnectionLike.hostKeyFingerprint()`;桩同步更新。
- `src/shared/hostIdentity.ts`:`deriveHostTag(fpDigest, username)` 纯函数。
- `RemoteHostConfig.isolate?` 字段;orchestrator 连接后算 `hostTag`(**默认 isolate=true 占位 → tag==configId,不收敛**),把 `configId → hostTag` 贯穿到 dataDir 路径/`--host-tag`/token 键。
- **验收断言**:existing 远程 connect 行为逐字不变(tag==configId);`deriveHostTag` 单测(确定性 / fp 敏感 / username 敏感 / 隔离退化);typecheck+vitest 绿。

### Phase 2 — 服务端 token 托管 + 收敛认领
- host.ts 写 `identity/<hostTag>/token`(0600,原子,排序先于端口文件);env `TERMPRO_HOST_IDENTITY_FILE`。
- residency `storedToken` 源改 sftp 读服务端身份文件;claim 用 server token;`decideResidency` tag 比对基准 → hostTag。
- **翻转默认 isolate=false → 收敛生效。**
- **验收断言**:双设备集成(桩 ssh)→ 第二设备 claim 第一设备的 host(**零 kill**);reap 安全表(②③)穷举测试仍绿;token 文件 0600 + 目录 0700 断言;新旧 tag 并存不误杀测试。

### Phase 3 — 并发首启互斥
- 抽 `mkdirLock` 通用助手(自 deploy.ts 锁模式);首启锁 `hosts/<hostTag>/.starting`;输家 `waitForPortFile → 读 server token → claim`。
- **验收断言**:并发 connect 竞态测试 → 恰一个 host 起、另一认领;无互踢;端口文件 `exit(1)` 路径不再被正常流程触达(锁挡在前)。

### Phase 4 — ptyPool 多订阅镜像
- Session 单 owner → `subscribers: Map`;per-subscriber `unacked/cursor/desync/cols/rows`;`subscribe/unsubscribe/ackFor/resizeFor`。
- 流控规则(单订阅零回归 + 多订阅 desync 硬顶);广播 event/exit/title;空集 → detach 等价;min-size resize。
- `session.attach` 加 `mode`;hostCore 门控「归属」→「订阅」;last-attach-wins 收进 exclusive 分支。
- **验收断言**:单订阅者黄金测试**逐字节等价**现行(reattach/流控/detach);双订阅者镜像(双收输出、任一端 input);慢端 desync→full-resync;内存上界断言;min-size 重算测试。

### Phase 5 — 兼容矩阵 + 集成 + 评审
- `session.mirror` 能力位;renderer `supportsSessionMirror` + 默认 `mode:'mirror'` + `session:takenover` 事件与「点击取回」钩子(UI 细节可 M3 收尾,先接线事件)。
- 新旧混连矩阵集成;opus 评审新增核心(token 托管面 / 流控 / 门控 / 首启锁竞态);修 P1;勾 README;push。
- **验收断言**:混连矩阵全绿;冒烟 SMOKE_OK;typecheck+vitest 绿。

---

## 5. 测试计划

### 单测
- `deriveHostTag`:确定性、fp 敏感、username 敏感、隔离退化、指纹缺失兜底。
- `decideResidency`(M1 修订):5 分支穷举 + server-token 源;新旧 tag 并存不误杀(#3 兄弟分支)。
- `mkdirLock`:acquire / EEXIST 未陈旧 waitForPeer / 陈旧 break-and-reacquire(复用 deploy 锁测试骨架)。
- token 文件:0600/0700 断言、原子替换无半读、读失败 fail-closed、排序先于端口文件。
- ptyPool 流控**黄金对比**:单订阅者 vs 现行,pause/resume/detach/reattach 逐点等价(回归护栏)。
- ptyPool 多订阅:两订阅者输出广播、独立 unacked/ack、desync 硬顶触发 + full-resync、min-size 重算、空集 detach 等价。
- ring 复用:多游标 `sliceFrom` 独立性。

### 集成
- **双客户端镜像**:两 WS client 订阅同 session → 都收 pty:data;A input → B 收回显;A resize 小 → PTY 取 min。
- **慢端 resync**:B 停 ack 越 ring → A 不憋停(PTY 继续)→ B 恢复 attach 得 full。
- **并发首启互斥**:两 orchestrator 并发 connect 同 hostTag(桩 ssh 共享远端 FS 状态)→ 恰一 host、另一 claim、零 kill。
- **收敛端到端**:设备 A 起 host + 写身份 token → 设备 B claim(读 server token)→ 两订阅者;A 断连 → B 续;全断 → detach 续跑;重连 → 各自 mirror 补屏。
- **新旧混连矩阵**:旧 host×新客户端(降级接续)/新 host×旧客户端(exclusive 抢占 + takenover)/旧×旧(现状)。
- **reap 安全**:新客户端在存量旧 configId host 旁收敛 → 旧 host 不被杀。

### 安全审查点清单(opus 评审必查)
1. **token 托管面**:身份文件 0600 + 目录 0700 + `.termpro-host` 0700;原子替换无半读;排序先于端口文件(happens-before);读失败 fail-closed 不臆造;token 绝不上 argv/ps(沿用 `--token-stdin`);token 明文不入日志(host.ts 驻留态不打印,`host.ts:93-96`)。
2. **门控**:input/resize/ack 权限 = 订阅者身份;ack 只推进自己游标(不跨订阅者污染);loopback + token 闸不变(`wsServer.ts:204,252`);host.info-first 门控不变。
3. **reap 安全性质②③**:仅杀 cmdline `--host-tag` 全等 hostTag 的进程;新旧 tag 并存零误杀;#2 唯一 kill 分支用 server token 判死。
4. **首启锁**:陈旧 break-and-reacquire 不永久 wedge;输家不持己 token 误 reap 赢家;端口文件 `wx` 纵深保留。
5. **流控不变式**:单订阅零回归(黄金测试守门);慢端不憋停 PTY;内存上界受控;desync full-resync 不丢字节(ring 边界 UTF-8 安全,`ringBuffer.ts:72-76`)。
6. **身份非安全边界**:hostTag 是**寻址键非鉴权**;真屏障恒是 128-bit token(`token.ts` 常量时间校验 `verifyToken`,`token.ts:125-131`)。指纹派生被污染最坏只导致「路由到错身份的端口」,该端口仍需正确 token 才能接入 → 不击穿。

---

## 6. 依赖与影响面

- **协议**:`protocol.ts` 追加 `session.attach.params.mode` + `capabilities` 值 `'session.mirror'` + `HostMessage` 新事件 `session:takenover`(向后兼容追加,不 bump)。
- **host/**:`ptyPool.ts`(订阅化,最大改动面)、`hostCore.ts`(门控/广播/attach 语义)、`host.ts`(写身份 token 文件)。远程就绪约束不破(零 Electron import)。
- **main/remote/**:`ssh.ts`(指纹捕获)、`orchestrator.ts`(hostTag 派生 + 首启锁 + server token 源)、`residency.ts`(token 源 + tag 基准)、新 `mkdirLock` 助手、`deploy.ts`(抽锁模式,不改语义)。
- **shared/**:`hostIdentity.ts`(新)、`remoteHost.ts`(isolate 字段)。
- **renderer/**:`hostClient.ts`(supportsSessionMirror)、`terminalRegistry.ts`(attach mode + takenover 钩子)。核心记账逻辑零改。
- **红利**:收敛后单 Host → 单 WorkspaceService → `workspaces.json` 跨进程覆盖竞态自动消失(`hostCore.ts:86-88` + `workspaceService.ts:86-92`)。

---

## 7. Defer(M3 及以后)

- M3:tab 名称/顺序服务端化(客户端布局持久化降级为离线兜底)。
- 「已在别处接管·点击取回」完整 UI(M2 只接线 `session:takenover` 事件 + 最小提示)。
- TOFU / host-key pinning(本 RD 恒接受 host key,只捕获指纹派生身份)。
- 收敛后自动清理本设备遗留的旧 configId host(A.4 可选增强)。
