# Grafana As Code

## Fonctionnement

![schema_fonctionnement](pictures/jsonnet_only.png)

## Glossaire
[**Terraform**](https://fr.wikipedia.org/wiki/Terraform_(logiciel)) : environnement logiciel d'« infrastructure as code » publié par la société HashiCorp. Cet outil permet d'automatiser la construction des ressources d'une infrastructure de centre de données comme un réseau, des machines virtuelles, un groupe de sécurité ou une base de données.

**HCL** : Hashicorp Configuration Language, language utilisé par Terraform

**provider** : objet de l'infrastructure Terraform qui représente une instance de destination (par exemple une instance de Grafana)

**data** : objet de l'infrastructure Terraform qui représente les données sources (par exemple un dashboard template stocké en tant que fichier jsonnet)

**resource** : objet de l'infrastructure Terraform qui va permettre de créer le dashboard en format JSON et le pousser sur un provider 

**jsonnet** : langage de création de modèle de données permettant de générer des fichier JSON. C'est une extension du language JSON

**grafonnet** : bibliothèque jsonnet dédiée à la génération de dashboard pour Grafana

## Initialisation du projet

**Installer Terraform** : https://developer.hashicorp.com/terraform/tutorials/aws-get-started/install-cli

**Télécharger golang** : 
* En local https://go.dev/dl/
* Sur serveur Linux distant `wget https://go.dev/dl/go1.24.3.linux-amd64.tar.gz`

**Installer golang** : https://go.dev/doc/install

Ajouter `PATH=$PATH:~/go/bin:/usr/local/go/bin` au fichier `~/.profile` ou directement taper la commande `export PATH=$PATH:/usr/local/go/bin` dans un terminal. Si `go version` ne fonctionne pas, redémarrer la session.

**Installer jsonnet et jsonnet-bundler :**

```bash
go install github.com/google/go-jsonnet/cmd/jsonnet@latest
go install -a github.com/jsonnet-bundler/jsonnet-bundler/cmd/jb@latest
```

**Installer Grafonnet** dans le dossier du projet avec jsonnet-bundler :

```bash
jb install github.com/grafana/grafonnet/gen/grafonnet-latest@main
```

## Déploiement

* Aller dans le répertoire `grafana-as-code`,
* Ajouter un provider :
	* Méthode simple (non recommendée, non compatible avec GitHub) : 
	dans main.tf, ajouter simplement les providers et leurs configurations
	``` hcl
	provider "grafana" {
		alias = "provider1"
		url = "http://dev.univ-lorawan.fr:3000/"
		auth = "glsa_2d3..."
	}
	```
	* Méthode propre (recommendée) :
	créer à la source du projet le fichier `config_provider.json` avec les données pour chaque provider :
	``` json
	{
		"dev": {
			"url": "http://dev.univ-lorawan.fr:3000/",
			"auth": "glsa_2d3..."
		},
		"provider1": {
			"url":  "https://iot.provider1.fr",
			"auth": "glsa_hQ2..."
		}
	}
	```
	Dans `main.tf`, ajouter si besoin les variables locales associées aux providers :
	``` hcl
	locals {
		...
		dev = jsondecode(file("config_provider.json"))["dev"]
		provider1 = jsondecode(file("config_provider.json"))["asder"]
	}
	```
	Enfin, ajouter si besoin un nouveau provider
	``` hcl
	provider "grafana" {
		alias = "provider1"
		url = local.provider1.url
		auth = local.provider1.auth
	}
	```
	Par défaut, il faut ajouter le fichier de configuration avec les provider `dev` et `asder`.
* Configurer les fichiers de configuration `config_xxx.json`.

Enfin :
```bash
terraform init
terraform plan
terraform apply // ou terraform apply -target=grafana_dashboard.myNewDashboard_provider1 pour un dashboard spécifique
```

Terraform s'occupe de générer le dashboard à partir du fichier jsonnet et le pousse automatiquement sur Grafana.

Pour générer manuellement un dashboard au format JSON, aller dans les fichier dashboard jsonnet et les bibliothèques variables et panels libsonnet pour décommenter les variables locales *fullConfig* et *config*, et commenter la variables locale *config* qui suit, puis aller dans le dossier `dashboards` et taper la commande suivante, à adapter avec le dashboard souhaité :
``` bash
jsonnet -J ..\vendor\ .\temp_hum_dashboard.jsonnet -o .\rawDashboard\temp_hum_dashboard.json
```

## Configuration

Fichier de configuration `config_xxx.json` :
```json
{
	"provider1" :{
		"dashboardName": "Generated Dashboard",
		"bucket": "myBucket",
		"measurements": [
			{ "key": "Temperature", "value": "TempC_SHT", "unit": "celsius" },
			{ "key": "Humidity", "value": "Hum_SHT", "unit": "percent" },
			{ "key": "Air Quality", "value": "Co2_SHT", "unit": "ppm" }
		],
		"variable1Name": "CAMPUS",
		"variable2Name": "Batiment",
		"variable3Name": "ROOM",
		"datasource": "deivf3q0qa1hca"
	},
	"provider2" : {
		...
	}
}

```
Fichier de configuration `config_provider.json`
``` json
{
  "povider1": {
    "url": "http://provider1.univ-lorawan.fr:3000/",
    "auth": "glsa_2d3..."
  },
  "provider2": {
    "url":  "https://iot.provider2.fr",
    "auth": "glsa_hQ2..."
  }
}
```

> /!\ Pas de "," à la fin de chaque objet !

### Récupérer un token Grafana pour `auth` dans Grafana v9

`Grafana > Configuration` puis au choix :
* API Keys > New API key > Role: Editor > Add > Copy
* Service accounts > Add service account > Role: Admin > Add service account token > Copy clipboard

### Récupérer un token Grafana pour `auth` dans Grafana v11

* `Grafana > Administration > Users and access > Service account > Add service account`
* Role: Admin
* `Create > Add service account token > Generate token > Copy to clipboard`

### Récupérer l'uid d'une datasource

A associer avec la clé `datasource` :
``` bash
curl -u username:password http://url/to/grafana/api/datasources
```

Ou aller dans un dashboard qui utilise déjà la bonne datasource, puis `Share > Export > View JSON` puis chercher l'objet suivant afin de récupérer le bon **uid** :
``` json
"datasource": {
	"type": "influxdb",
	"uid": "deivf3q0qa1hca"
}
```

Les datasources sont visibles ici :
* Grafana v9 : `Grafana > Configurations > Data sources > myDatasource`
* Grafana v11 : `Grafana > Connections > Data sources > myDatasource`

> Le token est déjà associé à une organisation, username et password. Attention à bien créer ce token depuis la bonne organisation.

## Organisation des fichiers

```
.
├── README.md
├── main.tf
├── config_air_quality.json
├── config_temp_hum.json
├── config_provider.json
├── dashboards
│   ├── air_quality_dashboard.jsonnet
│   ├── temp_hum_dashboard.jsonnet
│   ├── panels
│   │   ├── panel_air_quality.libsonnet
│   │   └── panel_temp_hum.libsonnet
│   └── variables
│       ├── variable_air_quality.libsonnet
│       └── variable_temp_hum.libsonnet
├── jsonnetfile.json
├── jsonnetfile.lock.json
├── terraform.tfstate
├── terraform.tfstate.backup
├── pictures ...
└── vendor ...
```

Toutes les informations utiles au dashboard sont dans le répertoire `dashboards`. Les fichiers `xxx_dashboard.jsonnet` regroupent toutes les configurations relatives au dashboards générés. Les paneaux et les variables sont respectivement stockées dans les bibliothèques libsonnet de `panels` et `variables` : on peut retrouver tous les détails mais aussi les éléments de génération adaptés à la configuration choisie par l'utilisateur.

L'utilisateur n'a que les fichiers de configuration à modifier dans lequel il décrit toutes les configurations souhaitées : `config_provider.json` et `config_xxx.json`.

## Ajouter un nouveau dashboard

Voir https://docs.univ-lorawan.fr/fr/sylvain/grafana#ajouter-un-nouveau-dashboard-source

## Sources du projet

**What is Grafana As Code?** https://grafana.com/blog/2020/02/26/how-to-configure-grafana-as-code/ 

**Convertir lignes de code en string** https://www.freeformatter.com/json-escape.html#before-output

**Documentation Terraform pour Grafana** https://registry.terraform.io/providers/grafana/grafana/latest/docs

**Documentation Terraform** https://developer.hashicorp.com/terraform/language

**Provider grafana** https://developer.hashicorp.com/terraform/language

**Data jsonnet** https://registry.terraform.io/providers/alxrem/jsonnet/latest/docs/data-sources/file#tla_code-1

**Synthaxe jsonnet** https://jsonnet.org/learning/tutorial.html

**Packages grafonnet** https://github.com/grafana/grafonnet/tree/d20e609202733790caf5b554c9945d049f243ae3/gen/grafonnet-v11.4.0
