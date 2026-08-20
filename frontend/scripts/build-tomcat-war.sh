#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FRONTEND_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
WEBAPP_DIR="$FRONTEND_DIR/dist/tomcat-webapp"
WAR_NAME=${WAR_NAME:-ROOT}
WAR_PATH="$FRONTEND_DIR/dist/$WAR_NAME.war"

cd "$FRONTEND_DIR"
npm run build

rm -rf "$WEBAPP_DIR"
mkdir -p "$WEBAPP_DIR/WEB-INF"
cp -R "$FRONTEND_DIR/out/." "$WEBAPP_DIR/"
cp "$FRONTEND_DIR/tomcat/WEB-INF/web.xml" "$WEBAPP_DIR/WEB-INF/web.xml"

# The default config automatically uses the page hostname with backend port
# 30142. Keep this override only for deployments where the API uses another
# hostname or port; the login page never asks end users for a backend address.
if [ -n "${PI_WEB_API_BASE_URL:-}" ]; then
  API_BASE_URL_JSON=$(node -p 'JSON.stringify(process.env.PI_WEB_API_BASE_URL)')
  printf 'window.PI_WEB_CONFIG = { apiBaseUrl: %s };\n' "$API_BASE_URL_JSON" \
    > "$WEBAPP_DIR/config.js"
fi

rm -f "$WAR_PATH"
if command -v zip >/dev/null 2>&1; then
  (cd "$WEBAPP_DIR" && zip -qr "$WAR_PATH" .)
elif command -v jar >/dev/null 2>&1 && (cd "$WEBAPP_DIR" && jar --create --file "$WAR_PATH" .); then
  :
else
  echo "需要 JDK 的 jar 命令或 zip 命令来生成 WAR" >&2
  exit 1
fi

echo "$WAR_PATH"
