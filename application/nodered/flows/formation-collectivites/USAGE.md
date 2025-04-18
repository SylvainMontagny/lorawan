# Usage

| JSON file | Where it is used |
|-----------|------------------|
| lht65.json | In montagny/nodered container, in lorawan/application/iot-app/scripts/install_flows |
| mqtt_ttn.json | In montagny/nodered container, in lorawan/application/iot-app/scripts/install_flows.sh |

The script `install_flows.sh` is executed in the `entrypoint.sh`, called in the `docker-compose.yml` file.