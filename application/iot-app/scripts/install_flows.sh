#!/bin/bash

if [ ! -d "/usr/src/node-red/" ]; then
    echo Install Node RED before
    exit 0
fi

# Go to examples' file
cd /usr/src/node-red/node_modules/@node-red/nodes/examples/

function add_flow {
    # Get name of file with extension, diectory and URL and optionnaly if the function should 
    # remove the first object of the file
    FILE="$1"
    DIR="$2"
    URL="$3"
    REMOVE_FIRST="${4:-false}"

    [[ "$FILE" =~ (.*).json ]]
    NAME=${BASH_REMATCH[1]}

    echo
    echo $NAME example installation
    echo ===============================
    echo

    if [ ! -d "$DIR" ]; then
        mkdir -p "$DIR"
    fi

    if [ -f "$DIR/$FILE" ]; then
        echo Update $NAME
        rm "$DIR/$FILE"
    fi

    if ! wget -q --tries=3 --timeout=15 -O "$FILE" "$URL"; then
        echo "WARNING: unable to download $URL"
        echo "Check container DNS/network and retry later."
        return 0
    fi

    if [[ "$REMOVE_FIRST" == true ]]
    then
        # Remove first object to add LoRaBAC as a flow and not a new tab
        if ! command -v jq >/dev/null 2>&1; then
            if ! apk add --no-cache jq >/dev/null 2>&1; then
                echo "WARNING: jq installation failed, keeping raw flow for $NAME"
                mv "$FILE" "$DIR/$FILE"
                return 0
            fi
        fi

        if jq '.[1:]' "$FILE" > "cleaned_$FILE"; then
            rm -f "$FILE"
            mv "cleaned_$FILE" "$DIR/$FILE"
        else
            echo "WARNING: jq processing failed, keeping raw flow for $NAME"
            mv "$FILE" "$DIR/$FILE"
        fi
    else
        mv "$FILE" "$DIR/$FILE"
    fi
}


add_flow "LoRaBAC.json" "bacnet" "https://raw.githubusercontent.com/SylvainMontagny/LoRaBAC/refs/heads/main/LoRaBAC.json"

add_flow "BACnet-Tests.json" "bacnet" "https://raw.githubusercontent.com/SylvainMontagny/lorawan/refs/heads/main/application/nodered/flows/bacnet/BACnet-Tests.json"

add_flow "RestAPI-DistechControl-tests.json" "bacnet" "https://raw.githubusercontent.com/SylvainMontagny/lorawan/refs/heads/main/application/nodered/flows/bacnet/RestAPI-DistechControl-tests.json"

add_flow "lht65.json" "formation-collectivites" "https://raw.githubusercontent.com/SylvainMontagny/lorawan/refs/heads/main/application/nodered/flows/formation-collectivites/lht65.json"

add_flow "mqtt_ttn.json" "formation-collectivites" "https://raw.githubusercontent.com/SylvainMontagny/lorawan/refs/heads/main/application/nodered/flows/formation-collectivites/mqtt_ttn.json"

add_flow "mqtt_test.json" "formation-collectivites" "https://raw.githubusercontent.com/SylvainMontagny/lorawan/refs/heads/main/application/nodered/flows/formation-collectivites/mqtt_test.json"

add_flow "ttn_influxdb.json" "formation-lorawan" "https://raw.githubusercontent.com/SylvainMontagny/lorawan/refs/heads/main/application/nodered/flows/formation-lorawan/ttn_influxdb.json"

add_flow "bacnet-js-client.json" "bacnet" "https://raw.githubusercontent.com/SylvainMontagny/bacnet/refs/heads/main/bacnet-js%20client/bacnet-js-client.json"

echo
echo "Done!"
echo
