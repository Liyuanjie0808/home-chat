#!/bin/bash

cd "$(dirname "$0")" || exit 1
clear
echo ""
node server/src/setpass.js "$@"
echo ""
echo "  按回车关掉这个窗口…"
read -r _
