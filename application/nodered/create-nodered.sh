#!/bin/bash

# Define the starting port and number of instances
START_PORT=1879
NUM_INSTANCES=3

# Loop to create containers
for i in $(seq 1 $NUM_INSTANCES); do
  PORT=$((START_PORT - i + 1))  # Decrease the port number
  VOLUME_NAME="nodered_data_$i"

  echo "Starting Node-RED instance $i on port $PORT with volume $VOLUME_NAME"

  # Create a Docker container
 sudo  docker run -d \
    --name nodered_$i \
    -p $PORT:1880 \
    -v $VOLUME_NAME:/data \
    --restart unless-stopped \
    montagny/node-red:latest
done
