FROM node:24-bookworm-slim
WORKDIR /workspace
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node src ./src
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
