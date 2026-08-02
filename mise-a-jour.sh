#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/suivi-stages"
BACKUP_DIR="/var/backups/suivi-stages"

cd "$APP_DIR"
git pull --ff-only
apt-get update
apt-get install -y cron

install -d -m 700 "$BACKUP_DIR"
cat > /usr/local/sbin/sauvegarde-suivi-stages <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
install -d -m 700 /var/backups/suivi-stages
cp /opt/suivi-stages/stages.db "/var/backups/suivi-stages/stages-$(date +%F).db"
find /var/backups/suivi-stages -type f -name 'stages-*.db' -mtime +30 -delete
EOF
chmod 700 /usr/local/sbin/sauvegarde-suivi-stages
echo '15 3 * * * root /usr/local/sbin/sauvegarde-suivi-stages' > /etc/cron.d/suivi-stages-backup
systemctl enable --now cron
systemctl restart suivi-stages
echo "Mise à jour terminée. Sauvegarde quotidienne à 03h15 dans $BACKUP_DIR."
