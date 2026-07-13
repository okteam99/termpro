#!/usr/bin/env bash
# 一键配置 OkWork 出包签名所需的剩余 4 个 secrets(仓库级,okteam99/termpro)。
# 凭据全程交互输入/从本地文件读取,不落 shell 历史、不写临时文件。
#
# 前置(手动,一次):Keychain Access → 我的证书 →
#   "Developer ID Application: LZ6 PTY LTD" → 右键导出为 .p12(设导出密码)
#
# 用法:./scripts/setup-signing-secrets.sh ~/Desktop/cert.p12
set -euo pipefail

REPO="okteam99/termpro"
P12="${1:-}"

if [ -z "$P12" ] || [ ! -f "$P12" ]; then
  echo "用法: $0 <path/to/cert.p12>" >&2
  echo "(先从 Keychain Access 导出 Developer ID 证书为 .p12)" >&2
  exit 1
fi

echo "→ APPLE_CERTIFICATE_BASE64(读取 $P12)"
base64 -i "$P12" | gh secret set APPLE_CERTIFICATE_BASE64 -R "$REPO"

echo "→ APPLE_CERTIFICATE_PASSWORD(.p12 的导出密码)"
gh secret set APPLE_CERTIFICATE_PASSWORD -R "$REPO"

echo "→ APPLE_ID(你的 Apple ID 邮箱)"
gh secret set APPLE_ID -R "$REPO"

echo "→ APPLE_APP_SPECIFIC_PASSWORD(appleid.apple.com 生成的 App 专用密码)"
gh secret set APPLE_APP_SPECIFIC_PASSWORD -R "$REPO"

echo
echo "✓ 完成。当前 secrets:"
gh secret list -R "$REPO"

echo
echo "提醒:删除导出的证书文件 → rm '$P12'"
