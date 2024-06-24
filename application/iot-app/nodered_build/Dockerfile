FROM nodered/node-red:3.1
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production \
node-red-dashboard \
node-red-contrib-influxdb \
node-red-contrib-bacnet \
node-red-contrib-bitunloader \
node-red-contrib-string \
node-red-node-base64 \
@grpc/grpc-js \
@chirpstack/chirpstack-api \
lora-packet \
@flowfuse/node-red-dashboard \
@ba47/node-red-queue \
node-red-contrib-ical-events

COPY settings.js /data/settings.js
