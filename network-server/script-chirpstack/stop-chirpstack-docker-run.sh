#!/bin/bash

# Stop and remove containers
sudo docker stop chirpstack chirpstack-gateway-bridge chirpstack-gateway-bridge-basicstation postgres redis mosquitto
sudo docker rm chirpstack chirpstack-gateway-bridge chirpstack-gateway-bridge-basicstation postgres redis mosquitto

# Remove volumes
sudo docker volume rm -f postgresqldata redisdata

# Remove unused volumes
sudo docker volume prune -f


