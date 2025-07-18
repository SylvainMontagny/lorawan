# Variables
locals {
  config_temp_hum = jsondecode(file("config_temp_hum.json"))
  config_air_quality = jsondecode(file("config_air_quality.json"))
  # Add more configurations as needed for other dashboards

  config_provider1 = jsondecode(file("config_provider.json"))["config_provider1"]
  # config_provider2 = jsondecode(file("config_provider.json"))["config_provider2"]
  # Add more provider configurations as needed
}

# Paths
provider "jsonnet" {
  jsonnet_path = join(":", ["${path.module}/jsonnet", "${path.module}/jsonnet/grafonnet-lib", "${path.module}/vendor"])
}

###########################
# Providers for Grafonnet #
###########################

provider "grafana" {
  alias = "provider1"
  url = local.config_provider1.url
  auth = local.config_provider1.auth
}

# provider "grafana" {
#   alias = "provider2"
#   url = local.config_provider2.url
#   auth = local.config_provider2.auth
# }

# Describe here the new provider for grafonnet

##########################################
# Dashboard for Temperature and Humidity #
##########################################

## For provider1, link Jsonnet dashboard with provider1's configuration
data "jsonnet_file" "temp_hum_dashboard_provider1" {
    source = "${path.module}/dashboards/temp_hum_dashboard.jsonnet"
    ext_code = {
      temp_hum_dashboard_config = jsonencode(local.config_temp_hum.provider1)
    }
}
## Provides rendered dashboard to Grafana
resource "grafana_dashboard" "temp_hum_provider1" {
  provider    = grafana.provider1
  config_json = data.jsonnet_file.temp_hum_dashboard_provider1.rendered
}

# Add here more dashboards as needed, following the same pattern

# data "jsonnet_file" "temp_hum_dashboard_provider2" {
#     source = "${path.module}/dashboards/temp_hum_dashboard.jsonnet"
#     ext_code = {
#       temp_hum_dashboard_config = jsonencode(local.config_temp_hum.client2)
#     }
# }
# resource "grafana_dashboard" "temp_hum_provider2" {
#   provider    = grafana.provider2
#   config_json = data.jsonnet_file.temp_hum_dashboard_provider2.rendered
# }

#############################
# Dashboard for Air Quality #
#############################

## For provider1
data "jsonnet_file" "air_quality_dashboard_provider1" {
  source = "${path.module}/dashboards/air_quality_dashboard.jsonnet"
  ext_code = {
    air_quality_dashboard_config = jsonencode(local.config_air_quality.provider1)
  }
}
resource "grafana_dashboard" "air_quality_provider1" {
  provider    = grafana.provider1
  config_json = data.jsonnet_file.air_quality_dashboard_provider1.rendered
}

# Add here more dashboards as needed, following the same pattern
