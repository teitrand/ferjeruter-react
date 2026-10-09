#!/usr/bin/env bash
# Node 24 LTS frå NodeSource sitt apt-arkiv (signert), med automatiske tryggleiksoppdateringar
# via unattended-upgrades. Køyr som root på serveren. Trygt å køyre fleire gonger.
set -euo pipefail
MAJOR="${NODE_MAJOR:-24}"
export DEBIAN_FRONTEND=noninteractive

apt-get update -q
apt-get install -y -q ca-certificates curl gnupg
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
chmod 0644 /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${MAJOR}.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list
# NodeSource vinn over Ubuntu sin eldre nodejs-pakke.
cat > /etc/apt/preferences.d/nodesource <<'PIN'
Package: nodejs
Pin: origin deb.nodesource.com
Pin-Priority: 600
PIN
# Patch-versjonar (24.x) kjem med unattended-upgrades som resten av systemet.
cat > /etc/apt/apt.conf.d/52fergeruter-nodesource <<'UU'
Unattended-Upgrade::Origins-Pattern { "site=deb.nodesource.com"; };
UU
apt-get update -q
apt-get install -y -q nodejs
node -v
npm -v
