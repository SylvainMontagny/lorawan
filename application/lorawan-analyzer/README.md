# LoRaWAN Analyzer

Real-time LoRaWAN traffic analyzer for ChirpStack. Captures uplinks, downlinks, join requests, and TX acknowledgements via MQTT, stores everything in Postgres + TimescaleDB, and serves a web dashboard for monitoring and analysis.

![Dashboard](assets/dashboard.png)

![Live Feed](assets/live.png)

## Features

- **Dashboard** -- gateway tabs, operator/device tree, traffic charts, channel/SF distribution, duty cycle, device breakdown
- **Device detail** -- per-device FCnt timeline, packet loss, RSSI/SNR trends, interval histogram, SF/frequency/gateway distributions
- **Live packet feed** -- real-time WebSocket stream with packet type, RSSI range, and ownership filters
- **Operator identification** -- built-in LoRa Alliance NetID database (175+ operators), plus custom prefix mappings
- **Visibility filtering** -- separate "my devices" from foreign traffic using DevAddr prefix rules
- **Join request tracking** -- grouped by JoinEUI with timeline and manufacturer lookup
- **Session tracking** -- correlates join requests with subsequent data uplinks
- **Airtime calculation** -- per-packet, based on Semtech SX127x datasheet formulas

## Setup

### 1. Configure

```bash
cp config.toml.example config.toml
```

Edit `config.toml` and point `mqtt.server` at your ChirpStack MQTT broker (the same one ChirpStack Gateway Bridge publishes to):

```toml
[mqtt]
server = "tcp://your-chirpstack-mqtt:1883"
username = ""
password = ""
format = "protobuf"
```

- **`server`** -- MQTT broker address
- **`format`** -- `protobuf` for ChirpStack v4 (default), `json` for v3 or JSON marshaler

**Common broker addresses (Docker):**

| ChirpStack setup | `mqtt.server` value |
|---|---|
| Same host, separate compose project | `tcp://host.docker.internal:1883` or `tcp://172.17.0.1:1883` |
| Same Docker network | `tcp://<mosquitto-container-name>:1883` |
| Remote host | `tcp://chirpstack.example.com:1883` |

If unsure, check your ChirpStack `docker-compose.yml` for the mosquitto/EMQX service name, or `chirpstack-gateway-bridge.toml` for the MQTT server address.

### 2. Start

```bash
docker compose up -d
```

| Container | Port | Description |
|---|---|---|
| `lorawan-analyzer` | `15337` | Web dashboard + API |
| `lorawan-postgres` | -- | Postgres + TimescaleDB (internal only) |

Dashboard: [http://localhost:15337](http://localhost:15337)

```bash
docker compose logs -f analyzer
```

> **Upgrading from the ClickHouse version?** The old data is incompatible. Delete `data/` before starting: `rm -rf data/ && docker compose up -d`

## Configuration

### ChirpStack Devices

The **DevAddr** dropdown on the Live page has a **ChirpStack Devices** option. When selected, the live feed switches from gateway-sourced packets to the application-level MQTT stream — packets are enriched with ChirpStack device names and application names instead of raw DevAddr labels. The device list in the sidebar also switches to show ChirpStack-registered devices grouped by application.

This mode requires that the analyzer is connected to the same MQTT broker as ChirpStack (the default setup). No extra config is needed.

### Custom Operators

Label your own networks by DevAddr prefix. These override the built-in NetID database:

```toml
[[operators]]
prefix = "26000000/20"          # hex DevAddr prefix / bit length
name = "My Network"
known_devices = true            # marks as "my devices" for visibility filter
color = "#3b82f6"               # dashboard color

# multiple prefixes per operator
[[operators]]
prefix = ["26011234/32", "26015678/32"]
name = "My Sensors"
known_devices = true
```

Prefix format: `AABBCCDD/N` -- the upper N bits of the DevAddr are compared. `26000000/20` matches any DevAddr starting with `0x26000...`.

Operators can also be defined without a prefix to assign a color to a ChirpStack application name. When the live feed is in **ChirpStack Devices** mode, packets are grouped by `application_name`; entries here are matched by name and used to set the color in the dashboard:

```toml
[[operators]]
name = "Hydrogen"
color = "#3b82f6"

[[operators]]
name = "Ozone"
color = "#a855f7"
```

The `name` must exactly match the application name as it appears in ChirpStack.

### Multiple MQTT Servers

Connect to more than one broker simultaneously. Packets from all brokers are merged into the same database:

```toml
[[mqtt_servers]]
server = "tcp://chirpstack2.example.com:1883"
format = "protobuf"

[[mqtt_servers]]
server = "tcp://chirpstack3.example.com:1883"
format = "json"
```

The primary `[mqtt]` section is always connected. Each `[[mqtt_servers]]` entry adds an additional connection.

### Gateway Names (`gateways.csv`)

Place `data/gateways.csv` (next to `docker-compose.yml`) to pre-seed gateway names and map coordinates. Gateways are registered at startup, so named tabs appear immediately even before any packets arrive.

```csv
id,name,alias,latitude,longitude
0016c001f184aa22,wifx,backyard pole,46.9480,7.4474
0016c001f1137226,sensecap,roof panel,,
7076ff0056071e21,kerlink0,,,
```

| Column | Required | Description |
|--------|----------|-------------|
| `id` | yes | Gateway EUI (hex, lowercase) |
| `name` | no | Display label (falls back to raw ID if blank) |
| `alias` | no | Reserved |
| `latitude` / `longitude` | no | Both required to place a map pin |

If a gateway already exists in the database, only the CSV fields that are present overwrite existing values. The file is optional.

### Hide Rules

Suppress specific traffic from the UI:

```toml
[[hide_rules]]
type = "dev_addr"               # or "join_eui"
prefix = "26000000/20"
description = "Hide my sensors"
```

Operators and hide rules can also be managed at runtime via the API.

See [`config.toml.example`](config.toml.example) for all available settings.

## API

Most endpoints accept `hours` (time window) and `gateway_id` (filter by gateway) query parameters. Endpoints returning device data also support `filter_mode` (`owned`/`foreign`/`all`) and `prefixes` (comma-separated `HEX/bits` list).

### Gateways

| Endpoint | Description |
|----------|-------------|
| `GET /api/gateways` | List all gateways with stats |
| `GET /api/gateways/:id` | Single gateway details |
| `GET /api/gateways/:id/tree` | Operator/device tree |
| `GET /api/gateways/:id/operators` | Operators seen on gateway |
| `GET /api/gateways/:id/devices` | Devices on gateway |
| `GET /api/gateways/:id/operators/:name/devices` | Devices for a specific operator |

### Devices

| Endpoint | Description |
|----------|-------------|
| `GET /api/devices/:devaddr` | Device activity / recent packets |
| `GET /api/devices/:devaddr/profile` | Summary stats (packet count, avg RSSI/SNR, airtime) |
| `GET /api/devices/:devaddr/fcnt-timeline` | Frame counter progression with gap detection |
| `GET /api/devices/:devaddr/intervals` | Packet interval histogram |
| `GET /api/devices/:devaddr/signal-trends` | RSSI/SNR over time |
| `GET /api/devices/:devaddr/distributions` | SF, frequency, gateway breakdown |
| `GET /api/devices/:devaddr/packet-loss` | Missed packets / loss rate |

### Joins

| Endpoint | Description |
|----------|-------------|
| `GET /api/joins` | Recent join requests |
| `GET /api/joins/by-eui` | Grouped by JoinEUI |
| `GET /api/joins/eui/:joinEui/timeline` | Timeline for a specific JoinEUI |

### Statistics

| Endpoint | Description |
|----------|-------------|
| `GET /api/stats/summary` | Overview stats (packets, devices, airtime, duty cycle) |
| `GET /api/stats/operators` | Per-operator breakdown |
| `GET /api/stats/timeseries` | Time series (accepts `interval`, `metric`, `group_by`) |
| `GET /api/stats/duty-cycle` | Duty cycle stats |
| `GET /api/stats/downlinks` | Downlink / TX ack stats |
| `GET /api/packets/recent` | Recent packets (accepts `packet_types`, `rssi_min`, `rssi_max`) |
| `GET /api/spectrum/:gw/channels` | Channel usage distribution |
| `GET /api/spectrum/:gw/spreading-factors` | SF distribution |

### Operators & Config

| Endpoint | Description |
|----------|-------------|
| `GET /api/operators` | List custom operators |
| `POST /api/operators` | Add operator (`{prefix, name, priority?}`) |
| `DELETE /api/operators/:id` | Remove operator |
| `GET /api/hide-rules` | List hide rules |
| `POST /api/hide-rules` | Add rule (`{type, prefix, description?}`) |
| `DELETE /api/hide-rules/:id` | Remove rule |
| `GET /api/config/my-devices` | Configured "my devices" prefixes |
| `GET /api/config/operator-colors` | Operator color map |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `WS /api/live` | Live packet stream (all gateways) |
| `WS /api/live/:gatewayId` | Live stream for a specific gateway |

Query parameters: `types` (comma-separated: `data`, `join_request`, `downlink`, `tx_ack`), `rssi_min`, `rssi_max`, `filter_mode`, `prefixes`.

## Development

```bash
# Rebuild after backend/source changes
docker compose build --no-cache analyzer && docker compose up -d

# Restart after config changes
docker compose restart analyzer
```

Frontend files (`public/`) are volume-mounted -- changes apply on browser refresh.

## License

MIT
