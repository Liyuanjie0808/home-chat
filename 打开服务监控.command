#!/bin/bash

DIR="$(cd "$(dirname "$0")" && pwd)"
FILE="$DIR/admin/HomeChat-监控.html"

echo ""
echo "  📊 正在打开服务监控…"
echo ""

if [ ! -f "$FILE" ]; then
  echo "  ✘ 找不到文件："
  echo "      $FILE"
  echo ""
  read -n 1 -s -r -p "  按任意键关闭…"
  exit 1
fi

if ! curl -s -m 3 "http://127.0.0.1:8787/ping" > /dev/null 2>&1; then
  echo "  ⚠ 服务端没在跑，监控面板连不上。"
  echo ""
  echo "  建议先双击「启动HomeChat.command」，再回来点这个。"
  echo ""
  read -n 1 -s -r -p "  还是要打开？按任意键继续…"
fi

open "http://127.0.0.1:8787/admin"

echo "  ✔ 浏览器已经打开。"
echo ""
echo "     密码：$(cd "$DIR" && node server/src/showpass.js 2>/dev/null || echo '(读不到，去 data/config.local.json 看)')"
echo ""
echo "  面板上有什么："
echo "     · 顶上   六个大数字：运行时长 / 内存 / 今日消息 / 中转文件 / 在线设备 / 待批准"
echo "     · 中间   中转文件明细、阅后即焚统计"
echo "     · 往下   谁在线、谁在等着批准（可以点【同意】）、最近 60 条安全事件"
echo "     · 底部   红色【停止服务】按钮"
echo ""
echo "  ⚠ 这里看不到聊天内容 —— 这是设计如此，不是坏了。"
echo "     要看自己的聊天，双击「打开电脑版聊天.command」。"
echo ""
echo "  （这个窗口可以关掉了）"
sleep 4
