FROM node:20-alpine

WORKDIR /usr/src/app

COPY Deep-Guard-Backend/package*.json ./
RUN npm install --production --no-audit --no-fund

COPY Deep-Guard-Backend/. .

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000
CMD ["node", "server.js"]
