FROM nodered/node-red:4.0.9
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production @flowfuse/node-red-dashboard
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production node-red-contrib-influxdb
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production node-red-contrib-bacnet
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production node-red-node-base64
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production @grpc/grpc-js
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production @chirpstack/chirpstack-api
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production lora-packet
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production @ba47/node-red-queue
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production node-red-contrib-ical-events
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production @montagny/node-red-contrib-lorawan-bacnet
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production node-bacnet
COPY settings.js /data/settings.js

