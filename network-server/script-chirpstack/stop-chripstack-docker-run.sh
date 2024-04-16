#!/bin/bash

# Stop and remove containers
docker stop chirpstack chirpstack-gateway-bridge chirpstack-gateway-bridge-basicstation chirpstack-rest-api postgres redis mosquitto
docker rm chirpstack chirpstack-gateway-bridge chirpstack-gateway-bridge-basicstation chirpstack-rest-api postgres redis mosquitto

# Remove volumes
docker volume rm -f postgresqldata redisdata

# Remove network
#docker network rm my-network
