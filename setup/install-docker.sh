#!/bin/bash

printf "Lancement du script d'installation de Docker"
green="\e[32m"
default_color="\e[0m"

apt update > /dev/null
apt install -y ca-certificates curl gnupg > /dev/null
printf "$green ----- Ajout de la clé gpg de docker ------ $default_color\n"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
printf "$green ----- Mise à jour des dépots de paquets ------ $default_color\n"
apt update > /dev/null
printf "$green ----- Installation des paquetages Docker ------ $default_color\n"
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
printf "$green ----- Lancement du conteneur hello-world pour tester l'installation de docker ------ $default_color\n"
docker run hello-world
