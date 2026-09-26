#!/bin/bash

DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  💬  正在打开电脑版聊天端…"
echo ""

if ! curl -s -m 3 "http://127.0.0.1:8787/ping" > /dev/null 2>&1; then
  echo "  ⚠ 服务端没在跑。"
  echo ""
  echo "  请先做这一步："
  echo "      双击「启动HomeChat.command」"
  echo "      等终端打印出那个方框（里面有局域网地址）"
  echo "      然后保持那个窗口开着，再回来双击这个文件。"
  echo ""
  read -n 1 -s -r -p "  按任意键关闭…"
  exit 1
fi

open "http://127.0.0.1:8787"

echo "  ✔ 浏览器已经打开。"
echo ""
echo "     地址：http://127.0.0.1:8787"
echo "     密码：$(cd "$DIR" && node server/src/showpass.js 2>/dev/null || echo '(读不到，去 data/config.local.json 看)')"
echo ""
echo "  （这个窗口可以关掉了）"
sleep 2
