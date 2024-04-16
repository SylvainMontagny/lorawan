#!/bin/bash

# Il faut modifier le chemin absolue pour les volumes de postgre, mosquitto.
# pour les serveurs de l'univ c'est /root/chirpstack-docker

# I want to create the simplest curl command following the docker api, to  request the creation of this container : 

# postgresqldata create volume
#curl -X POST -H "Content-Type: application/json" \
#  --unix-socket /var/run/docker.sock \
#  -d '{"Name": "postgresqldata"}' \
#  http://localhost:2375/volumes/create

# redisdata create volume
#curl -X POST -H "Content-Type: application/json" \
 # --unix-socket /var/run/docker.sock \
 # -d '{"Name": "redisdata"}' \
 # http://localhost:2375/volumes/create


container_running() {
    local container_name="$1"
    local status=$(docker inspect -f '{{.State.Running}}' "$container_name" 2>/dev/null)
    if [ "$status" == "true" ]; then
        return 0
    else
        return 1
    fi
}

# redis create OK
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
  http://localhost:2375/containers/create?name=redis

# redis start
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost:2375/containers/redis/start

# postgres create
curl -X POST -H "Content-Type: application/json" \
  -d '{
        "Image": "postgres:14-alpine",
        "Env": ["POSTGRES_PASSWORD=root"],
        "HostConfig": {
          "Binds": [
            "'$(pwd)'/configuration/postgresql/initdb:/docker-entrypoint-initdb.d",
            "postgresqldata:/var/lib/postgresql/data"
          ],
          "RestartPolicy": {"Name": "unless-stopped"}
        }
      }' \
  http://localhost:2375/containers/create?name=postgres

# postgres start
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost:2375/containers/postgres/start

# mosquitto create
curl -X POST -H "Content-Type: application/json" \
  -d '{
        "Image": "eclipse-mosquitto:2",
        "ExposedPorts": {
          "1883/tcp": {}
        },
        "HostConfig": {
          "PortBindings": {
            "1883/tcp": [{"HostPort": "1883"}]
          },
          "Binds": ["'$(pwd)'/configuration/mosquitto/config/:/mosquitto/config/"],
          "RestartPolicy": {"Name": "unless-stopped"}
        }
      }' \
  http://localhost:2375/containers/create?name=mosquitto



# mosquitto start
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost:2375/containers/mosquitto/start


  # Check if postgres, redis, and mosquitto are running before starting chirpstack
while !(container_running postgres && container_running redis && container_running mosquitto); do
    sleep 1
done

# chirpstack create

  curl -X POST \
     --unix-socket /var/run/docker.sock \
     -H "Content-Type: application/json" \
     -d '{
           "Image": "chirpstack/chirpstack:4",
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
               "'$(pwd)'/configuration/chirpstack:/etc/chirpstack",
               "'$(pwd)'/lorawan-devices:/opt/lorawan-devices"
             ],
             "PortBindings": { "8080/tcp": [{ "HostPort": "8080" }] },
             "RestartPolicy": { "Name": "unless-stopped" },
             "Links": ["postgres:postgres", "mosquitto:mosquitto", "redis:redis"]
           },
           "Cmd": ["-c", "/etc/chirpstack"]
         }' \
     http://localhost:2375/containers/create?name=chirpstack



# chirpstack start
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost:2375/containers/chirpstack/start

# chirpstack-gateway-bridge creation
curl -X POST \
     --unix-socket /var/run/docker.sock \
     -H "Content-Type: application/json" \
     -d '{
           "Image": "chirpstack/chirpstack-gateway-bridge:4",
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
               "'$(pwd)'/configuration/chirpstack-gateway-bridge:/etc/chirpstack-gateway-bridge"
             ],
             "PortBindings": { "1700/udp": [{ "HostPort": "1700" }] },
             "RestartPolicy": { "Name": "unless-stopped" },
             "Links": ["mosquitto:mosquitto"]
           }
         }' \
     http://localhost:2375/containers/create?name=chirpstack-gateway-bridge


# chirpstack-gateway-bridge start
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost:2375/containers/chirpstack-gateway-bridge/start



# chirpstack-rest-api creation
curl -X POST \
     --unix-socket /var/run/docker.sock \
     -H "Content-Type: application/json" \
     -d '{
           "Image": "chirpstack/chirpstack-rest-api:4",
            "ExposedPorts": {
                "8090/tcp": {}
            },
           "Cmd": ["--server", "chirpstack:8080", "--bind", "0.0.0.0:8090", "--insecure"],
           "HostConfig": {
             "PortBindings": { "8090/tcp": [{ "HostPort": "8090" }] },
             "RestartPolicy": { "Name": "unless-stopped" }
           }
         }' \
     http://localhost/containers/create?name=chirpstack-rest-api


# chirpstack-rest-api start
curl -X POST \
--unix-socket /var/run/docker.sock \
http://localhost:2375/containers/chirpstack-rest-api/start