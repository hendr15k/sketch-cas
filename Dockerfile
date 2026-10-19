FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies first so the layer is cached across source changes.
COPY package.json package-lock.json ./
RUN npm ci

# Build the Vite bundle (tsc + vite build → dist/).  The nginx stage serves
# the app from the domain root, not from /sketch-cas/.
COPY . .
RUN VITE_BASE=/ npm run build

FROM nginx:alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/sketch-cas.conf

# Serve the compiled bundle, not the unprocessed sources.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3141

CMD ["nginx", "-g", "daemon off;"]
