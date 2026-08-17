FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/store/package.json apps/store/
COPY apps/admin/package.json apps/admin/
COPY apps/jubelio-mock/package.json apps/jubelio-mock/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/

RUN npm ci --include=dev

COPY apps/jubelio-mock apps/jubelio-mock

ENV NODE_ENV=development
ENV JUBELIO_MOCK_HOST=0.0.0.0
ENV JUBELIO_MOCK_PORT=3002

USER node
EXPOSE 3002
CMD ["npm", "run", "dev", "--workspace", "@marketplace/jubelio-mock"]
