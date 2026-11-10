#!/usr/bin/env bash
# Build dist/WeiDu-<version>.zip, the developer source archive. Does not publish.
# End users should download a platform package from the GitHub release instead.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: scripts/package-release.sh <version>" >&2
  echo "Example: scripts/package-release.sh 0.1.0" >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node "${root}/scripts/release-pack.mjs" validate-version "$1")"
name="WeiDu-${version}"
stage="$(mktemp -d)"
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT

git -C "$root" archive --format=tar --prefix="${name}/" HEAD | tar -x -C "$stage"

cat > "${stage}/${name}/START-HERE.txt" << 'EOF'
围读（WeiDu）源码包

这是给开发者的源码，不是免安装的程序包。
要用免安装版，到 GitHub Releases 下载和系统匹配的压缩包（windows-amd64、windows-arm64、linux-amd64、linux-arm64），解压后运行 WeiDu.exe 或 ./weidu。不用安装 Node.js。

从源码运行：

1. 把这个压缩包解压到一个文件夹。
2. 从 https://nodejs.org/ 安装 Node.js LTS（20.9 或更新）。
3. Windows 双击 start.bat。macOS / Linux 运行 ./start.sh。
4. 浏览器会打开 http://127.0.0.1:4721。
5. 不填 Key 也能把三个步骤点完，看到的是占位文字。
6. 要用真正的模型出字，到设置里填上你的 API。

English

This zip is the source tree for developers, not the no-install package.
For that, download the matching archive from GitHub Releases (windows-amd64, windows-arm64, linux-amd64, or linux-arm64), unpack it, and run WeiDu.exe or ./weidu. Node.js is already included.

To run from source:

1. Unpack this zip into a folder.
2. Install Node.js LTS (20.9 or newer) from https://nodejs.org/.
3. On Windows, double-click start.bat. On macOS or Linux, run ./start.sh.
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
