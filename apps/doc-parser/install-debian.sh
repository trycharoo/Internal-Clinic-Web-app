#!/bin/sh
set -eu

service_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install_dir=/data/home/doc-parser
service_user=${SERVICE_USER:-${SUDO_USER:-$(id -un)}}

mkdir -p "$install_dir"
if [ "$service_dir" != "$install_dir" ]; then
  cp -a "$service_dir"/. "$install_dir"/
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y tesseract-ocr poppler-utils libgl1 python3 python3-venv openssl
python3 -m venv "$install_dir/venv"
"$install_dir/venv/bin/pip" install --upgrade pip
"$install_dir/venv/bin/pip" install -r "$install_dir/requirements.txt"

if [ ! -f "$install_dir/.env" ]; then
  (umask 077; printf 'APP_API_KEY=%s\n' "$(openssl rand -hex 16)" > "$install_dir/.env")
fi
chmod 600 "$install_dir/.env"
chown -R "$service_user:$service_user" "$install_dir"
cp "$install_dir/doc-parser.service" /etc/systemd/system/doc-parser@.service
systemctl daemon-reload
systemctl enable --now "doc-parser@${service_user}.service"
systemctl --no-pager --full status "doc-parser@${service_user}.service"
