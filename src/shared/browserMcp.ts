// 浏览器 MCP 反向转发的固定容器内端口(阶段3)。OkWork 直连 okwork-node 容器(sshd
// 在容器内),反向转发把本机 MCP server 透到容器回环的这个端口;远端 pty 与 sshd 同
// netns,故 agent 恒以 http://127.0.0.1:<此端口>/mcp/<tabId> 触达,URL 确定、可被镜像
// 预配置。每台远程机各自独立容器/netns,同端口互不冲突。
//
// ⚠️ 改这里需同步 docker/okwork-node/entrypoint.sh 里的同名默认(那边是 shell 字面量,
// 无法 import 本常量)。
export const BROWSER_MCP_REMOTE_PORT = 39217;
