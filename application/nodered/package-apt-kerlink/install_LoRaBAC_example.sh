#!/bin/bash

echo "############################"
echo "LoRaBAC example installation"
echo "############################"

# Variables
EXAMPLE_DIR="~/.node-red/examples"
LORABAC_DIR="~/.node-red/examples/lorabac"
LORABAC_URL="https://raw.githubusercontent.com/SylvainMontagny/LoRaBAC/refs/heads/main/LoRaBAC.json"
SETTINGS_FILE="~/.node-red/settings.js"

echo Install LoRaBAC example and BACnet module

# Install new modules
echo Install module node-red-contrib-bacnet
npm install node-red-contrib-bacnet

# Install LoRaBAC example
cd ~
cd .node-red/

echo Install LoRaBAC example...

# Looking for LoRaBAC.json
if [ -f "LoRaBAC.json" ]; then
    echo LoRaBAC.json already exists here:
    find -name LoRaBAC.json
fi

# Checks if examples directory exists
if [! -d "$EXAMPLE_DIR" ]; then
  echo "Create directory $EXAMPLE_DIR."
  mkdir $EXAMPLE_DIR
fi
cd $EXAMPLE_DIR

if [! -d "$LORABAC_DIR" ]; then
  echo "Create directory $LORABAC_DIR."
  mkdir $LORABAC_DIR
fi
cd $LORABAC_DIR

wget https://raw.githubusercontent.com/SylvainMontagny/LoRaBAC/refs/heads/main/LoRaBAC.json

# Add file to configuration
if ! grep -q "examples:" "$SETTINGS_FILE"; then
    echo "Add example path to $SETTINGS_FILE..."
    sudo sed -i "/editorTheme: {/a \ \ \ \ examples: { path: \"$LORABAC_DIR\" }," "$SETTINGS_FILE"
fi

systemctl restart node-red

echo "Done!"
