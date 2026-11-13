FROM node:24-alpine

WORKDIR /app
COPY . /app

ENV PORT=8090 \
    DB_PATH=/data/app.db \
    NODE_ENV=production

VOLUME ["/data"]
EXPOSE 8090

CMD ["node", "--no-warnings=ExperimentalWarning", "server/index.js"]
