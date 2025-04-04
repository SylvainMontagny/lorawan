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

# Looking for LoRaBAC.json
if [ -f "LoRaBAC.json" ]; then
    echo LoRaBAC.json already exists here:
    find -name LoRaBAC.json
fi

# Checks if examples directory exists
if [ ! -d "$EXAMPLE_DIR" ]; then
  echo "Create directory $EXAMPLE_DIR."
  mkdir $EXAMPLE_DIR
fi
cd $EXAMPLE_DIR

if [ ! -d "$LORABAC_DIR" ]; then
  echo "Create directory $LORABAC_DIR."
  mkdir $LORABAC_DIR
fi
cd $LORABAC_DIR

wget $LORABAC_URL

# Add file to configuration
if ! grep -q "examples:" "$SETTINGS_FILE"; then
    echo "Add example path to $SETTINGS_FILE..."
    sudo sed -i "/editorTheme: {/a \ \ \ \ examples: { path: \"$LORABAC_DIR\" }," "$SETTINGS_FILE"
fi

systemctl restart node-red

echo "Done!"
