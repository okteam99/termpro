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

COPY sshd.conf /etc/ssh/sshd_config.d/10-node-ssh.conf
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

EXPOSE 22

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
