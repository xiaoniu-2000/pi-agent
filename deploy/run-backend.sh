#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "Missing $SCRIPT_DIR/.env; copy .env.example to .env and edit it first" >&2
  exit 1
fi

read_env_value() {
  awk -v key="$1" '
    index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }
  ' "$SCRIPT_DIR/.env"
}

ENV_BACKEND_PORT=$(read_env_value PI_WEB_BACKEND_PORT)
ENV_CONTAINER_NAME=$(read_env_value PI_WEB_CONTAINER_NAME)
ENV_BACKEND_IMAGE=$(read_env_value PI_WEB_BACKEND_IMAGE)
BACKEND_PORT=${PI_WEB_BACKEND_PORT:-${ENV_BACKEND_PORT:-30142}}
CONTAINER_NAME=${PI_WEB_CONTAINER_NAME:-${ENV_CONTAINER_NAME:-pi-web-separated-backend}}
BACKEND_IMAGE=${PI_WEB_BACKEND_IMAGE:-${ENV_BACKEND_IMAGE:-pi-web-separated-backend:0.1.0}}

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  --env-file "$SCRIPT_DIR/.env" \
  -e PORT=30142 \
  -e HOSTNAME=0.0.0.0 \
  -e PI_CODING_AGENT_DIR=/data/pi-agent \
  -e PI_WEB_USER_DATA_ROOT=/data/users \
  -p "$BACKEND_PORT:30142" \
  -v "$SCRIPT_DIR/runtime/pi-agent:/data/pi-agent" \
  -v "$SCRIPT_DIR/runtime/user-data:/data/users" \
  -v "$SCRIPT_DIR/extensions/python_sandbox:/data/pi-agent/extensions/python_sandbox:ro" \
  "$BACKEND_IMAGE"
