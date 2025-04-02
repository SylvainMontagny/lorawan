#!/bin/bash

# Stop containers
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost/containers/redis/stop

curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost/containers/postgres/stop

curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost/containers/mosquitto/stop

curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost/containers/chirpstack/stop

curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost/containers/chirpstack-gateway-bridge/stop


# Delete containers
curl -X DELETE \
  --unix-socket /var/run/docker.sock \
  http://localhost/containers/redis

curl -X DELETE \
  --unix-socket /var/run/docker.sock \
  http://localhost/containers/postgres

curl -X DELETE \
  --unix-socket /var/run/docker.sock \
  http://localhost/containers/mosquitto

curl -X DELETE \
  --unix-socket /var/run/docker.sock \
  http://localhost/containers/chirpstack

curl -X DELETE \
  --unix-socket /var/run/docker.sock \
  http://localhost/containers/chirpstack-gateway-bridge



# Delete volumes
curl -X DELETE -H "Content-Type: application/json" \
  --unix-socket /var/run/docker.sock \
  http://localhost/volumes/postgresqldata?force=true

curl -X DELETE -H "Content-Type: application/json" \
  --unix-socket /var/run/docker.sock \
  http://localhost/volumes/redisdata?force=true
  
curl -X POST -H "Content-Type: application/json" \
  --unix-socket /var/run/docker.sock \
  http://localhost/volumes/prune
  

