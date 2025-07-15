##################################
# variable_air_quality.libsonnet #
##################################

local grafana = import 'github.com/grafana/grafonnet/gen/grafonnet-latest/main.libsonnet';
local variable = grafana.dashboard.variable;

# For manual testing with jsonnet
#local fullConfig = import '../config_air_quality.json';
#local config = fullConfig.dev;

# For external terraform variable
local config = std.extVar('air_quality_dashboard_config');

# Default Grafana dashboard variables
local oldBucket = 'Temperature room USMB';
local variable1Name = 'SITE';
local variable2Name = 'BUILDING';

# Function that changes bucket, first and second variable names
local editQuery(query) = 
    local bucketChanged = std.strReplace(query, oldBucket, config.bucket);
    local variable1Changed = std.strReplace(bucketChanged, variable1Name, config.variable1Name);
    std.strReplace(variable1Changed, variable2Name, config.variable2Name);

{
    ##################################################################################
    ############################## Variable MEASUREMENT ##############################
    ##################################################################################

    measurement: 
        variable.custom.new(
            'MEASUREMENT',
            config.measurements
        )
        + variable.custom.generalOptions.showOnDashboard.withLabelAndValue()
        + variable.custom.selectionOptions.withIncludeAll(false)
        + variable.custom.selectionOptions.withMulti(false)
    ,

    ###########################################################################
    ############################## Variable SITE ##############################
    ###########################################################################

    querySite: 'import \"influxdata/influxdb/schema\"\r\nimport \"strings\"\r\nimport \"array\"\r\n \r\nsites = schema.tagValues(\r\n  bucket: \"Temperature room USMB\",\r\n  tag: \"site\",\r\n  predicate: (r) => r._field == \"${MEASUREMENT}\",\r\n  start: v.timeRangeStart\r\n)\r\n|> map(fn: (r) => ({ r with site: strings.toLower(v: r._value) }))\r\n|> distinct(column: \"site\")\r\n\r\ndefault = array.from(rows: [{\"_value\": \"none\"}])\r\n\r\nunion(tables: [sites, default])\r\n',
    site: 
        variable.query.new(
            config.variable1Name,
            query = editQuery(self.querySite)
        )
        + variable.query.withDatasource("influxdb", config.datasource)
        + variable.query.selectionOptions.withIncludeAll(value=true)
        + variable.adhoc.generalOptions.withCurrent('All')
        + variable.query.selectionOptions.withMulti(value=true)
        + variable.query.withSort(i=0, type="alphabetical", asc=true, caseInsensitive=false)
        + variable.query.refresh.onLoad()
    ,

    ###############################################################################
    ############################## Variable BUILDING ##############################
    ###############################################################################

    queryBuilding: 'import \"influxdata/influxdb/schema\"\r\nimport \"strings\"\r\nimport \"array\"\r\n\r\nbuildings = schema.tagValues(\r\n  bucket: \"Temperature room USMB\",\r\n  tag: \"batiment\",\r\n  predicate: (r) => r._field == \"${MEASUREMENT}\"\r\n    and exists r[\"site\"]\r\n    and contains(value: strings.toLower(v:r[\"site\"]), set: ${SITE:json}),\r\n  start: v.timeRangeStart\r\n)\r\n|> map(fn: (r) => ({ r with building: strings.toLower(v: r._value) }))\r\n|> distinct(column: \"building\")\r\n\r\ndefault = array.from(rows: [{\"_value\": \"none\"}])\r\n\r\nunion(tables: [buildings, default])',
    building: 
        variable.query.new(
            config.variable2Name,
            query = editQuery(self.queryBuilding)
        )
        + variable.query.withDatasource("influxdb", config.datasource)
        + variable.query.selectionOptions.withIncludeAll(value=true)
        + variable.adhoc.generalOptions.withCurrent('All')
        + variable.query.selectionOptions.withMulti(value=true)
        + variable.query.withSort(i=0, type="alphabetical", asc=true, caseInsensitive=false)
        + variable.query.refresh.onLoad()
    ,

    ###########################################################################
    ############################## Variable ROOM ##############################
    ###########################################################################

    queryRoom: 'import \"influxdata/influxdb/schema\"\r\nimport \"strings\"\r\nimport \"array\"\r\n \r\nrooms = schema.tagValues(\r\n  bucket: \"Temperature room USMB\",\r\n  tag: \"salle\",\r\n  predicate: (r) => \r\n    r._field == \"${MEASUREMENT}\"\r\n    and exists r[\"site\"]\r\n    and exists r[\"batiment\"]\r\n    and contains(value: strings.toLower(v: r[\"site\"]), set: ${SITE:json}) \r\n    and contains(value: strings.toLower(v: r[\"batiment\"]), set: ${BUILDING:json}),\r\n  start: v.timeRangeStart\r\n)\r\n|> map(fn: (r) => ({ r with room: strings.toLower(v: r._value) }))\r\n|> distinct(column: \"room\")\r\n\r\ndefault = array.from(rows: [{\"_value\": \"none\"}])\r\n\r\nunion(tables: [rooms, default])\r\n',
    room: 
        variable.query.new(
            config.variable3Name,
            query = editQuery(self.queryRoom)
        )
        + variable.query.withDatasource("influxdb", config.datasource)
        + variable.query.selectionOptions.withIncludeAll(value=true)
        + variable.adhoc.generalOptions.withCurrent('All')
        + variable.query.selectionOptions.withMulti(value=true)
        + variable.query.withSort(i=0, type="alphabetical", asc=true, caseInsensitive=false)
        + variable.query.refresh.onLoad()
}
//EOF
