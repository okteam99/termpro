#!/usr/bin/env bash
# node-ssh entrypoint: create the SSH user from env, then run sshd in foreground.
#   SSH_USER            login user (default: root; other names are created with sudo)
#   SSH_PASSWORD        login password (default: random, printed to container log)
#   SSH_PORT            sshd listen port inside the container (default: 22)
#   SSH_AUTHORIZED_KEYS optional public key(s) written to ~/.ssh/authorized_keys
set -euo pipefail

SSH_USER="${SSH_USER:-root}"
SSH_PORT="${SSH_PORT:-22}"

GENERATED_PASSWORD=0
if [ -z "${SSH_PASSWORD:-}" ]; then
    SSH_PASSWORD="$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)"
    GENERATED_PASSWORD=1
fi

# Per-container host keys (not baked into the image)
ssh-keygen -A >/dev/null

if [ "$SSH_USER" = "root" ]; then
    echo "PermitRootLogin yes" > /etc/ssh/sshd_config.d/20-permit-root.conf
else
    if ! id "$SSH_USER" >/dev/null 2>&1; then
        useradd -m -s /bin/bash "$SSH_USER"
    fi
    usermod -aG sudo "$SSH_USER"
    echo "$SSH_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$SSH_USER"
    chmod 0440 "/etc/sudoers.d/$SSH_USER"
fi
echo "$SSH_USER:$SSH_PASSWORD" | chpasswd

HOME_DIR="$(getent passwd "$SSH_USER" | cut -d: -f6)"

if [ -n "${SSH_AUTHORIZED_KEYS:-}" ]; then
    mkdir -p "$HOME_DIR/.ssh"
    printf '%s\n' "$SSH_AUTHORIZED_KEYS" > "$HOME_DIR/.ssh/authorized_keys"
    chmod 0700 "$HOME_DIR/.ssh"
    chmod 0600 "$HOME_DIR/.ssh/authorized_keys"
    chown -R "$SSH_USER" "$HOME_DIR/.ssh"
fi

echo "=============================================="
echo " node-ssh ready"
echo "   node:     $(node -v)   npm: $(npm -v)"
echo "   user:     $SSH_USER"
if [ "$GENERATED_PASSWORD" = "1" ]; then
    echo "   password: $SSH_PASSWORD   (generated; set SSH_PASSWORD to choose your own)"
else
    echo "   password: (from SSH_PASSWORD env)"
fi
echo "   port:     $SSH_PORT (in-container; map it with -p <host>:$SSH_PORT)"
echo "=============================================="

exec /usr/sbin/sshd -D -e -p "$SSH_PORT"
