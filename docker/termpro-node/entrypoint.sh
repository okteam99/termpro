#!/usr/bin/env bash
# termpro-node entrypoint: create the SSH user from env, optionally start an
# inner dockerd (DinD), then run sshd.
#   SSH_USER            login user (default: root; other names are created with sudo)
#   SSH_PASSWORD        login password (default: random, printed to container log)
#   SSH_PORT            sshd listen port inside the container (default: 22)
#   SSH_AUTHORIZED_KEYS optional public key(s) written to ~/.ssh/authorized_keys
#   DIND                auto (default) | 1 | 0 — inner dockerd policy.
#                       auto: start one unless /var/run/docker.sock is already
#                       mounted from the host (DooD); if it can't start (no
#                       --privileged / sysbox), degrade to SSH-only.
#                       1: required — exit if dockerd cannot start.  0: never.
#   DOCKERD_EXTRA_ARGS  extra flags for the inner dockerd, word-split as-is
#                       (e.g. "--registry-mirror=https://mirror:5000 --mtu=1400")
set -euo pipefail

SSH_USER="${SSH_USER:-root}"
SSH_PORT="${SSH_PORT:-22}"
DIND="${DIND:-auto}"

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
    if getent group docker >/dev/null; then
        usermod -aG docker "$SSH_USER"
    fi
    echo "$SSH_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$SSH_USER"
    chmod 0440 "/etc/sudoers.d/$SSH_USER"
fi
echo "$SSH_USER:$SSH_PASSWORD" | chpasswd

HOME_DIR="$(getent passwd "$SSH_USER" | cut -d: -f6)"

# Login shells start in /workspace (see /etc/profile.d/10-termpro-workspace.sh).
# Non-recursive chown so a mounted host volume's contents are left untouched.
mkdir -p /workspace
chown "$SSH_USER" /workspace 2>/dev/null || true

if [ -n "${SSH_AUTHORIZED_KEYS:-}" ]; then
    mkdir -p "$HOME_DIR/.ssh"
    printf '%s\n' "$SSH_AUTHORIZED_KEYS" > "$HOME_DIR/.ssh/authorized_keys"
    chmod 0700 "$HOME_DIR/.ssh"
    chmod 0600 "$HOME_DIR/.ssh/authorized_keys"
    chown -R "$SSH_USER" "$HOME_DIR/.ssh"
fi

# --- inner dockerd (DinD) ---------------------------------------------------
DOCKERD_PID=""
DOCKER_STATUS="disabled (DIND=0)"

dind_wanted() {
    case "$DIND" in
        0|false|no) return 1 ;;
        1|true|yes) return 0 ;;
        *)
            if [ -S /var/run/docker.sock ]; then
                DOCKER_STATUS="host socket mounted at /var/run/docker.sock (DooD)"
                return 1
            fi
            return 0
            ;;
    esac
}

start_dockerd() {
    # cgroup v2: move our processes into a child group and enable controllers
    # so the inner dockerd can create sibling cgroups (same trick as docker:dind).
    if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
        mkdir -p /sys/fs/cgroup/init 2>/dev/null || :
        xargs -rn1 < /sys/fs/cgroup/cgroup.procs > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || :
        sed -e 's/ / +/g' -e 's/^/+/' < /sys/fs/cgroup/cgroup.controllers \
            > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || :
    fi
    # Stale pid files from an unclean stop block the next start
    rm -f /run/docker.pid /run/containerd/containerd.pid /var/run/docker.pid

    # shellcheck disable=SC2086  # DOCKERD_EXTRA_ARGS is intentionally word-split
    dockerd ${DOCKERD_EXTRA_ARGS:-} >>/var/log/dockerd.log 2>&1 &
    DOCKERD_PID=$!

    for _ in $(seq 1 60); do
        if docker version >/dev/null 2>&1; then
            DOCKER_STATUS="inner dockerd running (DinD, log: /var/log/dockerd.log)"
            return 0
        fi
        kill -0 "$DOCKERD_PID" 2>/dev/null || break
        sleep 0.5
    done
    kill "$DOCKERD_PID" 2>/dev/null || :
    wait "$DOCKERD_PID" 2>/dev/null || :
    DOCKERD_PID=""
    return 1
}

if dind_wanted; then
    if ! start_dockerd; then
        echo "WARNING: inner dockerd failed to start; run with --privileged or --runtime=sysbox-runc." >&2
        tail -n 20 /var/log/dockerd.log >&2 || :
        case "$DIND" in
            1|true|yes)
                echo "FATAL: DIND=$DIND requires a working dockerd; exiting." >&2
                exit 1
                ;;
        esac
        DOCKER_STATUS="unavailable (needs --privileged or sysbox; see /var/log/dockerd.log)"
    fi
fi

echo "=============================================="
echo " termpro-node ready"
echo "   node:     $(node -v)   npm: $(npm -v)"
echo "   user:     $SSH_USER"
if [ "$GENERATED_PASSWORD" = "1" ]; then
    echo "   password: $SSH_PASSWORD   (generated; set SSH_PASSWORD to choose your own)"
else
    echo "   password: (from SSH_PASSWORD env)"
fi
echo "   port:     $SSH_PORT (in-container; map it with -p <host>:$SSH_PORT)"
echo "   workdir:  /workspace (login shells start here; mount with -v <host-dir>:/workspace)"
echo "   docker:   $DOCKER_STATUS"
echo "=============================================="

if [ -z "$DOCKERD_PID" ]; then
    exec /usr/sbin/sshd -D -e -p "$SSH_PORT"
fi

# With an inner dockerd we stay as PID 1: on TERM stop dockerd first so inner
# containers get their stop grace period before sshd (and the node) goes away.
/usr/sbin/sshd -D -e -p "$SSH_PORT" &
SSHD_PID=$!

shutdown() {
    trap '' TERM INT
    kill -TERM "$DOCKERD_PID" 2>/dev/null || :
    wait "$DOCKERD_PID" 2>/dev/null || :
    kill -TERM "$SSHD_PID" 2>/dev/null || :
}
trap shutdown TERM INT

# Exit when either daemon dies; `docker stop` lands in the trap above.
wait -n || :
shutdown
wait 2>/dev/null || :
