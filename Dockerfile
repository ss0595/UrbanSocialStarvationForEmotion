FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /usr/src/app/data
ENV NODE_ENV=production
ENV SQLITE_DB_PATH=/usr/src/app/data/database.sqlite

EXPOSE 3000

CMD ["npm", "start"]
