FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime image ----
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

EXPOSE 3600

# Management CLI — run with:
#   docker exec <container> node dist/cli.js <command>
# or via docker-compose:
#   docker compose exec onedev node dist/cli.js list

CMD ["node", "dist/main.js"]
