FROM node:26.9.0-bookworm-slim

ENV NODE_ENV=production

# Install Ghostscript
RUN apt-get update \
  && apt-get install -y --no-install-recommends ghostscript curl \
  && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install production dependencies from the lockfile
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy app files
COPY server.js ./
COPY public ./public

# Create runtime folders owned by the unprivileged node user
RUN mkdir -p uploads outputs && chown node:node uploads outputs

USER node

# Expose port
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start the app
CMD ["node", "server.js"]
