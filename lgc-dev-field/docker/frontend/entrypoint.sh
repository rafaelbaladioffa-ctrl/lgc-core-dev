#!/bin/sh
set -e

# npm install precisa escrever em package-lock.json, que fica no bind mount
# do host (./frontend:/app) — em alguns hosts (ex: Docker Desktop no Windows)
# o chown do bind mount para o usuário node não é confiável, então a
# instalação roda como root. Só o processo do servidor (vite dev) roda como
# usuário sem privilégios.
npm install

mkdir -p /app/node_modules
chown -R node:node /app/node_modules

exec gosu node "$@"
