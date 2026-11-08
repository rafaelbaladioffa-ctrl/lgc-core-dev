FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates chromium fonts-noto-color-emoji && rm -rf /var/lib/apt/lists/* \
    && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY bot/package.json ./
RUN npm install --omit=dev

COPY bot /app

RUN mkdir -p /app/auth_info

CMD ["node", "index.js"]
