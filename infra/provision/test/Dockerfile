# The throwaway machine of `nx test-integration provision`: Ubuntu 24.04 as a
# provider delivers it, with what the cloud image has and the Docker image
# lacks (systemd, OpenSSH, ip, sudo). Docker's images forbid starting
# services (policy-rc.d): a real machine does not.
FROM ubuntu:24.04

RUN apt-get update -qq \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    systemd systemd-sysv dbus openssh-server iproute2 sudo >/dev/null \
  && rm -f /usr/sbin/policy-rc.d

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
