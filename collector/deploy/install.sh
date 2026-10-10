#!/usr/bin/env bash
# Installer eller oppdater innsamlaren frå det offentlege repoet. Køyr som root på serveren:
#   sudo bash install.sh [ref]     (ref = grein eller commit, standard main)
# Kode i /opt/fergeruter/app (root eig, fergeruter les), data i /var/lib/fergeruter,
# oppsett i /etc/fergeruter/collector.env. Avsendaren til Cloudflare blir ikkje slått på.
set -euo pipefail
REF="${1:-main}"
REPO="https://github.com/teitrand/ferjeruter-react.git"
APP=/opt/fergeruter/app
ENV_FILE=/etc/fergeruter/collector.env

node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || { echo "Treng Node >= 22.13 (køyr install-node.sh)"; exit 1; }
id fergeruter >/dev/null

# Root eig koden. Ei eksisterande mappe (t.d. tom og eigd av fergeruter frå ei tidlegare
# oppsetjing) gav «dubious ownership» frå git; difor chown før git og safe.directory på
# kvart kall, så ei fersk køyring går utan handarbeid.
git_app() { git -c safe.directory="$APP" -C "$APP" "$@"; }
if [ ! -d "$APP/.git" ]; then
  if [ -n "$(ls -A "$APP" 2>/dev/null)" ]; then
    mv "$APP" "$APP.old-$(date +%Y%m%d%H%M%S)"
  fi
  install -d -o root -g root -m 0755 "$APP"
  git -c safe.directory="$APP" clone --quiet "$REPO" "$APP"
fi
chown root:root "$APP"
git_app fetch --quiet --depth 50 origin "$REF"
git_app checkout --quiet --detach FETCH_HEAD
git_app rev-parse --short HEAD > "$APP/VERSION"
# Berre innsamlaren (ingen React/Vite frå resten av arbeidsområdet) på serveren.
(cd "$APP" && npm ci --omit=dev -w collector --ignore-scripts --no-audit --no-fund --loglevel=warn)
chown -R root:root "$APP"
chmod -R u=rwX,go=rX "$APP"

install -d -o root -g fergeruter -m 0750 /etc/fergeruter
if [ ! -f "$ENV_FILE" ]; then
  install -o root -g fergeruter -m 0640 "$APP/collector/systemd/collector.env.example" "$ENV_FILE"
fi
install -d -o fergeruter -g fergeruter -m 0750 /var/lib/fergeruter

for unit in fergeruter-collector.service fergeruter-compare.service fergeruter-compare.timer fergeruter-signaltur.service fergeruter-signaltur.timer; do
  install -o root -g root -m 0644 "$APP/collector/systemd/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --quiet fergeruter-collector.service fergeruter-compare.timer fergeruter-signaltur.timer
systemctl restart fergeruter-collector.service
systemctl start fergeruter-compare.timer
systemctl start fergeruter-signaltur.timer
sleep 5
systemctl --no-pager --lines=0 status fergeruter-collector.service || true
echo "versjon: $(cat "$APP/VERSION")"
