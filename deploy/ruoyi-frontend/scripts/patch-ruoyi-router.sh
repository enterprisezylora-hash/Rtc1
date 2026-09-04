#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACK_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

TARGET_ROOT="${1:-}"
if [[ -z "$TARGET_ROOT" ]]; then
  echo "Usage: $0 <path-to-ruoyi-frontend-project>"
  exit 1
fi

if [[ ! -d "$TARGET_ROOT" ]]; then
  echo "Target directory not found: $TARGET_ROOT"
  exit 1
fi

ROUTER_FILE=""
if [[ -f "$TARGET_ROOT/src/router/index.js" ]]; then
  ROUTER_FILE="$TARGET_ROOT/src/router/index.js"
elif [[ -f "$TARGET_ROOT/src/router/index.ts" ]]; then
  ROUTER_FILE="$TARGET_ROOT/src/router/index.ts"
else
  echo "Router main file not found in target. Expected src/router/index.js or src/router/index.ts"
  exit 1
fi

MODULE_DST="$TARGET_ROOT/src/router/modules/rco.js"
mkdir -p "$(dirname -- "$MODULE_DST")"
cp "$PACK_ROOT/src/router/modules/rco.js" "$MODULE_DST"

echo "Copied module: $MODULE_DST"

if ! rg -q "from './modules/rco'|from \"./modules/rco\"" "$ROUTER_FILE"; then
  TMP_FILE="$(mktemp)"
  awk '
    {
      lines[NR] = $0
      if ($0 ~ /^import[[:space:]]/) {
        lastImport = NR
      }
    }
    END {
      if (lastImport == 0) {
        print "import rcoRouter from '\''./modules/rco'\''"
        for (i = 1; i <= NR; i++) {
          print lines[i]
        }
      } else {
        for (i = 1; i <= NR; i++) {
          print lines[i]
          if (i == lastImport) {
            print "import rcoRouter from '\''./modules/rco'\''"
          }
        }
      }
    }
  ' "$ROUTER_FILE" > "$TMP_FILE"
  mv "$TMP_FILE" "$ROUTER_FILE"
  echo "Patched import in: $ROUTER_FILE"
else
  echo "Import already present in: $ROUTER_FILE"
fi

route_entry_present=0
if rg -q "^[[:space:]]*rcoRouter[[:space:]]*,?[[:space:]]*$" "$ROUTER_FILE"; then
  route_entry_present=1
  echo "Route entry already present in: $ROUTER_FILE"
fi

insert_into_array() {
  local array_name="$1"
  local file="$2"
  local tmp_file
  tmp_file="$(mktemp)"

  set +e
  awk -v decl="export const ${array_name}" '
    BEGIN {
      inserted = 0
    }
    {
      print $0
      if (inserted == 0 && $0 ~ decl"[[:space:]]*=[[:space:]]*\\[") {
        print "  rcoRouter,"
        inserted = 1
      }
    }
    END {
      if (inserted == 0) {
        exit 10
      }
    }
  ' "$file" > "$tmp_file"
  local status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    mv "$tmp_file" "$file"
    return 0
  fi

  rm -f "$tmp_file"
  return 1
}

if [[ $route_entry_present -eq 0 ]]; then
  if insert_into_array "asyncRoutes" "$ROUTER_FILE"; then
    echo "Inserted rcoRouter into asyncRoutes: $ROUTER_FILE"
  elif insert_into_array "constantRoutes" "$ROUTER_FILE"; then
    echo "Inserted rcoRouter into constantRoutes: $ROUTER_FILE"
  else
    echo "Could not find asyncRoutes or constantRoutes declaration in: $ROUTER_FILE"
    exit 1
  fi
fi

validate_patch() {
  local fail_count=0

  if [[ ! -f "$MODULE_DST" ]]; then
    echo "VALIDATION FAIL: module file missing at $MODULE_DST"
    fail_count=$((fail_count + 1))
  fi

  if ! rg -q "import[[:space:]]+rcoRouter[[:space:]]+from[[:space:]]+['\"]\\./modules/rco['\"]" "$ROUTER_FILE"; then
    echo "VALIDATION FAIL: import rcoRouter not found in $ROUTER_FILE"
    fail_count=$((fail_count + 1))
  fi

  if ! rg -q "^[[:space:]]*rcoRouter[[:space:]]*,?[[:space:]]*$" "$ROUTER_FILE"; then
    echo "VALIDATION FAIL: rcoRouter is not registered in route arrays in $ROUTER_FILE"
    fail_count=$((fail_count + 1))
  fi

  if [[ $fail_count -gt 0 ]]; then
    echo "Patch completed with validation errors: $fail_count"
    return 1
  fi

  echo "VALIDATION OK: module copied, import present, route entry registered."
  return 0
}

validate_patch
echo "Done. rcoRouter is auto-registered in target router main file."
