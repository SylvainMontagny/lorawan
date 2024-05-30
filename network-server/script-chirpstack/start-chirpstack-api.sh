#!/bin/bash


# Pull images 
curl -X POST -H "Content-Type: application/json" \
--unix-socket /var/run/docker.sock \
  http://localhost/images/create?fromImage=redis:7-alpine

curl -X POST -H "Content-Type: application/json" \
--unix-socket /var/run/docker.sock \
  http://localhost/images/create?fromImage=postgres:14-alpine

curl -X POST -H "Content-Type: application/json" \
--unix-socket /var/run/docker.sock \
  http://localhost/images/create?fromImage=eclipse-mosquitto:2

curl -X POST -H "Content-Type: application/json" \
--unix-socket /var/run/docker.sock \
  http://localhost/images/create?fromImage=chirpstack/chirpstack:4.8.1
  
curl -X POST -H "Content-Type: application/json" \
--unix-socket /var/run/docker.sock \
  http://localhost/images/create?fromImage=chirpstack/chirpstack-gateway-bridge:4.0.11  



# Create containers
curl -X POST -H "Content-Type: application/json" \
  --unix-socket /var/run/docker.sock \
  -d '{
    "Image": "redis:7-alpine",
    "Cmd": ["redis-server", "--save", "300", "1", "--save", "60", "100", "--appendonly", "no"],
    "HostConfig": {
      "Binds": ["redisdata:/data"],
      "RestartPolicy": {"Name": "unless-stopped"}
    },
    "Detach": true
  }' \
http://localhost/containers/create?name=redis
  
curl -X POST -H "Content-Type: application/json" \
	--unix-socket /var/run/docker.sock \
  -d '{
        "Image": "postgres:14-alpine",
        "Env": ["POSTGRES_PASSWORD=root"],
        "HostConfig": {
          "Binds": [
            "'$(pwd)'/../chirpstack-docker/configuration/postgresql/initdb:/docker-entrypoint-initdb.d",
            "postgresqldata:/var/lib/postgresql/data"
          ],
          "RestartPolicy": {"Name": "unless-stopped"}
        }
      }' \
http://localhost/containers/create?name=postgres  

curl -X POST -H "Content-Type: application/json" \
	--unix-socket /var/run/docker.sock \
  -d '{
        "Image": "eclipse-mosquitto:2",
        "ExposedPorts": {
          "1883/tcp": {}
        },
        "HostConfig": {
          "PortBindings": {
            "1883/tcp": [{"HostPort": "1883"}]
          },
          "Binds": ["'$(pwd)'/../chirpstack-docker/configuration/mosquitto/config/:/mosquitto/config/"],
          "RestartPolicy": {"Name": "unless-stopped"}
        }
      }' \
http://localhost/containers/create?name=mosquitto
  
curl -X POST \
     --unix-socket /var/run/docker.sock \
     -H "Content-Type: application/json" \
     -d '{
           "Image": "chirpstack/chirpstack:4.8.1",
		   "ExposedPorts": {
            "8080/tcp": {}
            },
           "Env": [
             "MQTT_BROKER_HOST=mosquitto",
             "REDIS_HOST=redis",
             "POSTGRESQL_HOST=postgres"
           ],
           "HostConfig": {
             "Binds": [
               "'$(pwd)'/../chirpstack-docker/configuration/chirpstack:/etc/chirpstack",
               "'$(pwd)'/../chirpstack-docker/lorawan-devices:/opt/lorawan-devices"
             ],
             "PortBindings": { "8080/tcp": [{ "HostPort": "8080" }] },
             "RestartPolicy": { "Name": "unless-stopped" },
             "Links": ["postgres:postgres", "mosquitto:mosquitto", "redis:redis"]
           },
           "Cmd": ["-c", "/etc/chirpstack"]
         }' \
http://localhost/containers/create?name=chirpstack 

curl -X POST \
     --unix-socket /var/run/docker.sock \
     -H "Content-Type: application/json" \
     -d '{
           "Image": "chirpstack/chirpstack-gateway-bridge:4.0.11",
            "ExposedPorts": {
              "1700/udp": {}
            },
           "Env": [
             "INTEGRATION__MQTT__EVENT_TOPIC_TEMPLATE=eu868/gateway/{{ .GatewayID }}/event/{{ .EventType }}",
             "INTEGRATION__MQTT__STATE_TOPIC_TEMPLATE=eu868/gateway/{{ .GatewayID }}/state/{{ .StateType }}",
             "INTEGRATION__MQTT__COMMAND_TOPIC_TEMPLATE=eu868/gateway/{{ .GatewayID }}/command/#"
           ],
           "HostConfig": {
             "Binds": [
               "'$(pwd)'/../chirpstack-docker/configuration/chirpstack-gateway-bridge:/etc/chirpstack-gateway-bridge"
             ],
             "PortBindings": { "1700/udp": [{ "HostPort": "1700" }] },
             "RestartPolicy": { "Name": "unless-stopped" },
             "Links": ["mosquitto:mosquitto"]
           }
         }' \
     http://localhost/containers/create?name=chirpstack-gateway-bridge



  
# Start containers
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost/containers/redis/start

curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost/containers/postgres/start

curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost/containers/mosquitto/start

curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost/containers/chirpstack/start

curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost/containers/chirpstack-gateway-bridge/start





