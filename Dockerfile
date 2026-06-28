FROM node:22-alpine

WORKDIR /app

# Copy server and db
COPY server/ ./server/
COPY db/ ./db/
COPY package.json ./

# Install server dependencies
RUN npm install --omit=dev

# Build client
COPY client/package.json ./client/
RUN cd client && npm install
COPY client/ ./client/
RUN cd client && node node_modules/vite/bin/vite.js build

EXPOSE 8080

CMD ["node", "server/index.js"]
