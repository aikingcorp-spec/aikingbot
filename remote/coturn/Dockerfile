FROM coturn/coturn:4.17.2-r0
COPY remote/coturn/turnserver.conf /etc/coturn/aikingbot.conf
COPY remote/coturn/entrypoint.sh /usr/local/bin/aikingbot-coturn
ENTRYPOINT ["/usr/local/bin/aikingbot-coturn"]
