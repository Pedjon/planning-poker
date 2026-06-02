# Static site served by nginx. The app is pure client-side (WebRTC + LokiJS),
# so there is no application server - nginx just hands out the files.
FROM nginx:1.27-alpine

# App assets only (see .dockerignore for what is kept out of the build context).
COPY index.html /usr/share/nginx/html/index.html
COPY styles.css /usr/share/nginx/html/styles.css
COPY js/ /usr/share/nginx/html/js/
COPY lib/ /usr/share/nginx/html/lib/

EXPOSE 80
