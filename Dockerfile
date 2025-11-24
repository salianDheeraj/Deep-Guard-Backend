FROM node:18-alpine

WORKDIR /usr/src/app

# Install production dependencies (use npm install to avoid lockfile mismatch during image builds)
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy source
COPY . .

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["node", "server.js"]
