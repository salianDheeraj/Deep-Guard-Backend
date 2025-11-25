# Stage 1: Builder - Installs dependencies
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

# Copy and install dependencies. This layer is only rebuilt if package.json changes.
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy the rest of the application code
COPY . .

# Stage 2: Production - Creates a lean final image
FROM node:20-alpine
WORKDIR /usr/src/app

# Copy only the necessary files from the builder stage
COPY --from=builder /usr/src/app .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000

# The exposed port must match the PORT env var
EXPOSE 5000

# Command to run the application
CMD ["node", "server.js"]