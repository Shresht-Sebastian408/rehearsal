FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
