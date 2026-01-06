# Build
FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_BACKEND_BASE_URL
ENV VITE_BACKEND_BASE_URL=${VITE_BACKEND_BASE_URL}

 COPY package.json /app/
 RUN npm install

COPY index.html vite.config.ts tsconfig.json tsconfig.node.json /app/
COPY src /app/src
COPY public /app/public

RUN npm run build

# Serve
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
