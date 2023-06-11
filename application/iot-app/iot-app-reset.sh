#!/bin/bash
#Script to instanciate influxdb - telegraf - grafana 
#Data are stored in folder iot-app
path=/home/debian
dest_folder=lorawan/application/iot-app


function remove_file () {
	rm -rf ${path}/${dest_folder}/influx_data/*
  rm -rf ${path}/${dest_folder}/telegraf_data/*
  rm -rf ${path}/${dest_folder}/grafana_data/*
}

