#!/bin/bash

if [ ! -d "/usr/src/node-red/" ]; then
    echo Install Node RED before
    exit 0
fi

# Go to examples' file
cd /usr/src/node-red/node_modules/@node-red/nodes/examples/

apk update
apk add jq

function add_flow {
    # Get name of file with extension, diectory and URL and optionnaly if the function should 
    # remove the first object of the file
    FILE=$1
    DIR=$2
    URL=$3

    [[ "$FILE" =~ (.*).json ]]
    NAME=${BASH_REMATCH[1]}

    echo
    echo $NAME example installation
    echo ===============================
    echo

    if [ ! -d $DIR ]; then
        mkdir $DIR
    fi

    if [ -f $DIR/$FILE ]; then
        echo Update $NAME
        rm $DIR/$FILE
    fi

    wget $URL

    if [[ $4 == true ]]
    then
        # Remove first object to add LoRaBAC as a flow and not a new tab
        jq '.[1:]' $FILE > cleaned_$FILE
        rm -f $FILE
        mv cleaned_$FILE $DIR/$FILE
    else
        mv $FILE $DIR/$FILE
    fi
}

##### TEMPLATE #####
# ###########################################################################

# URL="FLOW_URL"
# FILE="FILE_NAME.smth"
# DIR="DIR_NAME"

# [[ "$FILE" =~ (.*).json ]]
# NAME=${BASH_REMATCH[1]}

# echo
# echo $NAME example installation
# echo ===============================
# echo

# if [ ! -d $DIR ]; then
#     mkdir $DIR
# fi

# if [ -f $DIR/$FILE ]; then
#     echo Update $NAME
#     rm $DIR/$FILE
# fi

# wget $URL
# mv $FILE $DIR/$FILE

# # Remove first object to add LoRaBAC as a flow and not a new tab
# jq '.[1:]' $FILE > cleaned_$FILE
# rm -f $FILE
# mv cleaned_$FILE $DIR/$FILE

###########################################################################

add_flow "LoRaBAC.json" "bacnet" "https://raw.githubusercontent.com/SylvainMontagny/LoRaBAC/refs/heads/main/LoRaBAC.json"

###########################################################################

URL="https://raw.githubusercontent.com/SylvainMontagny/lorawan/refs/heads/main/application/nodered/flows/bacnet/BACnet-Tests.json"
FILE="BACnet-Tests.json"
DIR="bacnet"
[[ "$FILE" =~ (.*).json ]]
NAME=${BASH_REMATCH[1]}

echo
echo $NAME example installation
echo =================================
echo

if [ -f $DIR/$FILE ]; then
    echo Update $NAME
    rm $DIR/$FILE
fi

wget $URL
mv $FILE $DIR/$FILE

###########################################################################

add_flow "RestAPI-DistechControl-tests.json" "bacnet" "https://raw.githubusercontent.com/SylvainMontagny/lorawan/refs/heads/main/application/nodered/flows/bacnet/RestAPI-DistechControl-tests.json" true

###########################################################################

add_flow "lht65.json" "formation-collectivites" "https://raw.githubusercontent.com/SylvainMontagny/lorawan/refs/heads/main/application/nodered/flows/formation-collectivites/lht65.json" true

###########################################################################

add_flow "mqtt_ttn.json" "formation-collectivites" "https://raw.githubusercontent.com/SylvainMontagny/lorawan/refs/heads/main/application/nodered/flows/formation-collectivites/mqtt_ttn.json" true

###########################################################################

add_flow "ttn_influxdb.json" "formation-lorawan" "https://raw.githubusercontent.com/SylvainMontagny/lorawan/refs/heads/main/application/nodered/flows/formation-lorawan/ttn_influxdb.json"

echo
echo "Done!"
echo
