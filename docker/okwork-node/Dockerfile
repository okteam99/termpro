FROM node:22-bookworm

# Base tools + Docker Engine (Docker's apt repo) for DinD: run the container
# with --privileged (or --runtime=sysbox-runc) and the entrypoint starts an
# inner dockerd; without it the entrypoint degrades to SSH-only.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openssh-server \
        sudo \
        procps \
        vim \
        less \
        ca-certificates \
        curl \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd

# Newer npm than the one bundled with node:22 (npm 12 needs node ^22.22.2 —
# satisfied by the floating node:22 tag), plus preinstalled agent CLIs:
# Claude Code + OpenAI Codex. Unpinned on purpose: both release weekly, each
# image rebuild picks up current versions.
RUN npm install -g npm@12 \
    && npm install -g @anthropic-ai/claude-code @openai/codex \
    # npm 12 skips the postinstall that fetches Claude Code's platform-native
    # binary; invoke it directly so the binary lands inside the shared global
    # package dir (works for non-root SSH users too, verified with su).
    && node /usr/local/lib/node_modules/@anthropic-ai/claude-code/install.cjs \
    && npm cache clean --force

# Git host CLIs: GitHub (gh) via its official apt repo, GitLab (glab) via its latest
# release .deb (glab is not in apt). Unpinned on purpose — each image rebuild picks up
# the current versions (same policy as the agent CLIs above).
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && GLAB_ARCH="$(dpkg --print-architecture)" \
    && GLAB_VER="$(curl -fsSL 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases?per_page=1' | grep -o '"tag_name":"[^"]*"' | head -1 | cut -d'"' -f4)" \
    && curl -fsSL -o /tmp/glab.deb "https://gitlab.com/gitlab-org/cli/-/releases/${GLAB_VER}/downloads/glab_${GLAB_VER#v}_linux_${GLAB_ARCH}.deb" \
    && apt-get install -y --no-install-recommends /tmp/glab.deb \
    && rm -f /tmp/glab.deb \
    && rm -rf /var/lib/apt/lists/*

COPY sshd.conf /etc/ssh/sshd_config.d/10-okwork-node.conf
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

# Default working directory: /workspace (mount a host folder here with -v).
# WORKDIR covers docker exec; the profile.d hook lands *fresh* SSH login shells there too.
# 🔴 Guard on $PWD == $HOME: only redirect shells that started at the default landing dir
# (a bare SSH login lands in $HOME). An explicit cwd — e.g. OkWork spawning a terminal for a
# project workspace at /workspace/aon-main — must be respected, not clobbered back to
# /workspace (bug 2026-07-15: remote new-tab cwd was the parent dir, not the project dir).
RUN mkdir -p /workspace \
    && printf '%s\n' '# okwork-node: fresh login shells (landing in $HOME) start in /workspace;' \
        '# an explicit cwd (OkWork per-tab spawn, docker exec -w, etc.) is preserved.' \
        '[ "$PWD" = "$HOME" ] && [ -d /workspace ] && cd /workspace' \
        > /etc/profile.d/10-okwork-workspace.sh
WORKDIR /workspace

# This container *is* a disposable agent sandbox, and the default login is root.
# Claude Code refuses --dangerously-skip-permissions as root unless IS_SANDBOX=1,
# so declare it for all login shells. Prefer no root at all? -e SSH_USER=<name>.
RUN printf '%s\n' '# okwork-node: mark the container as an agent sandbox so Claude Code' \
        '# allows --dangerously-skip-permissions under the (default) root login.' \
        'export IS_SANDBOX=1' \
        > /etc/profile.d/20-okwork-agent.sh

# Inner dockerd storage must not sit on the container's own overlayfs
# (overlay-on-overlay is unsupported and falls back to vfs). Declare a volume
# so an anonymous one is used even when -v doesn't name one explicitly.
VOLUME /var/lib/docker

EXPOSE 22

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
