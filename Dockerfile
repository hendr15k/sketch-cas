FROM nginx:alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/sketch-cas.conf

# Copy app files
COPY index.html /usr/share/nginx/html/index.html

EXPOSE 3141

CMD ["nginx", "-g", "daemon off;"]
