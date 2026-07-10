# Beyond Papers — single-container deployment.
# Build:  docker build -t beyond-papers .
# Run:    docker run -p 3000:3000 -v beyond-data:/app/data beyond-papers
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json ./client/
RUN npm ci && npm ci --prefix client
COPY . .
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/client/dist ./client/dist
VOLUME /app/data
EXPOSE 3000
CMD ["npx", "tsx", "server/src/index.ts"]
