#!/bin/bash

echo "############################"
echo "LoRaBAC example installation"
echo "############################"

# Variables
EXAMPLE_DIR="$HOME/.node-red/examples"
LORABAC_DIR="$HOME/.node-red/examples/lorabac"
LORABAC_URL="https://raw.githubusercontent.com/SylvainMontagny/LoRaBAC/refs/heads/main/LoRaBAC.json"
SETTINGS_FILE="$HOME/.node-red/settings.js"

if [ ! -d "$HOME/.node-red/" ]; then
    echo Install Node RED before
    exit 0
fi

# Install LoRaBAC example
cd $HOME/.node-red/

# Install new modules
echo Install module node-red-contrib-bacnet...
npm install node-red-contrib-bacnet

echo Install LoRaBAC example...

cd node_modules/node-red-contrib-bacnet/examples

wget $LORABAC_URL

# Remove first object to add LoRaBAC as a flow and not a new tab
jq '.[1:]' LoRaBAC.json > LoRaBAC-cleaned.json
rm --force LoRaBAC.json
mv LoRaBAC-cleaned.json LoRaBAC.json

systemctl restart node-red

echo "Done!"
