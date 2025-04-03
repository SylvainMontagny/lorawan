#!/bin/bash

echo "#######################"
echo "ChirpStack installation"
echo "#######################"

cd /home/admin/

echo Install ChirpStack packages...

cat > chirpstack_4.list << EOF
deb https://artifacts.chirpstack.io/packages/4.x/deb stable main
EOF

mv chirpstack_4.list /etc/apt/sources.list.d/

curl -s "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x1ce2afd36dbcca00" | gpg --dearmor -o /etc/apt/trusted.gpg.d/chirpstack_4.gpg

cat > 50-chirpstack-mqtt-forwarder << EOF
Package: chirpstack-mqtt-forwarder
Pin: origin artifacts.chirpstack.io
Pin-Priority: -1
EOF

mv 50-chirpstack-mqtt-forwarder /etc/apt/preferences.d/

echo Install packages...

apt update
apt-get update

apt-get install -y -qq chirpstack postgresql postgresql-client postgresql-contrib mosquitto mosquitto-clients redis zram chirpstack-mqtt-forwarder

cat >> /etc/chirpstack/chirpstack.toml << EOF

[gateway]
  allow_unknown_gateways=true

EOF

echo Install and set up PostgreSQL...

su -l postgres -c "/usr/bin/initdb --pgdata='/var/lib/postgresql/data' --auth='trust'"

systemctl enable postgresql --now --quiet

su - postgres -c "psql -c \" create role chirpstack with login password 'chirpstack' \" "
su - postgres -c "psql -c \" create database chirpstack with owner chirpstack \" "
su - postgres -c "psql -d chirpstack -c \" create extension pg_trgm \" "

echo Install ChirpStack...

systemctl enable chirpstack --now --quiet

while [[ -z $(su - postgres -c "psql -d chirpstack -tAc \"SELECT to_regclass('public.gateway');\"") ]]; do
  echo "Waiting 1s for gateway table to be created..."
  sleep 1
done

su - postgres -c "psql -d chirpstack -c \"insert into gateway (gateway_id, tenant_id, created_at, updated_at, last_seen_at, name, description, latitude, longitude, altitude, stats_interval_secs, tls_certificate, tags, properties) values (bytea '\x$EUI64', (select id from tenant limit 1), now(), now(), null, 'local gateway', 'self', 0.0, 0.0, 0.0, 30, null, '{}', '{}')\" "

cat > chirpstack.rules << EOF
*filter
-A INPUT -p tcp --dport http-alt -j ACCEPT
COMMIT
EOF

mv chirpstack.rules /etc/iptables/iptables.d/

systemctl restart iptables --quiet

# Adapt LEADER_IP_ADDR to Hostname or IP of your leader gateway
# LEADER_IP_ADDR=myLeaderGW
# Adapt topic_prefix if needed (us915_0,as923,...)

cat > leader_config.toml << EOF
[mqtt]
topic_prefix = "eu868"
server = "tcp://${LEADER_IP_ADDR:=localhost}:1883"
EOF

conflex -t -o chirpstack-mqtt-forwarder.toml -T /usr/share/chirpstack-mqtt-forwarder/template.hb leader_config.toml

mv --force chirpstack-mqtt-forwarder.toml /etc/chirpstack-mqtt-forwarder/chirpstack-mqtt-forwarder.toml

systemctl enable chirpstack-mqtt-forwarder --now --quiet

mkdir -p /etc/mosquitto/conf.d/

cat >> /etc/mosquitto/mosquitto.conf << EOF
include_dir /etc/mosquitto/conf.d/
EOF

cat > local.conf << EOF
listener 1883 0.0.0.0
allow_anonymous true
EOF

mv local.conf /etc/mosquitto/conf.d/

systemctl enable mosquitto --now --quiet

echo "Creating and starting local packet forwarder..."

cp /etc/lorafwd.toml /etc/lorafwd-local_chirpstack.toml
sudo lorafwdctl -i local_chirpstack gwmp.node "127.0.0.1"
sudo lorafwdctl -i local_chirpstack gwmp.service.uplink 1700
sudo lorafwdctl -i local_chirpstack gwmp.service.downlink 1700

sudo systemctl start lorafwd@local_chirpstack --quiet

# Add configuration to ChirpStack Codec to increase process time

cat >> /etc/chirpstack/chirpstack.toml << EOF
# Codec configuration.
[codec]

  # JS codec configuration.
  [codec.js]

    # Maximum execution time.
    max_execution_time="500ms"
EOF

systemctl restart chirpstack --quiet

echo "Done!"

# Read boardinfo.env
EUI64=$(grep '^export EUI64=' /run/boardinfo.env | cut -d'"' -f2)
CODENAME=$(grep '^export CODENAME=' /run/boardinfo.env | cut -d'"' -f2)

# Print ChirpStack link
echo "ChirpStack is now available at: http://klk-"$CODENAME"-"${EUI64:(-6)}".local:8080"
echo "username: admin, password: admin
