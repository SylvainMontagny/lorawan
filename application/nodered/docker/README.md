# For USMB 
Use the script create-nodered.sh and remove-nodered.sh to create as many instance on the same server :
- montagny/node-red
- From 1979 downward
- Each has it's own volume

# For BACnet training
Use the docker-compose file to create 8 Node-RED instance :
- montagny/node-red
- From 1880 downward, but as "host". Ports are directly expose on the host.
- Each as it's own volume