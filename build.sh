#!/bin/bash
set -e
cd "$(dirname "$0")"
npx tsc --noEmit
node node_modules/.bin/vite build
