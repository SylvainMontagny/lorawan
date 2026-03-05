# IoT Application
This repository contains all the file needed for the LoRaWAN training

# Setup
The IoT platform is based on the following stack :
- Node-RED
- InfluxDB
- Grafana

1. **Log on your server and download source files**
    * Connect using your SSH credentials
    * git clone the lorawan repository
````bash
git clone https://github.com/sylvainmontagny/lorawan
````

2. **Install the Iot stack (remove 'sudo' if necessary)**
````bash
cd ~/lorawan/application/iot-app
sudo chmod -R o+w ~/lorawan/application/iot-app/node_data/
sudo chmod -R o+w ~/lorawan/application/iot-app/grafana_data/
sudo chown -R 1000:1000 ~/lorawan/application/iot-app/grafana_data/
sudo docker compose up -d
````
3. Check the services
    * Node-RED is available on port 1883
    * InfluxDB is available on port 8083
    * Grafana is available on port 3000

If there are any issues with ports, you can change them to 80, 81, 82 to get access to your services within USMB network.


# Node RED examples

Edit `install_flows.sh`, add a flow based on the template available at the beginning of the document.
Change:
* `FLOW_NAME` (exact name of the json file, without any extension)
* `FOLDER_NAME`
* `URL`

Make sure the URL correspond to raw file (for GitHub): on GitHub, go to your file, click on the top right button `Raw` and get the URL.

**Other way**:
Use the function `add_flow` like in the following example: 

```bash
add_flow "LoRaBAC.json" "bacnet" "URL/to/raw/LoRaBAC.json" true
```

The last option allow you to import the example as a flow (`true`) or flow + tab. If the imported example is an empty flow, change this option to anything else but not true.

To import the json example as a flow (and not a table), make sure the first json object is a tab and keep the `jq` function. This will simply delete the first tab object.

The newly added flow will be stored in `Examples > flows > node-red > FOLDER_NAME`. Find it in Node RED in `Menu > Import > Examples`.

**How does it work?** Because Node RED entrypoint script is a bit special, it is not possible to execute the command given in `docker-compose.yml` in the entrypoint script with `exec "$@"` at the end of the file. The entrypoint script starts a nodered thread and then wait for it to end. The command will hence stop the nodered thread if placed before the `wait` instruction or will never be executed as long as Node RED is activated.
