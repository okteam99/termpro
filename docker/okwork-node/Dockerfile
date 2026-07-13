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

COPY sshd.conf /etc/ssh/sshd_config.d/10-okwork-node.conf
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

# Default working directory: /workspace (mount a host folder here with -v).
# WORKDIR covers docker exec; the profile.d hook makes SSH login shells land there too.
RUN mkdir -p /workspace \
    && printf '%s\n' '# okwork-node: login shells start in /workspace' \
        '[ -d /workspace ] && cd /workspace' \
        > /etc/profile.d/10-okwork-workspace.sh
WORKDIR /workspace

# Inner dockerd storage must not sit on the container's own overlayfs
# (overlay-on-overlay is unsupported and falls back to vfs). Declare a volume
# so an anonymous one is used even when -v doesn't name one explicitly.
VOLUME /var/lib/docker

EXPOSE 22

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
