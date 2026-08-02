#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Lance ce script avec root : sudo bash <(curl -fsSL …)"
  exit 1
fi

APP_DIR="/opt/suivi-stages"
REPO_URL="https://github.com/Sugawafr/suivi-stages.git"

apt-get update
apt-get install -y git python3 python3-venv python3-pip

rm -rf "$APP_DIR"
git clone --depth 1 "$REPO_URL" "$APP_DIR"
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip pypdf

cat > /etc/systemd/system/suivi-stages.service <<'EOF'
[Unit]
Description=Suivi des stages
After=network.target

[Service]
WorkingDirectory=/opt/suivi-stages
ExecStart=/opt/suivi-stages/.venv/bin/python /opt/suivi-stages/server.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now suivi-stages

echo "Installation terminée. Ouvre : http://IP_DU_CONTENEUR:4177"
