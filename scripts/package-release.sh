#!/usr/bin/env bash
# Build dist/WeiDu-<version>.zip from tracked files. Does not publish anything.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: scripts/package-release.sh <version>" >&2
  echo "Example: scripts/package-release.sh 0.1.0" >&2
  exit 1
fi

version="${1#v}"
case "$version" in
  ""|.*|*..*|*[!0-9A-Za-z._+-]*)
    echo "Version must look like 0.1.0. Got: $1" >&2
    exit 1
    ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
name="WeiDu-${version}"
stage="$(mktemp -d)"
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT

git -C "$root" archive --format=tar --prefix="${name}/" HEAD | tar -x -C "$stage"

cat > "${stage}/${name}/START-HERE.txt" << 'EOF'
围读（WeiDu）

1. 把这个压缩包解压到一个文件夹。
2. 从 https://nodejs.org/ 安装 Node.js LTS。
3. 双击 start.bat。
4. 浏览器会打开 http://127.0.0.1:4721。
5. 不填 Key 也能把三个步骤点完，看到的是占位文字。
6. 要用真正的模型出字，到设置里填上你的 API。

English

1. Unpack this zip into a folder.
2. Install Node.js LTS from https://nodejs.org/.
3. Double-click start.bat.
4. The browser opens at http://127.0.0.1:4721.
5. No key is needed to click through the three steps. You get placeholder text.
6. Put your real API in Settings.
EOF

required=(
  START-HERE.txt
  start.bat
  start.ps1
  start.sh
  .env.example
  README.md
  SETUP.md
  package.json
  package-lock.json
)
for file in "${required[@]}"; do
  if [[ ! -f "${stage}/${name}/${file}" ]]; then
    echo "Missing ${file} in the archive." >&2
    exit 1
  fi
done

if [[ -d "${stage}/${name}/node_modules" || -d "${stage}/${name}/.next" || -d "${stage}/${name}/data" || -f "${stage}/${name}/.env" ]]; then
  echo "The archive contains node_modules, .next, data, or .env. Refusing to pack it." >&2
  exit 1
fi

mkdir -p "${root}/dist"
out="${root}/dist/${name}.zip"
rm -f "$out"
(cd "$stage" && zip -r -X "$out" "$name" >/dev/null)
echo "$out"
