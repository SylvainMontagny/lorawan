#!/bin/bash

trap stop SIGINT SIGTERM

echo ENTRYPOINT
echo ==========

function stop() {
        kill $CHILD_PID
        wait $CHILD_PID
}

bash /scripts/install_flows.sh

/usr/local/bin/node $NODE_OPTIONS node_modules/node-red/red.js --userDir /data $FLOWS "${@}" &

CHILD_PID="$!"

wait "${CHILD_PID}"
