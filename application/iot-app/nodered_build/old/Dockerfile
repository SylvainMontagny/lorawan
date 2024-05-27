FROM nodered/node-red:2.2.3-12
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production node-red-dashboard node-red-contrib-influxdb
COPY settings.js /data/settings.js
