# postgres
sudo docker run -d \
  --name postgres \
  -v $(pwd)/../chirpstack-docker/configuration/postgresql/initdb:/docker-entrypoint-initdb.d \
  -v postgresqldata:/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=root \
  --restart unless-stopped \
  postgres:14-alpine

# redis
sudo docker run -d \
  --name redis \
  -v redisdata:/data \
  --restart unless-stopped \
  redis:7-alpine \
  redis-server --save 300 1 --save 60 100 --appendonly no

# mosquitto
sudo docker run -d \
  --name mosquitto \
  -v $(pwd)/../chirpstack-docker/configuration/mosquitto/config/:/mosquitto/config/ \
  -p 1883:1883 \
  --restart unless-stopped \
  eclipse-mosquitto:2

# chirpstack
sudo docker run -d \
  --name chirpstack \
  --link postgres \
  --link mosquitto \
  --link redis \
  -v $(pwd)/../chirpstack-docker/configuration/chirpstack:/etc/chirpstack \
  -v $(pwd)/../chirpstack-docker/lorawan-devices:/opt/lorawan-devices \
  -e MQTT_BROKER_HOST=mosquitto \
  -e REDIS_HOST=redis \
  -e POSTGRESQL_HOST=postgres \
  -p 8080:8080 \
  --restart unless-stopped \
  chirpstack/chirpstack:4.8.1 \
  -c /etc/chirpstack

# chirpstack-gateway-bridge
sudo docker run -d \
  --name chirpstack-gateway-bridge \
  --link mosquitto \
  -v $(pwd)/../chirpstack-docker/configuration/chirpstack-gateway-bridge:/etc/chirpstack-gateway-bridge \
  -e "INTEGRATION__MQTT__EVENT_TOPIC_TEMPLATE=eu868/gateway/{{ .GatewayID }}/event/{{ .EventType }}" \
  -e "INTEGRATION__MQTT__STATE_TOPIC_TEMPLATE=eu868/gateway/{{ .GatewayID }}/state/{{ .StateType }}" \
  -e "INTEGRATION__MQTT__COMMAND_TOPIC_TEMPLATE=eu868/gateway/{{ .GatewayID }}/command/#" \
  -p 1700:1700/udp \
  --restart unless-stopped \
  chirpstack/chirpstack-gateway-bridge:4.0.11

# chirpstack-gateway-bridge-basicstation
sudo docker run -d \
  --name chirpstack-gateway-bridge-basicstation \
  -v $(pwd)/../chirpstack-docker/configuration/chirpstack-gateway-bridge:/etc/chirpstack-gateway-bridge \
  -p 3001:3001 \
  --restart unless-stopped \
  chirpstack/chirpstack-gateway-bridge:4.0.11 \
  -c /etc/chirpstack-gateway-bridge/chirpstack-gateway-bridge-basicstation-eu868.toml
