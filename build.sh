#!/bin/bash
cd "$(dirname "$0")"
node node_modules/.bin/vite build 2>&1
echo "BUILD_EXIT:$?"
