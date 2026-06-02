# Static site served by nginx. The app is pure client-side (WebRTC + LokiJS),
# so there is no application server - nginx just hands out the files.
FROM nginx:1.27-alpine

# Copy the whole project; .dockerignore decides what stays out of the image,
# so adding or removing an asset never requires touching this Dockerfile.
COPY . /usr/share/nginx/html/

EXPOSE 80
