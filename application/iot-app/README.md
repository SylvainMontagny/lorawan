# iot-app
This repository contains all the file needed for the LoRaWAN formation

## Node RED

### Add new example flows

Edit `install_flows.sh`, add a flow based on the template available at the beginning of the document.
Change:
* `FLOW_NAME` (exact name of the json file, without any extension)
* `FOLDER_NAME`
* `URL`

Make sure the URL correspond to raw file (for GitHub): on GitHub, go to your file, click on the top right button `Raw` and get the URL.

To import the json example as a flow (and not a table), make sure the first json object is a tab and keep the `jq` function. This will simply delete the first tab object.

The newly added flow will be stored in `Examples > flows > node-red > FOLDER_NAME`. Find it in Node RED in `Menu > Import > Examples`.

**How does it work?** Because Node RED entrypoint script is a bit special, it is not possible to execute the command given in `docker-compose.yml` in the entrypoint script with `exec "$@"` at the end of the file. The entrypoint script starts a nodered thread and then wait for it to end. The command will hence stop the nodered thread if placed before the `wait` instruction or will never be executed as long as Node RED is activated.
