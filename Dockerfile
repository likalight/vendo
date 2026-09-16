FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# --ignore-scripts: better-sqlite3 ships prebuilt binaries in prebuilds/, but npm still attempts
# an implicit `node-gyp rebuild`, which needs python/make/g++ that the slim image does not have.
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
# Served at /SKILL.md so an agent can install Vendo in one paste.
COPY skills ./skills
RUN mkdir -p data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run tsx via node directly: `npx` would try to fetch it at container start.
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/app.ts"]
