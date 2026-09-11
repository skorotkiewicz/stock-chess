FROM oven/bun:latest

WORKDIR /app

COPY package*.json ./
RUN bun install

COPY . .
RUN bun run build

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "server.js"]
