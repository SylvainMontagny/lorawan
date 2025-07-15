terraform {
  required_providers {
    grafana = {
      source  = "grafana/grafana"
      version = "~> 2.0"
    }

    jsonnet = {
      source = "alxrem/jsonnet"
    }
  }
}

# Variables
locals {
  config_temp_hum = jsondecode(file("config_temp_hum.json"))
  config_air_quality = jsondecode(file("config_air_quality.json"))
  # Add more configurations as needed for other dashboards

  dev = jsondecode(file("config_provider.json"))["dev"]
  asder = jsondecode(file("config_provider.json"))["asder"]
  # Add more provider configurations as needed
}

provider "jsonnet" {
  jsonnet_path = join(":", ["${path.module}/jsonnet", "${path.module}/jsonnet/grafonnet-lib", "${path.module}/vendor"])
}

###########################
# Providers for Grafonnet #
###########################

provider "grafana" {
  alias = "dev"
  url = local.dev.url
  auth = local.dev.auth
}

provider "grafana" {
  alias = "asder"
  url = local.asder.url
	auth = local.asder.auth
}

# Describe here the new provider for grafonnet

##########################################
# Dashboard for Temperature and Humidity #
##########################################

## For development purpuses
data "jsonnet_file" "temp_hum_dashboard_dev" {
    source = "${path.module}/dashboards/temp_hum_dashboard.jsonnet"
    ext_code = {
      temp_hum_dashboard_config = jsonencode(local.config_temp_hum.dev)
    }
}
resource "grafana_dashboard" "temp_hum_dev" {
  provider    = grafana.dev
  config_json = data.jsonnet_file.temp_hum_dashboard_dev.rendered
}

## For ASDER
data "jsonnet_file" "temp_hum_dashboard_asder" {
    source = "${path.module}/dashboards/temp_hum_dashboard.jsonnet"
    ext_code = {
      temp_hum_dashboard_config = jsonencode(local.config_temp_hum.asder)
    }
}
resource "grafana_dashboard" "temp_hum_asder" {
  provider    = grafana.asder
  config_json = data.jsonnet_file.temp_hum_dashboard_asder.rendered
}

# Add here more dashboards + provider as needed, following the same pattern

#############################
# Dashboard for Air Quality #
#############################

## For dev
data "jsonnet_file" "air_quality_dashboard_dev" {
  source = "${path.module}/dashboards/air_quality_dashboard.jsonnet"
  ext_code = {
    air_quality_dashboard_config = jsonencode(local.config_air_quality.dev)
  }
}
resource "grafana_dashboard" "air_quality_dev" {
  provider    = grafana.dev
  config_json = data.jsonnet_file.air_quality_dashboard_dev.rendered
}

## For ASDER
data "jsonnet_file" "air_quality_dashboard_asder" {
  source = "${path.module}/dashboards/air_quality_dashboard.jsonnet"
  ext_code = {
    air_quality_dashboard_config = jsonencode(local.config_air_quality.asder)
  }
}
resource "grafana_dashboard" "air_quality_asder" {
  provider    = grafana.asder
  config_json = data.jsonnet_file.air_quality_dashboard_asder.rendered
}

# Add here more dashboards + provider as needed, following the same pattern
