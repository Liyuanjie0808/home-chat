#!/bin/bash

set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || { echo "❌ 进不去目录：$DIR"; read -n 1 -s -r -p "按任意键关闭…"; exit 1; }

clear
echo ""
echo "  🏠  Home Chat"
echo "  ────────────────────────────────────────────"
echo ""

NODE=""
for cand in \
  "$(command -v node 2>/dev/null)" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  /usr/bin/node \
  "$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin/node"
do
  if [ -n "$cand" ] && [ -x "$cand" ]; then NODE="$cand"; break; fi
done

if [ -z "$NODE" ]; then
  echo "  ❌ 没找到 Node.js"
  echo ""
  echo "     请先装 Node："
  echo "       方法一（推荐）：  brew install node"
  echo "       方法二：          去 https://nodejs.org 下载 macOS 安装包"
  echo ""
  read -n 1 -s -r -p "  按任意键关闭…"
  exit 1
fi

NODEVER="$("$NODE" -v 2>/dev/null)"
echo "  ✔ Node.js $NODEVER"

cd "$DIR/server" || { echo "  ❌ 找不到 server 目录"; read -n 1 -s -r -p "按任意键关闭…"; exit 1; }

if [ ! -d "node_modules/ws" ]; then
  echo "  ⚠ 还差一个依赖（ws，约 200KB）"
  echo ""
  echo "     请先在这个目录里装一下："
  echo "       cd \"$DIR/server\""
  echo "       npm install"
  echo ""
  echo "     （项目里已经配好国内镜像，不用梯子）"
  echo ""
  read -n 1 -s -r -p "  按任意键关闭…"
  exit 1
fi
echo "  ✔ 依赖就绪"

echo ""
"$NODE" src/selftest.js
if [ $? -ne 0 ]; then
  echo "  ❌ 自检没通过，先别启动。把上面的红字发给我。"
  echo ""
  read -n 1 -s -r -p "  按任意键关闭…"
  exit 1
fi

exec "$NODE" src/index.js
