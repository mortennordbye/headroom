# Stage 1: build frontend
FROM node:20-slim AS frontend-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: production
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/index.js ./
COPY server/seed.js ./
COPY server/ssb.js ./
COPY --from=frontend-build /app/dist ./dist
ENV DATA_DIR=/data
EXPOSE 3001
CMD ["node", "index.js"]
