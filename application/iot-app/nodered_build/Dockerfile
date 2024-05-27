FROM nodered/node-red:3.1
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production node-red-dashboard node-red-contrib-influxdb
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production node-red-contrib-bacnet
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production node-red-contrib-bitunloader
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production node-red-contrib-string
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production node-red-node-base64
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production @grpc/grpc-js
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production @chirpstack/chirpstack-api
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production crypto
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production lora-packet

COPY settings.js /data/settings.js
