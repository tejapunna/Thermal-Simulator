FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
# web UI + one TCP port per printer (match these to PRINTERS)
EXPOSE 7788 9100 9101 9102
CMD ["./node_modules/.bin/tsx", "server.ts", "--prod"]
