#!/bin/bash
cd /home/paperclip/sketch-cas
node node_modules/.bin/vite build 2>&1
echo "BUILD_EXIT:$?"
