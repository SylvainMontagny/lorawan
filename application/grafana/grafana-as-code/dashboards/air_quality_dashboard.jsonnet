#################################
# air_quality_dashboard.jsonnet #
#################################

local grafana = import 'github.com/grafana/grafonnet/gen/grafonnet-latest/main.libsonnet';
local g = grafana;
# See documentation on how to use functions: https://github.com/grafana/grafonnet/tree/main/gen/grafonnet-v11.4.0#readme
# And find the wanted package (e.g. panel/timeSeries)

# For manual testing with jsonnet
#local fullConfig = import '../config_air_quality.json';
#local config = fullConfig.dev;

# For external terraform variable
local config = std.extVar('air_quality_dashboard_config');

local dashboard = grafana.dashboard;
local timeSeries = grafana.panel.timeSeries;
local row = grafana.panel.row;
local variable = grafana.dashboard.variable;

# Extracted from the template
local panels = import 'panels/panel_air_quality.libsonnet';
local variables = import 'variables/variable_air_quality.libsonnet';

# Create new dashboard
dashboard.new(config.dashboardName)
# Dashboard settings
+ dashboard.withTimezone("Europe/Paris")
+ dashboard.withRefresh("10m")
+ dashboard.withSchemaVersion(value=39)
+ dashboard.withTags(config.tags)
+ dashboard.time.withFrom(value="now-7d")
+ dashboard.time.withTo(value="now")
+ dashboard.timepicker.withTimeOptions(value=["1h","6h","12h","24h","2d","7d","30d", "90d", "180d", "1y", "2y"])
+ dashboard.withTimezone(value="browser")
+ dashboard.withWeekStart("monday")

# Dashboard panels
+ dashboard.withPanels([
    panels.description,
    panels.main,
    panels.singleView,
    panels.advancedVisualisations
])

# Dashboard variables
+ dashboard.withVariables([
    variables.measurement,
    variables.site,
    variables.building,
    variables.room
])
