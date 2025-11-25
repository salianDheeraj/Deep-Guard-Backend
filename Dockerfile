# Base image for production
FROM node:20-alpine

# Create and set the working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
# This is inefficient, as it forces a reinstall on every code change, but it is simple.
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy the rest of the application code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000

# Expose the application port
EXPOSE 5000

# Command to run the application
CMD ["node", "server.js"]