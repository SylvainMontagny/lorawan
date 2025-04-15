#!/bin/bash

if [ ! -d "/usr/src/node-red/" ]; then
    echo Install Node RED before
    exit 0
fi

# Go to examples' file
cd /usr/src/node-red/node_modules/@node-red/nodes/examples/

apk update
apk add jq

##### TEMPLATE #####
# ###########################################################################

# echo "##########################"
# echo "FLOW_NAME example installation"
# echo "##########################"

# if [ ! -d FOLDER_NAME ]; then
#     mkdir FOLDER_NAME
# fi

# if [ -f FOLDER_NAME/FLOW_NAME.json ]; then
#     echo Update FLOW_NAME
#     rm FOLDER_NAME/FLOW_NAME.json
# fi

# wget URL

# # Remove first object to add LoRaBAC as a flow and not a new tab
# jq '.[1:]' FLOW_NAME.json > FLOW_NAME-cleaned.json
# rm -f FLOW_NAME.json
# mv FLOW_NAME-cleaned.json FOLDER_NAME/FLOW_NAME.json

###########################################################################

echo "############################"
echo "LoRaBAC example installation"
echo "############################"

if [ ! -d usmb ]; then
    mkdir usmb
fi

if [ -f usmb/LoRaBAC.json ]; then
    echo Update LoRaBAC
    rm usmb/LoRaBAC.json
fi

wget https://raw.githubusercontent.com/SylvainMontagny/LoRaBAC/refs/heads/main/LoRaBAC.json
mv LoRaBAC.json usmb/LoRaBAC.json

###########################################################################

echo "##########################"
echo "lht65 example installation"
echo "##########################"

if [ ! -d formation-collectivites ]; then
    mkdir formation-collectivites
fi

if [ -f formation-collectivites/lht65.json ]; then
    echo Update lht65
    rm formation-collectivites/lht65.json
fi

wget https://raw.githubusercontent.com/SylvainMontagny/lorawan/refs/heads/main/application/nodered/flows/formation-collectivites/lht65.json

# Remove first object to add LoRaBAC as a flow and not a new tab
jq '.[1:]' lht65.json > lht65-cleaned.json
rm -f lht65.json
mv lht65-cleaned.json formation-collectivites/lht65.json

###########################################################################

echo "##########################"
echo "mqtt_ttn example installation"
echo "##########################"

if [ -f formation-collectivites/mqtt_ttn.json ]; then
    echo Update mqtt_ttn
    rm formation-collectivites/mqtt_ttn.json
fi

wget https://raw.githubusercontent.com/SylvainMontagny/lorawan/refs/heads/main/application/nodered/flows/formation-collectivites/mqtt_ttn.json

# Remove first object to add LoRaBAC as a flow and not a new tab
jq '.[1:]' mqtt_ttn.json > mqtt_ttn-cleaned.json
rm -f mqtt_ttn.json
mv mqtt_ttn-cleaned.json formation-collectivites/mqtt_ttn.json

echo "Done!"
