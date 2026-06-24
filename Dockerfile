# Always-on deployment: builds the React frontend, runs the Express server.
# Mount a persistent disk at /app/data so the SQLite DB (tracking + generated CVs) survives restarts.
FROM node:22-slim
WORKDIR /app

# Native build deps for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY web/package*.json ./web/
RUN npm --prefix web install

COPY . .
RUN npm --prefix web run build

ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
