#!/bin/bash



curl -X DELETE -H "Content-Type: application/json" \
  --unix-socket /var/run/docker.sock \
  http://localhost:2375/volumes/postgresqldata?force=true


curl -X DELETE -H "Content-Type: application/json" \
  --unix-socket /var/run/docker.sock \
  http://localhost:2375/volumes/redisdata?force=true


# redis stop
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost:2375/containers/redis/stop

# redis delete
curl -X DELETE \
  --unix-socket /var/run/docker.sock \
  http://localhost:2375/containers/redis

# postgres stop
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost:2375/containers/postgres/stop

# postgres delete
curl -X DELETE \
  --unix-socket /var/run/docker.sock \
  http://localhost:2375/containers/postgres

# mosquitto stop
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost:2375/containers/mosquitto/stop

# mosquitto delete
curl -X DELETE \
  --unix-socket /var/run/docker.sock \
  http://localhost:2375/containers/mosquitto

# chirpstack stop
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost:2375/containers/chirpstack/stop

# chirpstack delete
curl -X DELETE \
  --unix-socket /var/run/docker.sock \
  http://localhost:2375/containers/chirpstack

# chirpstack-gateway-bridge stop
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost:2375/containers/chirpstack-gateway-bridge/stop

# chirpstack-gateway-bridge delete
curl -X DELETE \
  --unix-socket /var/run/docker.sock \
  http://localhost:2375/containers/chirpstack-gateway-bridge

# chirpstack-rest-api stop
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost:2375/containers/chirpstack-rest-api/stop

# chirpstack-rest-api delete
curl -X DELETE \
  --unix-socket /var/run/docker.sock \
  http://localhost:2375/containers/chirpstack-rest-api