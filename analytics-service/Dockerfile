FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
USER node
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
