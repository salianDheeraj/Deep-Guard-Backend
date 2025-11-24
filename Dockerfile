FROM node:20-alpine AS builder

# Set the context for the builder stage
WORKDIR /usr/src/app/backend

# Copy the dependency files from the repository root
# Source path is relative to the repository root (defined in render.yaml's dockerContext: .)
COPY Deep-Guard-Backend/package*.json ./

# Install ALL dependencies (including dev) during build
RUN npm install --no-audit --no-fund

# Copy all source files
COPY Deep-Guard-Backend/. .
RUN npm run build # Assuming you have a build step (like transpiling JS/TS)

# -----------------------------------------------------
# FINAL STAGE: Production Runner (Lean Image)
# -----------------------------------------------------
FROM node:20-alpine

# Set the final working directory
WORKDIR /usr/src/app

# Copy ONLY the production dependencies and source code from the builder stage
COPY --from=builder /usr/src/app/backend/package*.json ./
COPY --from=builder /usr/src/app/backend/node_modules ./node_modules
COPY --from=builder /usr/src/app/backend/server.js ./
# Copy other essential backend folders (routes, controllers, etc.)
COPY --from=builder /usr/src/app/backend/routes ./routes
COPY --from=builder /usr/src/app/backend/controllers ./controllers
COPY --from=builder /usr/src/app/backend/config ./config
COPY --from=builder /usr/src/app/backend/middleware ./middleware
COPY --from=builder /usr/src/app/backend/services ./services
COPY --from=builder /usr/src/app/backend/utils ./utils


# Define production environment variables
ENV NODE_ENV=production
ENV PORT=5000

# Expose the application port
EXPOSE 5000

# Command to run the application
CMD ["node", "server.js"]