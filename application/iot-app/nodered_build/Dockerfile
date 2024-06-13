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
    crypto \
    lora-packet
	
COPY settings.js /data/settings.js


