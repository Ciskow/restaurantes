# Stage 1: build the React interface.
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js ./
COPY web ./web
RUN npm run build

# Stage 2: the Node server plus the built files. The database lives in /data (mounted).
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8480 DATA_DIR=/data NODE_OPTIONS=--no-warnings
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /src/dist ./dist
EXPOSE 8480
CMD ["node", "server/index.js"]
