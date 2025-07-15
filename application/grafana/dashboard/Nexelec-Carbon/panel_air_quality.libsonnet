###############################
# panel_air_quality.libsonnet #
###############################

# Grafonnet variables
local grafana = import 'github.com/grafana/grafonnet/gen/grafonnet-latest/main.libsonnet';
local timeSeries = grafana.panel.timeSeries;
local row = grafana.panel.row;

# For manual testing with jsonnet
#local fullConfig = import '../config_air_quality.json';
#local config = fullConfig.dev;

# For external terraform variable
local config = std.extVar('air_quality_dashboard_config');

# Default Grafana dashboard variables
local oldBucket = 'Temperature room USMB';
local variable1Name = 'SITE';
local variable2Name = 'BUILDING';
local variable3Name = 'ROOM';
local letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']; # Letters to differentiate queries

# Function that changes bucket, first and second variable names
local editQuery(query) = 
    local bucketChanged = std.strReplace(query, oldBucket, config.bucket);
    local variable1Changed = std.strReplace(bucketChanged, variable1Name, config.variable1Name);
    local variable2Changed = std.strReplace(variable1Changed, variable2Name, config.variable2Name);
    std.strReplace(variable2Changed, variable3Name, config.variable3Name);

# Function that creates different queries depending on config.measurements
local createTargets(query, measurements=config.measurements, datasource=config.datasource) =
    # By default, the function will adapt Temp_SHT
    local queryMain = query;
    local updatedQueryMain = editQuery(queryMain); # Changes bucket and variable names
    [
        {
            refId: letters[i],
            datasource: {
                type: 'influxdb',
                uid: datasource
            },
            query: std.strReplace(updatedQueryMain, 'TempC_SHT', measurements[i]["value"])
        }
        for i in std.range(0, std.length(measurements) - 1)
    ];

# Function that creates overrides fields to change units
local createsOverrides(measurements=config.measurements) = 
    [
        {
            matcher: {
                id: 'byFrameRefID',
                options: letters[i]
            },
            properties: [
                {
                    id: 'unit',
                    value: measurements[i]["unit"]
                },
            ],
        }
        for i in std.range(0, std.length(measurements) - 1)
    ]
    +
    [
        {
            matcher: {
                id: "byName",
                options: "Time"
            },
            properties: [
                {
                    id: "unit",
                    value: "time:LLLL"
                }
            ]
        }
    ];

# PANELS
{
    ########################################################################
    ############################## Text panel ##############################
    ########################################################################

    description:
        grafana.panel.text.new('')
        + grafana.panel.text.options.withMode('markdown')
        + grafana.panel.text.options.withCode({
            language: "plaintext",
            showLineNumbers: false,
            showMiniMap: false
        })
        + grafana.panel.text.options.withContent(config.dashboardDescription)
        + grafana.panel.text.panelOptions.withGridPos(h=3, w=24,x=0,y=0),

    ###############################################################################
    ############################## Time Series panel ##############################
    ###############################################################################
    local queryMain = 'import \"strings\"\r\n\r\nfrom(bucket: \"Temperature room USMB\")\r\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\r\n  |> filter(fn: (r) => \"${MEASUREMENT}\" == \"TempC_SHT\" and r[\"_field\"] == \"${MEASUREMENT}\")\r\n  |> filter(fn: (r) => (exists r[\"salle\"] and contains(set: ${ROOM:json}, value: strings.toLower(v: r.salle))))\r\n  |> keep(columns: [\"_time\", \"_value\", \"batiment\", \"salle\", \"site\"])\r\n  |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false)',
    main:
        timeSeries.new(editQuery('${MEASUREMENT} of ${ROOM}'))
        + timeSeries.panelOptions.withRepeat('MEASUREMENT')
        + timeSeries.panelOptions.withRepeatDirection('h')
        + timeSeries.panelOptions.withTransparent(true)
        + timeSeries.panelOptions.withGridPos(h=18, w=24, x=0, y=3)
        + timeSeries.panelOptions.withMaxPerRow(4)
        + timeSeries.queryOptions.withDatasource('influxdb', config.datasource)
        + timeSeries.panelOptions.withDescription("Above the red threshold, rooms must be ventilated.")

        + timeSeries.queryOptions.withTargets(
            createTargets(queryMain)
        )

        + timeSeries.queryOptions.withTransformations([
            {
                id: 'renameByRegex',
                options: {
                    regex: '.*batiment="(.*?)".*salle="(.*?)".*site="(.*?)".*',
                    renamePattern: '$1 - $2',
                }
            },
        ])

        + timeSeries.options.withLegend({
            calcs: [],
            displayMode: 'list',
            placement: 'right',
            showLegend: true,
        })
        + timeSeries.options.withTooltip({
            maxHeight: 600,
            mode: 'single',
            sort: 'asc',
        })

        + timeSeries.fieldConfig.defaults.custom.withAxisBorderShow(false)
        + timeSeries.fieldConfig.defaults.custom.withAxisCenteredZero(false)
        + timeSeries.fieldConfig.defaults.custom.withAxisColorMode('text')
        + timeSeries.fieldConfig.defaults.custom.withAxisLabel('')
        + timeSeries.fieldConfig.defaults.custom.withAxisPlacement('auto')
        + timeSeries.fieldConfig.defaults.custom.withBarAlignment(0)
        + timeSeries.fieldConfig.defaults.custom.withDrawStyle('line')
        + timeSeries.fieldConfig.defaults.custom.withFillOpacity(0)
        + timeSeries.fieldConfig.defaults.custom.withGradientMode('none')
        + timeSeries.fieldConfig.defaults.custom.withHideFrom({ legend: false, tooltip: false, viz: false })
        + timeSeries.fieldConfig.defaults.custom.withInsertNulls(14400000)
        + timeSeries.fieldConfig.defaults.custom.withLineInterpolation('linear')
        + timeSeries.fieldConfig.defaults.custom.withLineWidth(1)
        + timeSeries.fieldConfig.defaults.custom.withScaleDistribution({
            type: 'linear'
        })
        + timeSeries.fieldConfig.defaults.custom.withShowPoints('never')
        + timeSeries.fieldConfig.defaults.custom.withSpanNulls(false)
        + timeSeries.fieldConfig.defaults.custom.withStacking({
            group: 'A',
            mode: 'none'
        })
        + timeSeries.fieldConfig.defaults.custom.withThresholdsStyle({
            mode: 'off',
        })
        + timeSeries.standardOptions.withMappings([])
        + timeSeries.standardOptions.withOverrides(
            createsOverrides()
        )
        + timeSeries.options.withTooltip({
            maxHeight: 600,
            mode: 'single',
            sort: 'asc'
        })
        + timeSeries.fieldConfig.defaults.custom.withThresholdsStyle({
            "mode": "line+area"
        })
        + timeSeries.standardOptions.thresholds.withMode("absolute")
        + timeSeries.standardOptions.thresholds.withSteps([
            {
                "color": "#73BF69",
                "value": null
            },
            {
                "color": "#f2495c5e",
                "value": 1500
            }
        ]),

    ###################################################################################
    ############################## Row Panel Single view ##############################
    ###################################################################################

    local querySingleView = 'import \"strings\"\r\n\r\nfrom(bucket: \"Temperature room USMB\")\r\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\r\n  |> filter(fn: (r) => \"${MEASUREMENT}\" == \"TempC_SHT\" and r[\"_field\"] == \"${MEASUREMENT}\")\r\n  |> filter(fn: (r) => exists r[\"salle\"] and (strings.toLower(v: r.salle) == \"${ROOM}\"))\r\n  |> keep(columns: [\"_time\", \"_value\", \"batiment\", \"salle\", \"site\"])\r\n  |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false)',

    singleView:
        row.new('Single View')
        + row.withGridPos(y=21)
        + row.withCollapsed(value=true)
        + row.withPanels([
            ############################################################################################
            ############################## Time Series single view Panels ##############################
            ############################################################################################
            
            timeSeries.new(editQuery('${MEASUREMENT} of ${ROOM}'))
            + timeSeries.panelOptions.withRepeat(editQuery('ROOM'))
            + timeSeries.panelOptions.withRepeatDirection('v')
            + timeSeries.panelOptions.withTransparent(true)
            + timeSeries.panelOptions.withGridPos(h=7, w=24, x=0, y=22)
            + timeSeries.queryOptions.withDatasource(type='influxdb', uid=config.datasource)
            + timeSeries.queryOptions.withTargets(
                createTargets(querySingleView)
            )

            + timeSeries.options.withLegend({
                calcs: [],
                displayMode: 'list',
                placement: 'bottom',
                showLegend: true,
            })
            + timeSeries.options.tooltip.withMaxHeight(600)
            + timeSeries.options.tooltip.withMode('single')
            + timeSeries.options.tooltip.withSort('none')
            + timeSeries.queryOptions.withTransformations([
                {
                    id: 'renameByRegex',
                    options: {
                        regex: '.*batiment="(.*?)".*salle="(.*?)".*site="(.*?)".*',
                        renamePattern: '$2 - $1 - $3',
                    }
                }
            ])

            + timeSeries.fieldConfig.defaults.custom.withAxisBorderShow(value=false)
            + timeSeries.fieldConfig.defaults.custom.withAxisCenteredZero(value=false)
            + timeSeries.fieldConfig.defaults.custom.withAxisColorMode('text')
            + timeSeries.fieldConfig.defaults.custom.withAxisLabel('')
            + timeSeries.fieldConfig.defaults.custom.withAxisPlacement('auto')
            + timeSeries.fieldConfig.defaults.custom.withBarAlignment(0)
            + timeSeries.fieldConfig.defaults.custom.withDrawStyle('line')
            + timeSeries.fieldConfig.defaults.custom.withFillOpacity(0)
            + timeSeries.fieldConfig.defaults.custom.withGradientMode('none')
            + timeSeries.fieldConfig.defaults.custom.withHideFrom({
                    legend: false,
                    tooltip: false,
                    viz: false,
                })
            + timeSeries.fieldConfig.defaults.custom.withInsertNulls(14400000)
            + timeSeries.fieldConfig.defaults.custom.withLineInterpolation('linear')
            + timeSeries.fieldConfig.defaults.custom.withLineStyle({
                    fill: 'solid'
                })
            + timeSeries.fieldConfig.defaults.custom.withScaleDistribution({
                    type: 'linear'
                })
            + timeSeries.fieldConfig.defaults.custom.withShowPoints('never')
            + timeSeries.fieldConfig.defaults.custom.withSpanNulls(false)
            + timeSeries.fieldConfig.defaults.custom.withStacking({
                group: 'A',
                    mode: 'none'
                })
            + timeSeries.fieldConfig.defaults.custom.withThresholdsStyle({
                    mode: 'off'
                })

            + timeSeries.standardOptions.color.withMode('palette-classic')

            + timeSeries.standardOptions.withMappings([])
            + timeSeries.standardOptions.thresholds.withMode('absolute')
            + timeSeries.standardOptions.thresholds.withSteps([
                { color: 'green' },
                { color: 'red', value: 30 },
            ])
            + timeSeries.standardOptions.withOverrides(
                createsOverrides()
            )
        ]),

    ##############################################################################################
    ############################## Row Panel Advanced visualization ##############################
    ##############################################################################################

    local queryRSSI = 'import "strings"\n\nfrom(bucket: "Temperature room USMB")\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n  |> filter(fn: (r) => r["_measurement"] == "value")\n  |> filter(fn: (r) => r["_field"] == "rssi")\n  |> filter(fn: (r) => exists r["site"] and contains(set: ${SITE:json}, value: strings.toLower(v: r["site"])))\n  |> filter(fn: (r) => (exists r["batiment"] and contains(set: ${BUILDING:json}, value: strings.toLower(v: r["batiment"]))) or\n    (exists r["building"] and contains(set: ${BUILDING:json}, value: strings.toLower(v: r["building"]))))\n  |> filter(fn: (r) => (exists r["salle"] and contains(set: ${ROOM:json}, value: strings.toLower(v: r["salle"]))) or\n    (exists r["room"] and contains(set: ${ROOM:json}, value: strings.toLower(v: r["room"]))))\n  |> keep(columns: ["_value", "_time", "_field", "batiment", "salle", "site"])\n  |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false)',
    local querySNR = 'import "strings"\n\nfrom(bucket: "Temperature room USMB")\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n  |> filter(fn: (r) => r["_measurement"] == "value")\n  |> filter(fn: (r) => r["_field"] == "snr")\n  |> filter(fn: (r) => exists r["site"] and contains(set: ${SITE:json}, value: strings.toLower(v: r["site"])))\n  |> filter(fn: (r) => (exists r["batiment"] and contains(set: ${BUILDING:json}, value: strings.toLower(v: r["batiment"]))) or (exists r["building"] and contains(set: ${BUILDING:json}, value: strings.toLower(v: r["building"]))))\n  |> filter(fn: (r) => (exists r["salle"] and contains(set: ${ROOM:json}, value: strings.toLower(v: r["salle"]))) or (exists r["room"] and contains(set: ${ROOM:json}, value: strings.toLower(v: r["room"]))))\n  |> keep(columns: ["_value", "_time", "_field", "batiment", "salle", "site"])\n  |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false)',
    local querySF = 'import "strings"\n\nfrom(bucket: "Temperature room USMB")\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n  |> filter(fn: (r) => r["_measurement"] == "value")\n  |> filter(fn: (r) => r["_field"] == "modulation_lora_spreadingFactor")\n  |> filter(fn: (r) => exists r["site"] and contains(set: ${SITE:json}, value: strings.toLower(v: r["site"])))\n  |> filter(fn: (r) => (exists r["batiment"] and contains(set: ${BUILDING:json}, value: strings.toLower(v: r["batiment"]))) or (exists r["building"] and contains(set: ${BUILDING:json}, value: strings.toLower(v: r["building"]))))\n  |> filter(fn: (r) => (exists r["salle"] and contains(set: ${ROOM:json}, value: strings.toLower(v: r["salle"]))) or (exists r["room"] and contains(set: ${ROOM:json}, value: strings.toLower(v: r["room"]))))\n  |> keep(columns: ["_value", "_time", "_field", "batiment", "salle", "site"])\n  |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false)',

    advancedVisualisations:
        row.new('Advanced Visualisations')
        + row.withGridPos(y=22)
        + row.withCollapsed(value=true)
        + row.withPanels([
            ##############################################################################
            ############################## Time Series RSSI ##############################
            ##############################################################################

            timeSeries.new('RSSI')
            + timeSeries.panelOptions.withGridPos(h=18, w=24, x=0, y=23)
            + timeSeries.queryOptions.withDatasource(type='influxdb', uid=config.datasource)
            + timeSeries.queryOptions.withTargets([
                {
                    datasource: {
                        type: 'influxdb',
                        uid: config.datasource,
                    },
                        refId: 'A',
                        query: editQuery(queryRSSI),
                }
            ])
            + timeSeries.options.legend.withCalcs(['min', 'mean', 'variance'])
            + timeSeries.options.legend.withDisplayMode('table')
            + timeSeries.options.legend.withPlacement('right')
            + timeSeries.options.legend.withShowLegend(true)
            + timeSeries.options.tooltip.withMaxHeight(600)
            + timeSeries.options.tooltip.withMode('single')
            + timeSeries.options.tooltip.withSort('none')
            + timeSeries.standardOptions.color.withMode('palette-classic')
            + timeSeries.fieldConfig.defaults.custom.withAxisBorderShow(value=false)
            + timeSeries.fieldConfig.defaults.custom.withAxisCenteredZero(value=false)
            + timeSeries.fieldConfig.defaults.custom.withAxisColorMode(value='text')
            + timeSeries.fieldConfig.defaults.custom.withAxisLabel(value='')
            + timeSeries.fieldConfig.defaults.custom.withAxisPlacement(value='auto')
            + timeSeries.fieldConfig.defaults.custom.withBarAlignment(value=0)
            + timeSeries.fieldConfig.defaults.custom.withDrawStyle(value='line')
            + timeSeries.fieldConfig.defaults.custom.withFillOpacity(value=0)
            + timeSeries.fieldConfig.defaults.custom.withGradientMode(value='none')
            + timeSeries.fieldConfig.defaults.custom.hideFrom.withLegend(value=false)
            + timeSeries.fieldConfig.defaults.custom.hideFrom.withTooltip(value=false)
            + timeSeries.fieldConfig.defaults.custom.hideFrom.withViz(value=false)
            + timeSeries.fieldConfig.defaults.custom.withInsertNulls(value=14400000)
            + timeSeries.fieldConfig.defaults.custom.withLineInterpolation(value='linear')
            + timeSeries.fieldConfig.defaults.custom.withLineWidth(value=1)
            + timeSeries.fieldConfig.defaults.custom.withPointSize(value=5)
            + timeSeries.fieldConfig.defaults.custom.scaleDistribution.withLinearThreshold(value=0)
            + timeSeries.fieldConfig.defaults.custom.scaleDistribution.withType(value='linear')
            + timeSeries.fieldConfig.defaults.custom.withShowPoints(value='never')
            + timeSeries.fieldConfig.defaults.custom.withSpanNulls(value=false)
            + timeSeries.fieldConfig.defaults.custom.stacking.withGroup(value='A')
            + timeSeries.fieldConfig.defaults.custom.stacking.withMode(value='none')
            + timeSeries.fieldConfig.defaults.custom.thresholdsStyle.withMode(value='off')
            + timeSeries.standardOptions.withMappings([])
            + timeSeries.standardOptions.thresholds.withMode('absolute')
            + timeSeries.standardOptions.thresholds.withSteps([
                { color: 'green', value: null },
                { color: 'red', value: 80 }
            ])
            + timeSeries.standardOptions.withOverrides([
                {
                    matcher: {
                        id: 'byName',
                        options: 'rssi',
                    },
                    properties: [
                        {
                            id: 'unit',
                            value: 'dBm',
                        }
                    ],
                },
                {
                    matcher: {
                        id: "byName",
                        options: "Time"
                    },
                    properties: [
                        {
                            id: "unit",
                            value: "time:LLLL"
                        }
                    ]
                }
            ])
            + timeSeries.queryOptions.withTransformations([
                {
                    id: 'renameByRegex',
                    options: {
                        regex: '.*batiment="(.*?)".*salle="(.*?)".*site="(.*?)".*',
                        renamePattern: '$3- $1 - $2',
                    },
                }
            ]),

            #############################################################################
            ############################## Time Series SNR ##############################
            #############################################################################

            timeSeries.new('SNR')
            + timeSeries.panelOptions.withGridPos(h=15, w=24, x=0, y=41)
            + timeSeries.queryOptions.withDatasource(type='influxdb', uid=config.datasource)
            + timeSeries.queryOptions.withTargets([
                {
                    datasource: {
                        type: 'influxdb',
                        uid: config.datasource,
                    },
                    refId: 'A',
                    query: editQuery(querySNR),
                }
            ])
            + timeSeries.options.legend.withCalcs(['min', 'max', 'mean', 'variance'])
            + timeSeries.options.legend.withDisplayMode('table')
            + timeSeries.options.legend.withPlacement('right')
            + timeSeries.options.legend.withShowLegend(true)
            + timeSeries.options.tooltip.withMaxHeight(600)
            + timeSeries.options.tooltip.withMode('single')
            + timeSeries.options.tooltip.withSort('none')
            + timeSeries.fieldConfig.defaults.custom.withAxisBorderShow(false)
            + timeSeries.fieldConfig.defaults.custom.withAxisCenteredZero(false)
            + timeSeries.fieldConfig.defaults.custom.withAxisColorMode('text')
            + timeSeries.fieldConfig.defaults.custom.withAxisLabel('')
            + timeSeries.fieldConfig.defaults.custom.withAxisPlacement('auto')
            + timeSeries.fieldConfig.defaults.custom.withBarAlignment(0)
            + timeSeries.fieldConfig.defaults.custom.withDrawStyle('line')
            + timeSeries.fieldConfig.defaults.custom.withFillOpacity(0)
            + timeSeries.fieldConfig.defaults.custom.withGradientMode('none')
            + timeSeries.fieldConfig.defaults.custom.hideFrom.withLegend(false)
            + timeSeries.fieldConfig.defaults.custom.hideFrom.withTooltip(false)
            + timeSeries.fieldConfig.defaults.custom.hideFrom.withViz(false)
            + timeSeries.fieldConfig.defaults.custom.withInsertNulls(14400000)
            + timeSeries.fieldConfig.defaults.custom.withLineInterpolation('linear')
            + timeSeries.fieldConfig.defaults.custom.withLineWidth(1)
            + timeSeries.fieldConfig.defaults.custom.withPointSize(5)
            + timeSeries.fieldConfig.defaults.custom.scaleDistribution.withType('linear')
            + timeSeries.fieldConfig.defaults.custom.withShowPoints('never')
            + timeSeries.fieldConfig.defaults.custom.withSpanNulls(false)
            + timeSeries.fieldConfig.defaults.custom.stacking.withGroup('A')
            + timeSeries.fieldConfig.defaults.custom.stacking.withMode('none')
            + timeSeries.fieldConfig.defaults.custom.thresholdsStyle.withMode('off')
            + timeSeries.standardOptions.color.withMode('palette-classic')
            + timeSeries.standardOptions.withMappings([])
            + timeSeries.standardOptions.thresholds.withMode('absolute')
            + timeSeries.standardOptions.thresholds.withSteps([
                { color: 'green', value: null },
                { color: 'red', value: 80 },
            ])
            + timeSeries.standardOptions.withOverrides([
                {
                    matcher: { id: 'byType', options: 'number' },
                    properties: [
                        { id: 'unit', value: 'dB' },
                    ],
                },
                {
                    matcher: {
                        id: "byName",
                        options: "Time"
                    },
                    properties: [
                        {
                            id: "unit",
                            value: "time:LLLL"
                        }
                    ]
                }
            ])
            + timeSeries.queryOptions.withTransformations([
                {
                    id: 'renameByRegex',
                    options: {
                        regex: '.*batiment="(.*?)".*salle="(.*?)".*site="(.*?)".*',
                        renamePattern: '$3- $1 - $2',
                    }
                }
            ]),

            ##########################################################################################
            ############################## Time Series Spreading Factor ##############################
            ##########################################################################################


            timeSeries.new('Spreading Factor')
            + timeSeries.panelOptions.withGridPos(h=10, w=24, x=0, y=56)
            + timeSeries.queryOptions.withDatasource(type='influxdb', uid=config.datasource)
            + timeSeries.queryOptions.withTargets([
                {
                    datasource: {
                        type: 'influxdb',
                        uid: config.datasource,
                    },
                    refId: 'A',
                    query: editQuery(querySF),
                }
            ])
            + timeSeries.options.legend.withCalcs(['min', 'mean', 'variance'])
            + timeSeries.options.legend.withDisplayMode('table')
            + timeSeries.options.legend.withPlacement('right')
            + timeSeries.options.legend.withShowLegend(true)
            + timeSeries.options.tooltip.withMaxHeight(600)
            + timeSeries.options.tooltip.withMode('single')
            + timeSeries.options.tooltip.withSort('none')
            + timeSeries.fieldConfig.defaults.custom.withAxisBorderShow(false)
            + timeSeries.fieldConfig.defaults.custom.withAxisCenteredZero(false)
            + timeSeries.fieldConfig.defaults.custom.withAxisColorMode('text')
            + timeSeries.fieldConfig.defaults.custom.withAxisLabel('')
            + timeSeries.fieldConfig.defaults.custom.withAxisPlacement('auto')
            + timeSeries.fieldConfig.defaults.custom.withAxisSoftMax(12)
            + timeSeries.fieldConfig.defaults.custom.withAxisSoftMin(7)
            + timeSeries.fieldConfig.defaults.custom.withBarAlignment(0)
            + timeSeries.fieldConfig.defaults.custom.withDrawStyle('line')
            + timeSeries.fieldConfig.defaults.custom.withFillOpacity(0)
            + timeSeries.fieldConfig.defaults.custom.withGradientMode('none')
            + timeSeries.fieldConfig.defaults.custom.hideFrom.withLegend(false)
            + timeSeries.fieldConfig.defaults.custom.hideFrom.withTooltip(false)
            + timeSeries.fieldConfig.defaults.custom.hideFrom.withViz(false)
            + timeSeries.fieldConfig.defaults.custom.withInsertNulls(false)
            + timeSeries.fieldConfig.defaults.custom.withLineInterpolation('linear')
            + timeSeries.fieldConfig.defaults.custom.withLineWidth(1)
            + timeSeries.fieldConfig.defaults.custom.withPointSize(5)
            + timeSeries.fieldConfig.defaults.custom.scaleDistribution.withType('linear')
            + timeSeries.fieldConfig.defaults.custom.withShowPoints('auto')
            + timeSeries.fieldConfig.defaults.custom.withSpanNulls(false)
            + timeSeries.fieldConfig.defaults.custom.stacking.withGroup('A')
            + timeSeries.fieldConfig.defaults.custom.stacking.withMode('none')
            + timeSeries.fieldConfig.defaults.custom.thresholdsStyle.withMode('off')
            + timeSeries.standardOptions.color.withMode('palette-classic')
            + timeSeries.standardOptions.withMappings([])
            + timeSeries.standardOptions.thresholds.withMode('absolute')
            + timeSeries.standardOptions.thresholds.withSteps([
                { color: 'green', value: null },
                { color: 'red', value: 80 },
            ])
            + timeSeries.standardOptions.withOverrides([
                {
                    matcher: {
                        id: "byName",
                        options: "Time"
                    },
                    properties: [
                        {
                            id: "unit",
                            value: "time:LLLL"
                        }
                    ]
                }
            ])
            + timeSeries.queryOptions.withTransformations([
                {
                    id: 'renameByRegex',
                    options: {
                    regex: '.*batiment="(.*?)".*salle="(.*?)".*site="(.*?)".*',
                    renamePattern: '$3- $1 - $2',
                    }
                }
            ])
        ])
}
// EOF
