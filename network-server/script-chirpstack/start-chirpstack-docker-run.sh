#!/bin/bash
# Create volumes if they don't exist
docker volume create postgresqldata
docker volume create redisdata

# Function to check if a container is running
container_running() {
    local container_name="$1"
    local status=$(docker inspect -f '{{.State.Running}}' "$container_name" 2>/dev/null)
    if [ "$status" == "true" ]; then
        return 0
    else
        return 1
    fi
}

# Start postgres container OK
docker run -d \
  --name postgres \
  -v $(pwd)/configuration/postgresql/initdb:/docker-entrypoint-initdb.d \
  -v postgresqldata:/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=root \
  --restart unless-stopped \
  postgres:14-alpine

# Start redis container OK
docker run -d \
  --name redis \
  -v redisdata:/data \
  --restart unless-stopped \
  redis:7-alpine \
  redis-server --save 300 1 --save 60 100 --appendonly no

# Start mosquitto container
docker run -d \
  --name mosquitto \
  -v $(pwd)/configuration/mosquitto/config/:/mosquitto/config/ \
  -p 1883:1883 \
  --restart unless-stopped \
  eclipse-mosquitto:2


  # Check if postgres, redis, and mosquitto are running before starting chirpstack
while !(container_running postgres && container_running redis && container_running mosquitto); do
    sleep 1
done

# Start chirpstack container OK
docker run -d \
  --name chirpstack \
  --link postgres \
  --link mosquitto \
  --link redis \
  -v $(pwd)/configuration/chirpstack:/etc/chirpstack \
  -v $(pwd)/lorawan-devices:/opt/lorawan-devices \
  -e MQTT_BROKER_HOST=mosquitto \
  -e REDIS_HOST=redis \
  -e POSTGRESQL_HOST=postgres \
  -p 8080:8080 \
  --restart unless-stopped \
  chirpstack/chirpstack:4 \
  -c /etc/chirpstack

# Start chirpstack-gateway-bridge container OK
docker run -d \
  --name chirpstack-gateway-bridge \
  --link mosquitto \
  -v $(pwd)/configuration/chirpstack-gateway-bridge:/etc/chirpstack-gateway-bridge \
  -e "INTEGRATION__MQTT__EVENT_TOPIC_TEMPLATE=eu868/gateway/{{ .GatewayID }}/event/{{ .EventType }}" \
  -e "INTEGRATION__MQTT__STATE_TOPIC_TEMPLATE=eu868/gateway/{{ .GatewayID }}/state/{{ .StateType }}" \
  -e "INTEGRATION__MQTT__COMMAND_TOPIC_TEMPLATE=eu868/gateway/{{ .GatewayID }}/command/#" \
  -p 1700:1700/udp \
  --restart unless-stopped \
  chirpstack/chirpstack-gateway-bridge:4

 
  
  # Start chirpstack-gateway-bridge-basicstation container OK
docker run -d \
  --name chirpstack-gateway-bridge-basicstation \
  -v $(pwd)/configuration/chirpstack-gateway-bridge:/etc/chirpstack-gateway-bridge \
  -p 3001:3001 \
  --restart unless-stopped \
  chirpstack/chirpstack-gateway-bridge:4 \
  -c /etc/chirpstack-gateway-bridge/chirpstack-gateway-bridge-basicstation-eu868.toml

# Check if chirpstack is running before starting chirpstack-rest-api
while !(container_running chirpstack); do
    sleep 1
done

# Start chirpstack-rest-api container
docker run -d \
  --name chirpstack-rest-api \
  --link chirpstack \
  -p 8090:8090 \
  --restart unless-stopped \
  chirpstack/chirpstack-rest-api:4 \
  --server chirpstack:8080 --bind 0.0.0.0:8090 --insecure


