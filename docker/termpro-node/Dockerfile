FROM node:22-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openssh-server \
        sudo \
        procps \
        vim \
        less \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd

COPY sshd.conf /etc/ssh/sshd_config.d/10-termpro-node.conf
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

# Default working directory: /workspace (mount a host folder here with -v).
# WORKDIR covers docker exec; the profile.d hook makes SSH login shells land there too.
RUN mkdir -p /workspace \
    && printf '%s\n' '# termpro-node: login shells start in /workspace' \
        '[ -d /workspace ] && cd /workspace' \
        > /etc/profile.d/10-termpro-workspace.sh
WORKDIR /workspace

EXPOSE 22

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
