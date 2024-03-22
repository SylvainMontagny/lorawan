#!/bin/bash

sudo chmod -R o+w ~/lorawan/application/iot-app/node_data/
sudo chmod -R o+w ~/lorawan/application/iot-app/grafana_data/
sudo chown -R 1000:1000 ~/lorawan/application/iot-app/grafana_data/
sudo docker compose up -d
