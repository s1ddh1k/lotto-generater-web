FROM node:24-bookworm-slim
WORKDIR /workspace
ENV NODE_ENV=production
COPY --chown=node:node package.json ./
COPY --chown=node:node src/http-purchase.js src/job.js ./src/
USER node
ENTRYPOINT ["node", "src/job.js"]
