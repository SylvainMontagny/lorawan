# Usage

| JSON file | Where it is used |
|-----------|------------------|
| ttn_inflluxdb.json | In montagny/nodered container, in lorawan/application/iot-app/scripts/install_flows.sh |

The script `install_flows.sh` is executed in the `entrypoint.sh`, called in the `docker-compose.yml` file.