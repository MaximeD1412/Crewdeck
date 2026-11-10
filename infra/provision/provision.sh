#!/usr/bin/env bash
# Provisioning of Crewdeck's VPS (INFRA-7, ADR 0009 « Provisioning »):
# Ubuntu 24.04 LTS, run as root. Idempotent: run again, it leaves alone what
# is already in place, and says so.
#
#   provision.sh --admin-user <name> --admin-key <public keys file>
#   ADMIN_USER=<name> ADMIN_KEY=<file> provision.sh
#
# Seven steps: the admin account, key-only SSH, fail2ban, the ufw firewall,
# Docker CE and its DOCKER-USER chain, security updates, the /opt/crewdeck
# tree and the crewdeck-edge network. Each prints « déjà fait » or
# « appliqué : <what> »; the last line is « rien à changer » when all of them
# already were. Everything is checked before the first change.
#
# How to run it: infra/provision/README.md. Ported from personal-os's.
set -euo pipefail

ADMIN_USER="${ADMIN_USER:-}"
ADMIN_KEY="${ADMIN_KEY:-}"
ADMIN_KEYS=""
ARCH=""
STEPS=7
APPLIED=0
CHANGES=()
APT_FRESH=false
# The only ports reachable from outside, on the host as through Docker.
OPEN_PORTS=(22/tcp 80/tcp 443/tcp 443/udp)
DOCKER_OPEN_PORTS=(80/tcp 443/tcp 443/udp)
DOCKER_PACKAGES=(docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin)
# Ubuntu's packages that conflict with Docker's (its install guide has them
# removed).
DOCKER_CONFLICTS=(docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc)
SSHD_CONF=00-crewdeck.conf
DOCKER_USER_RULES=/etc/crewdeck/docker-user.rules
DOCKER_USER_UNIT=crewdeck-docker-user.service
KEY_LINE='^(ssh-|ecdsa-|sk-)[A-Za-z0-9@.-]+ [A-Za-z0-9+/]+=*( .*)?$'
export DEBIAN_FRONTEND=noninteractive
# needrestart (Ubuntu) would restart services after each apt-get install,
# sshd and dockerd included.
export NEEDRESTART_SUSPEND=1

die() {
  echo "provision: $*" >&2
  exit 1
}

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

changed() {
  CHANGES+=("$1")
}

# A step: its line of the summary, once done.
step() {
  local n="$1" title="$2" joined
  shift 2
  CHANGES=()
  "$@"
  if ((${#CHANGES[@]} == 0)); then
    echo "[$n/$STEPS] $title : déjà fait"
    return
  fi
  APPLIED=$((APPLIED + 1))
  joined=$(printf '%s, ' "${CHANGES[@]}")
  echo "[$n/$STEPS] $title : appliqué : ${joined%, }"
}

# System commands write to stderr: stdout carries only the summary.
run() {
  "$@" >&2
}

apt_get() {
  run apt-get -qq -o DPkg::Lock::Timeout=600 "$@"
}

package_installed() {
  [[ "$(dpkg-query -W -f '${db:Status-Status}' "$1" 2>/dev/null)" == installed ]]
}

# Installs the missing packages; the package lists are updated once per run
# (and after a repository is added).
install_packages() {
  local missing=() pkg
  for pkg in "$@"; do
    package_installed "$pkg" || missing+=("$pkg")
  done
  ((${#missing[@]} > 0)) || return 0
  if ! $APT_FRESH; then
    apt_get update
    APT_FRESH=true
  fi
  apt_get install -y --no-install-recommends "${missing[@]}"
  changed "paquets installés : ${missing[*]}"
}

# Writes stdin to a file if it differs in content, mode or owner.
# Returns 0 if the file changed, 1 otherwise.
write_file() {
  local path="$1" mode="$2" owner="$3" new
  new=$(mktemp)
  cat >"$new"
  if [[ -f "$path" ]] && cmp -s "$new" "$path" && [[ "$(stat -c '%a %U:%G' "$path")" == "$mode $owner" ]]; then
    rm -f "$new"
    return 1
  fi
  mkdir -p "$(dirname "$path")"
  cat "$new" >"$path.provision"
  rm -f "$new"
  chmod "$mode" "$path.provision"
  chown "$owner" "$path.provision"
  mv -f "$path.provision" "$path"
}

# Returns 0 if the directory was created, or its mode or owner fixed.
ensure_dir() {
  local path="$1" mode="$2" owner="$3"
  [[ -d "$path" && "$(stat -c '%a %U:%G' "$path")" == "$mode $owner" ]] && return 1
  mkdir -p "$path"
  chmod "$mode" "$path"
  chown "$owner" "$path"
}

# Enabled and started.
service_ok() {
  systemctl is-enabled --quiet "$1" 2>/dev/null && systemctl is-active --quiet "$1"
}

# Returns 0 if the service was just enabled or started.
ensure_service() {
  service_ok "$1" && return 1
  run systemctl enable --now "$1"
}

# --- Checks: everything is checked before the first change. ---

check_os() {
  local id="" version="" pretty=""
  if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    id=$(. /etc/os-release && echo "${ID:-}")
    # shellcheck source=/dev/null
    version=$(. /etc/os-release && echo "${VERSION_ID:-}")
    # shellcheck source=/dev/null
    pretty=$(. /etc/os-release && echo "${PRETTY_NAME:-}")
  fi
  [[ "$id" == ubuntu && "$version" == 24.04 ]] || die "Ubuntu 24.04 attendu (trouvé : ${pretty:-système inconnu})"
}

check_arch() {
  ARCH=$(dpkg --print-architecture)
  [[ "$ARCH" == amd64 || "$ARCH" == arm64 ]] || die "architecture non prise en charge : $ARCH (amd64 ou arm64)"
}

check_admin() {
  [[ -n "$ADMIN_USER" ]] || die "--admin-user (ou ADMIN_USER) manquant : le compte d'administration à créer"
  [[ "$ADMIN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "--admin-user : minuscules, chiffres, - et _ (ex. ops)"
  [[ "$ADMIN_USER" != root && "$ADMIN_USER" != deploy ]] ||
    die "--admin-user : ni root (refusé par SSH) ni deploy (le compte du déploiement, INFRA-6)"
}

# The admin's keys: their own, kept as they are, then those of the given
# file. A key with options (restricted by command=, from=…) is never copied:
# without its options, it would grant more than it was given. Each given key
# must be one OpenSSH reads (ssh-keygen): once root and the provider's account
# are shut out, a truncated key could be the only way in, and sshd -t does
# not read authorized_keys.
collect_keys() {
  local home="" given line n tmp
  [[ -n "$ADMIN_KEY" ]] || die "--admin-key (ou ADMIN_KEY) manquant : le fichier de la clé publique de l'administrateur"
  [[ -r "$ADMIN_KEY" ]] || die "--admin-key : $ADMIN_KEY illisible"
  given=$(grep -E "$KEY_LINE" "$ADMIN_KEY" || true)
  [[ -n "$given" ]] || die "--admin-key : aucune clé publique dans $ADMIN_KEY (ssh-ed25519 AAAA… commentaire)"
  tmp=$(mktemp)
  while IFS= read -r line; do
    n=${line%%:*}
    line=${line#*:}
    printf '%s\n' "$line" >"$tmp"
    if ! ssh-keygen -l -f "$tmp" >/dev/null 2>&1; then
      rm -f "$tmp"
      die "--admin-key : $ADMIN_KEY, ligne $n, clé refusée par ssh-keygen : $line"
    fi
  done < <(grep -nE "$KEY_LINE" "$ADMIN_KEY")
  rm -f "$tmp"
  if getent passwd "$ADMIN_USER" >/dev/null; then
    home=$(getent passwd "$ADMIN_USER" | cut -d: -f6)
  fi
  ADMIN_KEYS=$(
    {
      [[ -z "$home" ]] || grep -v '^[[:space:]]*$' "$home/.ssh/authorized_keys" 2>/dev/null || true
      echo "$given"
    } | awk '!seen[$0]++'
  )
}

# The configuration in sshd_config.d applies only if the main file includes
# it (Ubuntu 24.04 does, at the top).
check_sshd_include() {
  [[ -f /etc/ssh/sshd_config ]] || die "/etc/ssh/sshd_config absent : OpenSSH (openssh-server) attendu"
  grep -Eq '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config ||
    die "/etc/ssh/sshd_config n'inclut pas /etc/ssh/sshd_config.d/*.conf : le durcissement serait sans effet"
}

# sshd keeps the first value it reads. A contrary hardening directive read
# before 00-crewdeck.conf (in sshd_config before the Include, or in a file of
# sshd_config.d sorted before ours) would win. In a Match block, wherever it
# is, it would replace the global value for the connections it names
# (« Match User root » then « PermitRootLogin yes »). AllowUsers lines add up
# instead: one anywhere but in ours would let another account in. Any Include
# other than sshd_config.d/*.conf is refused: the included file would not be
# checked. The machine is refused, on every run, before any change.
check_sshd_precedence() {
  local lus=(/etc/ssh/sshd_config) file conflicts LC_ALL=C
  while IFS= read -r file; do
    [[ -n "$file" && "$(basename "$file")" != "$SSHD_CONF" ]] && lus+=("$file")
  done < <(compgen -G "/etc/ssh/sshd_config.d/*.conf" | sort)
  conflicts=$(awk -v ours="$SSHD_CONF" -v widens="s'ajoute à AllowUsers $ADMIN_USER deploy" '
    # The next word of rest, split as strdelim (misc.c, OpenSSH) splits the
    # keyword: it ends at the first blank, quote or « = ». A quoted part sticks
    # to the word (Inc"lude"); an « = » is skipped, alone or after blanks.
    # nul: an unclosed quote, sshd then ignores the line.
    function strdelim(   i, c, tok) {
      if (!match(rest, /[ \t\r\n"=]/)) { tok = rest; rest = ""; return tok }
      i = RSTART; c = substr(rest, i, 1); tok = substr(rest, 1, i - 1)
      rest = substr(rest, i + 1)
      if (c == "\"") {
        if (!(i = index(rest, "\""))) { nul = 1; return "" }
        tok = tok substr(rest, 1, i - 1); rest = substr(rest, i + 1)
        sub(/^[ \t\r\n]+/, "", rest)
        return tok
      }
      sub(/^[ \t\r\n]+/, "", rest)
      if (c != "=" && substr(rest, 1, 1) == "=") { rest = substr(rest, 2); sub(/^[ \t\r\n]+/, "", rest) }
      return tok
    }
    BEGIN {
      want["permitrootlogin"] = "no"; want["passwordauthentication"] = "no"
      want["kbdinteractiveauthentication"] = "no"; want["challengeresponseauthentication"] = "no"
      want["pubkeyauthentication"] = "yes"; want["authenticationmethods"] = "publickey"
    }
    FNR == 1 {
      name = FILENAME; sub(/.*\//, "", name)
      main = (name == "sshd_config"); inmatch = 0
      # Read before ours: sshd_config up to the Include, and the files sorted
      # before 00-crewdeck.conf.
      before = main || name < ours
    }
    # As process_server_config_line (servconf.c) does: trailing blanks
    # removed, keyword read by strdelim, read again once if empty (leading
    # blanks or « = », ""Include""). Empty or starting with #, the line is
    # ignored. The value may be quoted and followed by a comment.
    {
      rest = $0; sub(/[ \t\r\n\f]+$/, "", rest); nul = 0
      key = strdelim()
      if (!nul && key == "") key = strdelim()
      if (nul || key == "" || substr(key, 1, 1) == "#") next
      key = tolower(key); val = rest
      sub(/[ \t]+#.*$/, "", val); gsub(/"/, "", val); gsub(/[ \t]+/, " ", val)
      # Paths keep their case (OpenSSH hands them as they are to glob); only
      # the values of the directives are compared regardless of case.
      path = val; val = tolower(val)
    }
    # Only the standard Include of Ubuntu is followed: another included file
    # (elsewhere, or from sshd_config.d) would escape the check.
    key == "include" && main && path == "/etc/ssh/sshd_config.d/*.conf" { before = 0; next }
    key == "include" { print FILENAME ": " $0 " (Include non pris en charge)"; next }
    key == "allowusers" { print FILENAME ": " $0 " (" widens ")"; next }
    key == "match" { inmatch = 1; next }
    (before || inmatch) && key in want && val != want[key] {
      print FILENAME ": " $0 (inmatch ? " (bloc Match)" : "")
    }
  ' "${lus[@]}")
  [[ -z "$conflicts" ]] ||
    die "$(printf 'directives sshd qui annuleraient le durcissement (lues avant %s, dans un bloc Match, AllowUsers hors du nôtre, ou dans un fichier inclus non contrôlé) :\n%s\nLes retirer, puis relancer' "$SSHD_CONF" "$conflicts")"
}

# The firewall opens only 22: an sshd listening elsewhere (Port 2222,
# ListenAddress …:2222) would become unreachable once ufw is enabled. Read
# from the effective configuration (sshd -T); a loopback address does not
# count.
check_sshd_port() {
  local effective
  # sshd -T needs it: the runtime directory sshd creates itself.
  mkdir -p /run/sshd
  effective=$(sshd -T 2>&1) || die "$(printf 'sshd -T a échoué : la configuration sshd est invalide.\n%s' "$effective")"
  awk '$1 == "listenaddress" && $2 ~ /:22$/ && $2 !~ /^(127\.|\[::1\])/ { found = 1 } END { exit !found }' <<<"$effective" ||
    die "$(printf 'sshd n'"'"'écoute pas sur le port 22 (Port, ListenAddress), seul port SSH ouvert par le pare-feu : on se couperait l'"'"'accès.\n%s\nRemettre le port 22, puis relancer' "$(grep -E '^(port|listenaddress) ' <<<"$effective" | sed 's/^/  /')")"
}

ufw_rule() {
  echo "### tuple ### allow ${1#*/} ${1%/*} 0.0.0.0/0 any 0.0.0.0/0 in"
}

ufw_rule6() {
  ufw_rule "$1" | sed 's|0\.0\.0\.0/0|::/0|g'
}

# A ufw allow rule outside 22, 80 and 443 opens a public port, and over
# IPv6 it also opens a port published by Docker: docker-proxy receives it
# through INPUT, where DOCKER-USER does not apply. Such a rule is not removed
# silently: the run is refused, before any change, until it is removed by
# hand.
check_foreign_rules() {
  local expected foreign spec
  expected=$(for spec in "${OPEN_PORTS[@]}"; do
    ufw_rule "$spec"
    ufw_rule6 "$spec"
  done)
  foreign=$(
    { cat /etc/ufw/user.rules /etc/ufw/user6.rules 2>/dev/null || true; } |
      { grep -E '^### tuple ### (route:)?(allow|limit) ' || true; } | { grep -vxF "$expected" || true; } |
      sed 's/^### tuple ### /  /'
  )
  [[ -z "$foreign" ]] ||
    die "$(printf 'règles ufw hors de 22, 80 et 443 (aucun autre port public) :\n%s\nLes retirer (ufw status numbered, puis ufw delete <n>), puis relancer' "$foreign")"
}

# Ubuntu's Docker (docker.io) and its neighbours fight over Docker CE's
# files: they are removed by hand, containers included, before running again.
check_docker_conflicts() {
  local found=() pkg
  for pkg in "${DOCKER_CONFLICTS[@]}"; do
    package_installed "$pkg" && found+=("$pkg")
  done
  ((${#found[@]} == 0)) ||
    die "paquets en conflit avec Docker CE (download.docker.com) : ${found[*]}. Les retirer (apt-get remove ${found[*]}), puis relancer"
}

# Docker hooks the DOCKER-USER chain only with its iptables firewall. With
# the nftables backend, iptables disabled or routed networks by default,
# published ports would get through.
check_docker_firewall() {
  local path=/etc/docker/daemon.json
  [[ -f "$path" ]] || return 0
  if grep -Eq '"firewall-backend"[[:space:]]*:[[:space:]]*"nftables"' "$path"; then
    die "$path : firewall-backend nftables, Docker ne passerait pas par DOCKER-USER. Retirer l'option, redémarrer Docker, puis relancer"
  fi
  if grep -Eq '"iptables"[[:space:]]*:[[:space:]]*false' "$path"; then
    die "$path : iptables désactivé, Docker ne passerait pas par DOCKER-USER. Retirer l'option, redémarrer Docker, puis relancer"
  fi
  if grep -Eq '"com\.docker\.network\.bridge\.gateway_mode_ipv[46]"[[:space:]]*:[[:space:]]*"(routed|nat-unprotected)"' "$path"; then
    die "$path : réseaux routed ou nat-unprotected par défaut, leurs ports publiés échapperaient à DOCKER-USER. Retirer l'option, redémarrer Docker, puis relancer"
  fi
  return 0
}

# --- 1. Admin account ---

# No password: key-only access, hence sudo without a password.
step_admin() {
  local home sudoers
  install_packages sudo
  if ! getent passwd "$ADMIN_USER" >/dev/null; then
    run useradd --create-home --shell /bin/bash --user-group "$ADMIN_USER"
    changed "compte $ADMIN_USER créé"
  fi
  home=$(getent passwd "$ADMIN_USER" | cut -d: -f6)
  if ensure_dir "$home/.ssh" 700 "$ADMIN_USER:$ADMIN_USER"; then
    changed "$home/.ssh"
  fi
  if write_file "$home/.ssh/authorized_keys" 600 "$ADMIN_USER:$ADMIN_USER" <<<"$ADMIN_KEYS"; then
    changed "clé SSH posée"
  fi
  sudoers=$(mktemp)
  echo "$ADMIN_USER ALL=(ALL) NOPASSWD:ALL" >"$sudoers"
  visudo -cqf "$sudoers" || die "règle sudo refusée par visudo : $(cat "$sudoers")"
  if write_file "/etc/sudoers.d/90-crewdeck-$ADMIN_USER" 440 root:root <"$sudoers"; then
    changed "sudo sans mot de passe"
  fi
  rm -f "$sudoers"
}

# --- 2. SSH ---

# Prefix 00: sshd keeps the first value it reads, before the provider's
# (50-cloud-init.conf sometimes turns passwords back on). AllowUsers already
# names deploy, the deployment's account (INFRA-6, install-access.sh).
sshd_hardening() {
  cat <<EOF
# Managed by infra/provision/provision.sh (INFRA-7): do not edit by hand.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
AllowUsers $ADMIN_USER deploy
MaxAuthTries 3
LoginGraceTime 20
X11Forwarding no
EOF
}

# The configuration is reloaded only once sshd -t validates it; refused,
# the previous file is put back and nothing is reloaded: the current session
# and the next ones keep the configuration that worked. A reload never cuts
# open sessions.
step_ssh() {
  local conf="/etc/ssh/sshd_config.d/$SSHD_CONF" backup="" errors
  if [[ -f "$conf" ]]; then
    backup=$(mktemp)
    cp -p "$conf" "$backup"
  fi
  if write_file "$conf" 644 root:root < <(sshd_hardening); then
    if ! errors=$(sshd -t 2>&1); then
      if [[ -n "$backup" ]]; then mv -f "$backup" "$conf"; else rm -f "$conf"; fi
      die "$(printf 'sshd -t refuse la configuration (rien n'"'"'a été rechargé, %s est remis comme avant) :\n%s' "$conf" "$errors")"
    fi
    run systemctl try-reload-or-restart ssh.service
    changed "clé seule, root refusé, AllowUsers $ADMIN_USER deploy"
  fi
  rm -f "$backup"
  check_sshd_effective
}

# On every run, even with no change: the file can be in place with no
# effect. -C: the configuration of a given connection, Match blocks included.
# Read whole: `sshd -T | grep -q` fails under pipefail when grep closes the
# pipe before the end (SIGPIPE).
check_sshd_effective() {
  local effective who allowed expected
  expected=$(printf 'allowusers %s\n' "$ADMIN_USER" deploy | sort -u)
  for who in root "$ADMIN_USER"; do
    effective=$(sshd -T -C "user=$who,host=localhost,addr=127.0.0.1")
    grep -qx 'passwordauthentication no' <<<"$effective" || die "sshd accepte encore les mots de passe pour $who : une autre configuration l'emporte"
    grep -qx 'kbdinteractiveauthentication no' <<<"$effective" || die "sshd accepte encore keyboard-interactive pour $who : une autre configuration l'emporte"
    grep -qx 'permitrootlogin no' <<<"$effective" || die "sshd accepte encore root (connexion de $who) : une autre configuration l'emporte"
    allowed=$({ grep '^allowusers ' <<<"$effective" || true; } | sort -u)
    [[ "$allowed" == "$expected" ]] ||
      die "sshd n'autorise pas exactement $ADMIN_USER et deploy (connexion de $who) : $(tr '\n' ' ' <<<"$allowed")"
  done
}

# --- 3. fail2ban ---

step_fail2ban() {
  local jail_changed=false
  # Written before the package: fail2ban starts with it.
  if write_file /etc/fail2ban/jail.d/crewdeck.local 644 root:root <<'EOF'; then
# Managed by infra/provision/provision.sh (INFRA-7): do not edit by hand.
[sshd]
enabled = true
backend = systemd
# The shipped filter reads only sshd.service and the sshd process: the
# unit is called ssh.service on Ubuntu, and OpenSSH 9.8+ authenticates in
# sshd-session.
journalmatch = _SYSTEMD_UNIT=ssh.service + _SYSTEMD_UNIT=sshd.service + _COMM=sshd + _COMM=sshd-session
maxretry = 5
findtime = 10m
bantime = 1h
EOF
    jail_changed=true
    changed "jail sshd (5 essais, banni 1 h)"
  fi
  install_packages fail2ban python3-systemd
  if ensure_service fail2ban; then
    changed "fail2ban activé"
  elif $jail_changed; then
    run systemctl restart fail2ban
  fi
}

# --- 4. Firewall ---

ufw_has_rule() {
  grep -qxF "$(ufw_rule "$1")" /etc/ufw/user.rules 2>/dev/null &&
    grep -qxF "$(ufw_rule6 "$1")" /etc/ufw/user6.rules 2>/dev/null
}

# 22 is allowed before enabling: the current session does not drop.
step_firewall() {
  local spec
  install_packages ufw
  if ! grep -qx 'DEFAULT_INPUT_POLICY="DROP"' /etc/default/ufw; then
    run ufw default deny incoming
    changed "entrées refusées par défaut"
  fi
  if ! grep -qx 'DEFAULT_OUTPUT_POLICY="ACCEPT"' /etc/default/ufw; then
    run ufw default allow outgoing
    changed "sorties permises par défaut"
  fi
  for spec in "${OPEN_PORTS[@]}"; do
    if ! ufw_has_rule "$spec"; then
      run ufw allow "$spec"
      changed "$spec ouvert"
    fi
  done
  if ! grep -qx 'ENABLED=yes' /etc/ufw/ufw.conf; then
    run ufw --force enable
    changed "ufw activé"
  fi
}

# --- 5. Docker ---

# Docker publishes its ports by DNAT, before ufw's input rules: without
# this chain, a `ports: "5432:5432"` would be open to the Internet. A
# connection from outside to a published port gets through only if it aimed
# at 80 or 443 on the host (--ctorigdstport: the original port, before the
# translation to the container). Docker networks between themselves, and
# replies, get through. Then refused: published ports (DNAT), whatever the
# bridge's name, and direct access to the bridges' containers. Declaring the
# chain empties it: iptables-restore --noflush replaces it, the rest intact.
docker_user_rules() {
  local spec
  echo '# Managed by infra/provision/provision.sh (INFRA-7), loaded by crewdeck-docker-user.service.'
  echo '*filter'
  echo ':DOCKER-USER - [0:0]'
  echo '-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN'
  echo '-A DOCKER-USER -i docker0 -j RETURN'
  echo '-A DOCKER-USER -i br-+ -j RETURN'
  for spec in "${DOCKER_OPEN_PORTS[@]}"; do
    echo "-A DOCKER-USER -p ${spec#*/} -m conntrack --ctorigdstport ${spec%/*} --ctdir ORIGINAL -j RETURN"
  done
  echo '-A DOCKER-USER -m conntrack --ctstate DNAT -j DROP'
  echo '-A DOCKER-USER -o docker0 -j DROP'
  echo '-A DOCKER-USER -o br-+ -j DROP'
  echo 'COMMIT'
}

# Docker recreates the chain empty on every start (a reboot): the unit
# reloads it after Docker, and with it (PartOf) when it restarts.
docker_user_unit() {
  cat <<EOF
# Managed by infra/provision/provision.sh (INFRA-7): do not edit by hand.
[Unit]
Description=Crewdeck: DOCKER-USER chain (published ports closed except 80 and 443)
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/iptables-restore --noflush $DOCKER_USER_RULES
ExecStart=/usr/sbin/ip6tables-restore --noflush $DOCKER_USER_RULES

[Install]
WantedBy=docker.service
EOF
}

# The effective chain, over IPv4 and IPv6, rule for rule and in order: the
# unit can be active and the chain changed since (flushed, or a rule put
# before the DROP, by hand or by another tool).
docker_user_loaded() {
  local expected v4 v6
  expected=$(
    echo '-N DOCKER-USER'
    docker_user_rules | grep -- '^-A '
  )
  v4=$(iptables -S DOCKER-USER 2>/dev/null) || return 1
  v6=$(ip6tables -S DOCKER-USER 2>/dev/null) || return 1
  [[ "$v4" == "$expected" && "$v6" == "$expected" ]]
}

# Logs in the local format (rotation included) and live-restore (containers
# survive a restart of dockerd), merged with the existing configuration.
# Returns 0 if daemon.json changed.
write_docker_daemon() {
  local path=/etc/docker/daemon.json before='{}' merged
  local wanted='{ "log-driver": "local", "live-restore": true }'
  [[ -s "$path" ]] && before=$(cat "$path")
  merged=$(jq -s '.[0] * .[1]' <(echo "$before") - <<<"$wanted") || die "$path illisible : JSON invalide"
  write_file "$path" 644 root:root <<<"$merged"
}

step_docker() {
  local daemon_changed=false unit_changed=false key
  install_packages ca-certificates curl jq
  if [[ ! -s /etc/apt/keyrings/docker.asc ]]; then
    key=$(mktemp)
    run curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$key"
    install -D -m 0644 "$key" /etc/apt/keyrings/docker.asc
    rm -f "$key"
    changed "clé de download.docker.com"
  fi
  if write_file /etc/apt/sources.list.d/docker.sources 644 root:root <<EOF; then
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $ARCH
Signed-By: /etc/apt/keyrings/docker.asc
EOF
    APT_FRESH=false
    changed "dépôt download.docker.com"
  fi
  # Written before the install: dockerd starts with it.
  if write_docker_daemon; then
    daemon_changed=true
    changed "daemon.json (log-driver local, live-restore)"
  fi
  if package_installed docker-ce; then
    install_packages "${DOCKER_PACKAGES[@]}"
    # Installed and running, it reloads its configuration live: live-restore
    # at once, the logs at the daemon's next start. Restarting it would cut the
    # containers.
    if $daemon_changed && systemctl is-active --quiet docker; then
      run dockerd --validate --config-file /etc/docker/daemon.json
      run systemctl reload docker
    fi
  else
    install_packages "${DOCKER_PACKAGES[@]}"
  fi
  if ensure_service docker; then
    changed "Docker activé"
  fi
  if ! id -nG "$ADMIN_USER" | tr ' ' '\n' | grep -qx docker; then
    run usermod -aG docker "$ADMIN_USER"
    changed "$ADMIN_USER dans le groupe docker"
  fi

  if write_file "$DOCKER_USER_RULES" 644 root:root < <(docker_user_rules); then
    unit_changed=true
    changed "chaîne DOCKER-USER (seuls 80 et 443 publiés)"
  fi
  if write_file "/etc/systemd/system/$DOCKER_USER_UNIT" 644 root:root < <(docker_user_unit); then
    unit_changed=true
    run systemctl daemon-reload
    changed "$DOCKER_USER_UNIT"
  fi
  if ! systemctl is-enabled --quiet "$DOCKER_USER_UNIT" 2>/dev/null; then
    run systemctl enable "$DOCKER_USER_UNIT"
    unit_changed=true
    changed "$DOCKER_USER_UNIT activé"
  fi
  if $unit_changed || ! systemctl is-active --quiet "$DOCKER_USER_UNIT"; then
    run systemctl restart "$DOCKER_USER_UNIT"
  elif ! docker_user_loaded; then
    run systemctl restart "$DOCKER_USER_UNIT"
    changed "chaîne DOCKER-USER rechargée"
  fi
  docker_user_loaded || die "la chaîne DOCKER-USER n'est pas chargée ($DOCKER_USER_UNIT) : les ports publiés seraient ouverts"
  # Docker hooks DOCKER-USER only with its iptables firewall: never a
  # success with a chain that has no effect. Read whole (SIGPIPE under
  # pipefail).
  local forward
  forward=$(iptables -S FORWARD)
  grep -q -- '-j DOCKER-USER' <<<"$forward" ||
    die "Docker ne fait pas passer ses ports publiés par DOCKER-USER : ils échapperaient au pare-feu"
}

# --- 6. Security updates ---

# Daily, from the security origins only, with no automatic reboot: an
# updated kernel waits for a chosen reboot.
step_upgrades() {
  local timer
  install_packages unattended-upgrades
  if write_file /etc/apt/apt.conf.d/20auto-upgrades 644 root:root <<'EOF'; then
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
    changed "mises à jour quotidiennes"
  fi
  # Read after 50unattended-upgrades: #clear replaces its list of origins.
  if write_file /etc/apt/apt.conf.d/52crewdeck-unattended-upgrades 644 root:root <<'EOF'; then
// Managed by infra/provision/provision.sh (INFRA-7): do not edit by hand.
#clear Unattended-Upgrade::Allowed-Origins;
Unattended-Upgrade::Allowed-Origins {
  "${distro_id}:${distro_codename}-security";
  "${distro_id}ESMApps:${distro_codename}-apps-security";
  "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
EOF
    changed "sécurité seulement, sans redémarrage automatique"
  fi
  for timer in apt-daily.timer apt-daily-upgrade.timer; do
    if ensure_service "$timer"; then
      changed "$timer activé"
    fi
  done
}

# --- 7. Tree and network ---

# What the Compose projects expect (infra/deploy/README.md): readable by
# the docker group (the deploy account, INFRA-6), closed to the others.
step_tree() {
  local dir
  for dir in /opt/crewdeck /opt/crewdeck/{deploy,prod,staging,edge,backup}; do
    if ensure_dir "$dir" 750 root:docker; then
      changed "$dir"
    fi
  done
  if ! docker network inspect crewdeck-edge >/dev/null 2>&1; then
    run docker network create crewdeck-edge
    changed "réseau crewdeck-edge"
  fi
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --admin-user) ADMIN_USER="${2:?--admin-user attend un nom de compte}"; shift 2 ;;
      --admin-key) ADMIN_KEY="${2:?--admin-key attend un fichier de clés publiques}"; shift 2 ;;
      -h | --help) usage ;;
      *) die "option inconnue : $1" ;;
    esac
  done

  check_os
  ((EUID == 0)) || die "à lancer en root (sudo)"
  check_arch
  check_admin
  collect_keys
  check_sshd_include
  check_sshd_precedence
  check_sshd_port
  check_foreign_rules
  check_docker_conflicts
  check_docker_firewall

  step 1 "Compte d'administration" step_admin
  step 2 "SSH" step_ssh
  step 3 "fail2ban" step_fail2ban
  step 4 "Pare-feu ufw" step_firewall
  step 5 "Docker" step_docker
  step 6 "Mises à jour de sécurité" step_upgrades
  step 7 "Arborescence /opt/crewdeck et réseau crewdeck-edge" step_tree

  if ((APPLIED == 0)); then
    echo "rien à changer"
  else
    echo "$APPLIED étape(s) sur $STEPS appliquée(s) : ouvrir une session ssh $ADMIN_USER@<machine> avant de fermer celle-ci"
  fi
}

main "$@"
