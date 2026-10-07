# Traefik reverse proxy

Traefik terminates TLS for Node-RED on port 443, ChirpStack and its REST API on
port 8080, InfluxDB on port 8086, Grafana on port 3000, and MQTT on port 8883.
All services use the same domain name; MQTT is forwarded to Mosquitto over the
internal Docker network.

## Configuration

Add the following variable to `traefik/.env`, keeping the existing
`ACME_EMAIL` value:

```env
DOMAIN_NAME=example.org
```

Replace `example.org` with a domain you control. Create a DNS A/AAAA record for
that domain pointing to the Docker host.

Allow inbound TCP ports 80, 443, 3000, 8080, 8086, 8883, and 9000 through the
host firewall and any upstream router. Port 80 is used by Let's Encrypt for
HTTP-01 certificate validation and redirects browser traffic to HTTPS. Port
9000 is published directly by Docker for ChirpStack's backend interface; it
does not pass through Traefik and does not receive TLS termination.

## Start the stacks

Start Traefik first so it creates the shared Docker network, then start the
application stacks with the same environment file:

```bash
cd traefik
docker compose up -d

cd ../network-server/chirpstack-docker
docker compose --env-file ../../traefik/.env up -d

cd ../../application/iot-app
docker compose --env-file ../../traefik/.env up -d
```

The resulting endpoints are `https://<DOMAIN_NAME>` for Node-RED,
`https://<DOMAIN_NAME>:8080` for ChirpStack and its REST API,
`mqtts://<DOMAIN_NAME>:8883` for MQTT,
`https://<DOMAIN_NAME>:8086` for InfluxDB, and
`https://<DOMAIN_NAME>:3000` for Grafana. ChirpStack gRPC is also available on
`<DOMAIN_NAME>:8080`. The ChirpStack backend interface is directly available
over plain TCP on port 9000.

The original application ports are no longer published directly for these
services. ChirpStack gateway traffic on UDP 1700 and Basic Station TCP 3001
remains published by its Compose stack.