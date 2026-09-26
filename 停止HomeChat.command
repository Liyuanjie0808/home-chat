#!/bin/bash

clear
echo ""
echo "  🏠  Home Chat — 停止服务"
echo "  ────────────────────────────────────────────"
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"
PIDS="$(ps ax -o pid=,command= 2>/dev/null | grep -F "home-chat/server/src/index.js" | grep -v grep | awk '{print $1}')"

if [ -z "$PIDS" ]; then
  echo "  没有正在跑的 Home Chat 服务端。"
  echo "  （端口应该本来就是空的）"
  echo ""
  read -n 1 -s -r -p "  按任意键关闭…"
  exit 0
fi

echo "  找到进程： $PIDS"
for p in $PIDS; do
  kill -INT "$p" 2>/dev/null
done

sleep 1
echo "  ✔ 已发送停止信号，端口已释放。"
echo "    别人现在连不上了。想恢复就双击「启动HomeChat.command」。"
echo ""
read -n 1 -s -r -p "  按任意键关闭…"
