NUM_INSTANCES=3

for i in $(seq 1 $NUM_INSTANCES); do
  sudo docker stop nodered_$i
  sudo docker rm nodered_$i
done

