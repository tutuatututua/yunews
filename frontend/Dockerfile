# Build
FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_BACKEND_BASE_URL
ENV VITE_BACKEND_BASE_URL=${VITE_BACKEND_BASE_URL}

COPY package.json /app/
COPY package-lock.json /app/
RUN npm ci

COPY index.html vite.config.ts tsconfig.json tsconfig.node.json /app/
COPY src /app/src
COPY public /app/public

RUN npm run build

# Serve
FROM nginx:1.27-alpine

ENV PORT=80 \
	API_UPSTREAM=http://backend-api:8080/

# Use the nginx official image's envsubst templating support.
# Files placed in /etc/nginx/templates/*.template are rendered to /etc/nginx/conf.d/
# at container start.
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
