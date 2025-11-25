FROM node:20-alpine
WORKDIR /usr/src/app

COPY Deep-Guard-Backend/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY Deep-Guard-Backend/. .
ENV NODE_ENV=production

EXPOSE 5000
CMD ["node", "server.js"]
