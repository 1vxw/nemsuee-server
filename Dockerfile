FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run prisma:generate && npm run build

EXPOSE 5000
CMD ["sh", "-c", "npm run prisma:deploy && npm start"]
