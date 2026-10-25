FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests first so Docker caches the install layer
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY src/ ./src/

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
