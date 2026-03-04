#############################
# myConfigDashboard.jsonnet #
#############################

local grafana = import 'github.com/grafana/grafonnet/gen/grafonnet-latest/main.libsonnet';

# For external terraform variable
local config = std.extVar('myConfig');

# Create new dashboard
grafana.dashboard.new("My Generated Config Jsonnet Dashboard provided by Terraform")
# Dashboard settings
+ grafana.dashboard.withTimezone(value="browser")

# Dashboard panels
+ grafana.dashboard.withPanels([
    # Text panel for dashboard description
    grafana.panel.text.new('')
    + grafana.panel.text.panelOptions.withGridPos(h=3, w=24,x=0,y=0)
    + grafana.panel.text.options.withMode('markdown')
    + grafana.panel.text.options.withContent("# My Generated Dashboard with configurations provided by Terraform\nThis is my third Dashboard created with Grafonnet and provided by Terraform!"),

    # Time series panel for LHT65 data
    local myQuery = |||
        from(bucket: "iot-platform")
        |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
        |> filter(fn: (r) => r["_field"] == "DATA_TYPE")
    |||;
    grafana.panel.timeSeries.new('Device Temperature')
    + grafana.panel.timeSeries.panelOptions.withGridPos(h=18, w=24, x=0, y=3)
    + grafana.panel.timeSeries.queryOptions.withTargets([
        {
            datasource: {
                type: 'influxdb',
                uid: "Qt7pUbFHz"
            },
            query: std.strReplace(myQuery, "DATA_TYPE", config["datatype"])
        }
    ])
])
