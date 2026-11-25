#!/usr/bin/env bash
# 剧本工作台 3.0 (Next.js 16.4.6) Linux 正式发布脚本
# 用法：
#   ./deploy/deploy-linux.sh --dry-run      # 仅预检，不修改线上软链或重启服务
#   ./deploy/deploy-linux.sh                # 安装依赖、构建、跑核心自检、原子切换并重启
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

BASE_DIR="${BASE_DIR:-/opt/studio-workbench-3}"
NODE_BIN_DIR="${NODE_BIN_DIR:-$BASE_DIR/.runtime/node/bin}"
export PATH="$NODE_BIN_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SHARED_DIR="$BASE_DIR/shared"
SERVICE_NAME="${SERVICE_NAME:-studio-workbench}"
PORT="${PORT:-3199}"

echo "[1/7] 校验 Node.js 版本 (要求 >=20.9.0)..."
NODE_VER="$(node -v | sed 's/^v//')"
NODE_MAJOR="$(echo "$NODE_VER" | cut -d. -f1)"
NODE_MINOR="$(echo "$NODE_VER" | cut -d. -f2)"
if (( NODE_MAJOR < 20 || (NODE_MAJOR == 20 && NODE_MINOR < 9) )); then
  echo "ERROR: 当前 Node.js v$NODE_VER 不满足 Next.js 16.4.6 最低要求 (>=20.9.0)" >&2
  exit 1
fi
echo "  OK: Node.js v$NODE_VER ($(command -v node))"

echo "[2/7] 校验目录、共享环境文件与 ffmpeg 可用性..."
mkdir -p "$SHARED_DIR/.data" "$SHARED_DIR/.private-transcribe-evidence" "$BASE_DIR/backups"
chmod 700 "$SHARED_DIR/.private-transcribe-evidence"
if [[ ! -f "$SHARED_DIR/.env" ]]; then
  echo "WARN: 未找到 $SHARED_DIR/.env，请先从 deploy/env.production.example 复制并设置 chmod 600"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    cp "$APP_DIR/deploy/env.production.example" "$SHARED_DIR/.env"
    chmod 600 "$SHARED_DIR/.env"
    echo "  已生成默认模板至 $SHARED_DIR/.env，请部署后检查参数。"
  fi
fi

if command -v ffmpeg >/dev/null 2>&1; then
  echo "  OK: 系统 ffmpeg 可用 ($(command -v ffmpeg))"
else
  echo "  INFO: 系统未装 ffmpeg，将自动使用内置 ffmpeg-static 二进制。"
fi

echo "[3/7] 安装生产依赖并校验安全审计..."
cd "$APP_DIR"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "  [dry-run] 跳过 npm ci / npm run build"
else
  npm ci --no-audit --no-fund
  npm audit --omit=dev
fi

echo "[4/7] 备份当前共享数据并挂载共享持久化目录..."
if [[ -f "$SHARED_DIR/.data/studio-store.json" ]]; then
  BACKUP_FILE="$BASE_DIR/backups/studio-store.$(date +%Y%m%d_%H%M%S).json"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    cp -a "$SHARED_DIR/.data/studio-store.json" "$BACKUP_FILE"
    chmod 600 "$BACKUP_FILE"
    echo "  OK: 已备份至 $BACKUP_FILE"
  else
    echo "  [dry-run] 计划备份至 $BACKUP_FILE"
  fi
fi

if [[ "$DRY_RUN" -eq 0 ]]; then
  if [[ ! -L "$APP_DIR/.data" ]]; then
    rm -rf "$APP_DIR/.data"
    ln -s "$SHARED_DIR/.data" "$APP_DIR/.data"
  fi
  if [[ ! -L "$APP_DIR/.private-transcribe-evidence" ]]; then
    rm -rf "$APP_DIR/.private-transcribe-evidence"
    ln -s "$SHARED_DIR/.private-transcribe-evidence" "$APP_DIR/.private-transcribe-evidence"
  fi
fi

echo "[5/7] 运行核心离线自检与生产构建..."
if [[ "$DRY_RUN" -eq 0 ]]; then
  node tests/step3-v72-body-format.mjs
  node tests/step3-transfer-attachment-integrity.mjs
  node tests/step5-production-arch.mjs
  node tests/step6-creative-workflows.mjs
  node tests/step7-commerce-admin-e2e.mjs
  node tests/step8-hardening-and-ai-command.mjs
  npm run build
else
  echo "  [dry-run] 计划运行核心离线测试与 npm run build"
fi

echo "[6/7] 切换当前发布软链并重启单进程 systemd 服务..."
RELEASE_ROOT="$(cd "$APP_DIR/.." && pwd)"
if [[ "$DRY_RUN" -eq 0 ]]; then
  ln -sfn "$RELEASE_ROOT" "$BASE_DIR/current"
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q "^${SERVICE_NAME}\.service"; then
    systemctl daemon-reload
    systemctl restart "${SERVICE_NAME}.service"
  else
    echo "WARN: 未检测到 ${SERVICE_NAME}.service，请参考 deploy/studio-workbench.service 安装 systemd 单元。"
  fi
else
  echo "  [dry-run] 计划切换 $BASE_DIR/current -> $RELEASE_ROOT 并重启 ${SERVICE_NAME}.service"
fi

echo "[7/7] 本地健康检查 (http://127.0.0.1:${PORT})..."
if [[ "$DRY_RUN" -eq 0 ]]; then
  sleep 2
  for route in "/login" "/studio" "/breakdown" "/purchase" "/orders" "/subscriptions"; do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}${route}")"
    if [[ "$CODE" != "200" ]]; then
      echo "ERROR: 健康检查失败 ${route} -> HTTP ${CODE}" >&2
      exit 1
    fi
    echo "  OK: GET ${route} -> HTTP 200"
  done

  MAIN_ADMIN_PAGE_CODE="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: cryptoayin.cn' "http://127.0.0.1:${PORT}/admin")"
  if [[ "$MAIN_ADMIN_PAGE_CODE" != "404" ]]; then
    echo "ERROR: 主站 Host 隔离校验失败 cryptoayin.cn/admin -> HTTP ${MAIN_ADMIN_PAGE_CODE} (期望 404)" >&2
    exit 1
  fi
  echo "  OK: Host: cryptoayin.cn GET /admin -> HTTP 404"

  MAIN_ADMIN_API_CODE="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: cryptoayin.cn' "http://127.0.0.1:${PORT}/api/admin")"
  if [[ "$MAIN_ADMIN_API_CODE" != "404" ]]; then
    echo "ERROR: 主站 Host 隔离校验失败 cryptoayin.cn/api/admin -> HTTP ${MAIN_ADMIN_API_CODE} (期望 404)" >&2
    exit 1
  fi
  echo "  OK: Host: cryptoayin.cn GET /api/admin -> HTTP 404"

  SUB_ADMIN_ROOT_CODE="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: admin.cryptoayin.cn' "http://127.0.0.1:${PORT}/")"
  if [[ "$SUB_ADMIN_ROOT_CODE" != "200" ]]; then
    echo "ERROR: 独立后台 Host 校验失败 admin.cryptoayin.cn/ -> HTTP ${SUB_ADMIN_ROOT_CODE} (期望 200)" >&2
    exit 1
  fi
  echo "  OK: Host: admin.cryptoayin.cn GET / -> HTTP 200"

  echo "DEPLOY_SUCCESS: 剧本工作台已上线并健康运行在 127.0.0.1:${PORT}"
else
  echo "DRY_RUN_OK: 预检通过。"
fi
