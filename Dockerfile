# Dockerfile
# Build stage
FROM node:20-slim as base

# Install Chrome dependencies and Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use Chrome instead of Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000

# Production stage
FROM base as production
CMD ["node", "app.js"]

# Test stage
FROM base as test
ENV DEBUG=true
ENV SYNTHETIC_MONITOR_CONFIG_FILE="/app/test.config.json"
CMD ["node", "app.js"]