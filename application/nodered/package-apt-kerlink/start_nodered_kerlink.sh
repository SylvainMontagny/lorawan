#!/bin/bash

echo "#################################"
echo "Node RED and LoRaBAC installation"
echo "#################################"

cd /home/admin/

echo Install package...

apt update
apt-get update

apt-get install -y -qq node-red

# Swap memory might be required for Node RED
echo "Install Node RED..."

systemctl enable node-red --now --quiet

# open port to acces to Node RED
cat > node-red.rules << EOF
*filter
-A INPUT -p tcp --dport 1880 -j ACCEPT
COMMIT
EOF

mv node-red.rules /etc/iptables/iptables.d/

systemctl restart iptables --quiet

echo Install LoRaBAC flow and Node RED modules

# Install LoRaBAC flow
cd ~
cd .node-red/
wget https://raw.githubusercontent.com/SylvainMontagny/LoRaBAC/refs/heads/main/LoRaBAC.json
rm --force flows.json
mv LoRaBAC.json flows.json

# Install new modules
echo Install module node-red-contrib-bacnet
npm install node-red-contrib-bacnet

systemctl restart node-red

echo "Done!"

echo If downlink flush is planned, refer to the documentation to install module node-red-contrib-grpc: https://docs.univ-lorawan.fr/fr/sylvain/Gateways-configuration#edge-computing

# Read boardinfo.env
EUI64=$(grep '^export EUI64=' /run/boardinfo.env | cut -d'"' -f2)
CODENAME=$(grep '^export CODENAME=' /run/boardinfo.env | cut -d'"' -f2)

# Print Node RED link
echo "Node RED is now available at: http://klk-"$CODENAME"-"${EUI64:(-6)}".local:1880"
