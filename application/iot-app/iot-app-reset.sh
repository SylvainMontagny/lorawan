#!/bin/bash
#Script to instanciate influxdb - telegraf - grafana 
#Data are stored in folder iot-app
path=/home/etudiant
#path=$(pwd)
dest_folder=iot-app


function remove_file () {
	rm -rf ${path}/${dest_folder}/influx_data/*
  rm -rf ${path}/${dest_folder}/telegraf_data/*
  rm -rf ${path}/${dest_folder}/grafana_data/*
}

