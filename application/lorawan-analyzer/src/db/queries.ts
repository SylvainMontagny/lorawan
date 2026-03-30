import { getDb } from './index.js';
import { updateGatewayCache } from '../websocket/live.js';
import { calculateAirtime } from '../parser/airtime.js';
import type {
  ParsedPacket,
  GatewayStats,
  OperatorStats,
  TimeSeriesPoint,
  DeviceProfile,
  TreeOperator,
  TreeDevice,
  FCntTimelinePoint,
  IntervalHistogram,
  SignalTrendPoint,
  DistributionItem,
  SpectrumStats,
  ChannelStats,
  SFStats,
  JoinEuiGroup,
  ChirpStackUplinkEvent,
  CsDevice,
} from '../types.js';

export type DeviceFilter = {
  include?: Array<{ prefix: number; mask: number }>;
  exclude?: Array<{ prefix: number; mask: number }>;
};

// Build a raw SQL string fragment for gateway filtering by ID or group name.
// When groupName is provided and gatewayId is not, returns an IN subquery.
function buildGatewayFilterSql(tableAlias: string, gatewayId?: string | null, groupName?: string | null): string {
  const col = tableAlias ? `${tableAlias}.gateway_id` : 'gateway_id';
  if (gatewayId && gatewayId !== 'all') {
    return `AND ${col} = '${gatewayId.replace(/'/g, "''")}'`;
  }
  if (groupName) {
    if (groupName === '__none__') {
      return `AND ${col} IN (SELECT gateway_id FROM gateways WHERE group_name IS NULL OR group_name = '')`;
    }
    return `AND ${col} IN (SELECT gateway_id FROM gateways WHERE group_name = '${groupName.replace(/'/g, "''")}')`;
  }
  return '';
}

// Build a raw SQL string fragment for device address filtering.
// Uses the dev_addr_uint32() helper function created in migrations.
function buildDeviceFilterSql(filter?: DeviceFilter): string {
  if (!filter) return '';

  const conditions: string[] = [];

  if (filter.include && filter.include.length > 0) {
    const includeConditions = filter.include.map((r) =>
      `(dev_addr_uint32(dev_addr) & ${r.mask >>> 0} = ${r.prefix >>> 0})`
    );
    conditions.push(`(packet_type NOT IN ('data', 'downlink') OR dev_addr IS NULL OR dev_addr = '' OR (${includeConditions.join(' OR ')}))`);
  }

  if (filter.exclude && filter.exclude.length > 0) {
    const excludeConditions = filter.exclude.map((r) =>
      `(dev_addr_uint32(dev_addr) & ${r.mask >>> 0} != ${r.prefix >>> 0})`
    );
    conditions.push(`(packet_type NOT IN ('data', 'downlink') OR dev_addr IS NULL OR dev_addr = '' OR (${excludeConditions.join(' AND ')}))`);
  }

  return conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';
}

// ============================================
// Packet Insert (batched)
// ============================================

const BATCH_SIZE = 1000;
const FLUSH_INTERVAL_MS = 2000;

type PacketRow = {
  timestamp: Date;
  gateway_id: string;
  packet_type: string;
  dev_addr: string | null;
  join_eui: string | null;
  dev_eui: string | null;
  operator: string;
  frequency: number;
  spreading_factor: number | null;
  bandwidth: number;
  rssi: number;
  snr: number;
  payload_size: number;
  airtime_us: number;
  f_cnt: number | null;
  f_port: number | null;
  confirmed: boolean | null;
  session_id: string | null;
};

let packetBuffer: PacketRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushPacketBuffer(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (packetBuffer.length === 0) return;

  const batch = packetBuffer;
  packetBuffer = [];

  const sql = getDb();
  try {
    await sql`INSERT INTO packets ${sql(batch)}`;
  } catch (err) {
    console.error(`Failed to flush ${batch.length} packets to Postgres:`, err);
    // Re-queue failed packets at the front
    packetBuffer = [...batch, ...packetBuffer];
  }
}

function scheduleFlush(): void {
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPacketBuffer().catch(err => console.error('Packet buffer flush error:', err));
    }, FLUSH_INTERVAL_MS);
  }
}

export async function flushPackets(): Promise<void> {
  await flushPacketBuffer();
}

export async function insertPacket(packet: ParsedPacket): Promise<void> {
  packetBuffer.push({
    timestamp: packet.timestamp,
    gateway_id: packet.gateway_id,
    packet_type: packet.packet_type,
    dev_addr: packet.dev_addr,
    join_eui: packet.join_eui,
    dev_eui: packet.dev_eui,
    operator: packet.operator,
    frequency: packet.frequency,
    spreading_factor: packet.spreading_factor,
    bandwidth: packet.bandwidth,
    rssi: packet.rssi,
    snr: packet.snr,
    payload_size: packet.payload_size,
    airtime_us: packet.airtime_us,
    f_cnt: packet.f_cnt,
    f_port: packet.f_port,
    confirmed: packet.confirmed,
    session_id: packet.session_id ?? null,
  });

  if (packetBuffer.length >= BATCH_SIZE) {
    await flushPacketBuffer();
  } else {
    scheduleFlush();
  }
}

// ============================================
// Gateway Queries
// ============================================

export async function upsertGateway(
  gatewayId: string,
  name: string | null = null,
  location?: { latitude: number; longitude: number; name?: string } | null,
  alias: string | null = null,
  groupName: string | null = null
): Promise<void> {
  const sql = getDb();
  const now = new Date();

  const existing = await sql<Array<{
    first_seen: Date;
    name: string | null;
    alias: string | null;
    group_name: string | null;
    latitude: number | null;
    longitude: number | null;
  }>>`
    SELECT first_seen, name, alias, group_name, latitude, longitude
    FROM gateways WHERE gateway_id = ${gatewayId}
  `;

  const row = existing[0];
  const gwName = name ?? row?.name ?? null;
  const gwAlias = alias ?? row?.alias ?? null;
  const gwGroup = groupName ?? row?.group_name ?? null;
  const lat = location?.latitude ?? row?.latitude ?? null;
  const lng = location?.longitude ?? row?.longitude ?? null;
  const firstSeen = row?.first_seen ?? now;

  await sql`
    INSERT INTO gateways (gateway_id, name, alias, group_name, first_seen, last_seen, latitude, longitude)
    VALUES (${gatewayId}, ${gwName}, ${gwAlias}, ${gwGroup}, ${firstSeen}, ${now}, ${lat}, ${lng})
    ON CONFLICT (gateway_id) DO UPDATE SET
      name       = EXCLUDED.name,
      alias      = EXCLUDED.alias,
      group_name = EXCLUDED.group_name,
      last_seen  = EXCLUDED.last_seen,
      latitude   = EXCLUDED.latitude,
      longitude  = EXCLUDED.longitude
  `;

  // Keep in-memory cache in sync for live broadcast
  updateGatewayCache(gatewayId, gwName, gwAlias, gwGroup);
}

export async function getGateways(hours: number = 24): Promise<GatewayStats[]> {
  const sql = getDb();

  const gateways = await sql<Array<{
    gateway_id: string;
    name: string | null;
    alias: string | null;
    group_name: string | null;
    first_seen: Date;
    last_seen: Date;
    latitude: number | null;
    longitude: number | null;
  }>>`
    SELECT gateway_id, name, alias, group_name, first_seen, last_seen, latitude, longitude
    FROM gateways
  `;

  if (gateways.length === 0) return [];

  // Use packets_hourly for total counts and airtime (efficient)
  // Use raw packets for unique devices (accurate)
  const [aggStats, devStats] = await Promise.all([
    sql<Array<{
      gateway_id: string;
      packet_count: string;
      total_airtime_ms: string;
    }>>`
      SELECT
        gateway_id,
        SUM(packet_count)    AS packet_count,
        SUM(airtime_us_sum) / 1000 AS total_airtime_ms
      FROM packets_hourly
      WHERE hour >= time_bucket('1 hour', NOW() - make_interval(hours => ${hours}))
      GROUP BY gateway_id
    `,
    sql<Array<{
      gateway_id: string;
      unique_devices: string;
    }>>`
      SELECT
        gateway_id,
        COUNT(DISTINCT dev_addr) AS unique_devices
      FROM packets
      WHERE packet_type = 'data'
        AND dev_addr IS NOT NULL
        AND timestamp > NOW() - make_interval(hours => ${hours})
      GROUP BY gateway_id
    `
  ]);

  const aggMap = new Map(aggStats.map(s => [s.gateway_id, s]));
  const devMap = new Map(devStats.map(s => [s.gateway_id, s]));

  return gateways
    .map(gw => {
      const agg = aggMap.get(gw.gateway_id);
      const dev = devMap.get(gw.gateway_id);
      return {
        gateway_id: gw.gateway_id,
        name: gw.name,
        alias: gw.alias,
        group_name: gw.group_name,
        first_seen: gw.first_seen,
        last_seen: gw.last_seen,
        packet_count: Number(agg?.packet_count ?? 0),
        unique_devices: Number(dev?.unique_devices ?? 0),
        total_airtime_ms: Number(agg?.total_airtime_ms ?? 0),
        latitude: gw.latitude,
        longitude: gw.longitude,
      };
    })
    .filter(gw => gw.packet_count >= 10)
    .sort((a, b) => b.packet_count - a.packet_count);
}

export async function getGatewayById(gatewayId: string): Promise<GatewayStats | null> {
  const sql = getDb();

  const gwRows = await sql<Array<{
    gateway_id: string;
    name: string | null;
    alias: string | null;
    group_name: string | null;
    first_seen: Date;
    last_seen: Date;
    latitude: number | null;
    longitude: number | null;
  }>>`
    SELECT gateway_id, name, alias, group_name, first_seen, last_seen, latitude, longitude
    FROM gateways WHERE gateway_id = ${gatewayId}
  `;

  if (gwRows.length === 0) return null;
  const gw = gwRows[0];

  const statsRows = await sql<Array<{
    packet_count: string;
    unique_devices: string;
    total_airtime_ms: string;
  }>>`
    SELECT
      COUNT(*) AS packet_count,
      COUNT(DISTINCT dev_addr) AS unique_devices,
      SUM(airtime_us) / 1000 AS total_airtime_ms
    FROM packets
    WHERE gateway_id = ${gatewayId}
      AND timestamp > NOW() - INTERVAL '24 hours'
  `;
  const stats = statsRows[0] ?? { packet_count: '0', unique_devices: '0', total_airtime_ms: '0' };

  return {
    gateway_id: gw.gateway_id,
    name: gw.name,
    alias: gw.alias,
    group_name: gw.group_name,
    first_seen: gw.first_seen,
    last_seen: gw.last_seen,
    packet_count: Number(stats.packet_count),
    unique_devices: Number(stats.unique_devices),
    total_airtime_ms: Number(stats.total_airtime_ms),
    latitude: gw.latitude,
    longitude: gw.longitude,
  };
}

export async function getGatewayOperators(gatewayId: string, hours: number = 24): Promise<OperatorStats[]> {
  const sql = getDb();

  const rows = await sql<Array<{
    operator: string;
    packet_count: string;
    unique_devices: string;
    total_airtime_ms: string;
  }>>`
    SELECT
      operator,
      COUNT(*) AS packet_count,
      COUNT(DISTINCT dev_addr) AS unique_devices,
      SUM(airtime_us) / 1000 AS total_airtime_ms
    FROM packets
    WHERE gateway_id = ${gatewayId}
      AND timestamp > NOW() - make_interval(hours => ${hours})
    GROUP BY operator
    ORDER BY packet_count DESC
  `;

  return rows.map(r => ({
    operator: r.operator,
    packet_count: Number(r.packet_count),
    unique_devices: Number(r.unique_devices),
    total_airtime_ms: Number(r.total_airtime_ms),
  }));
}

export async function getGatewayDevices(
  gatewayId: string | null,
  hours: number = 24,
  limit: number = 100,
  rssiMin?: number,
  rssiMax?: number,
  groupName?: string | null,
  deviceFilter?: DeviceFilter
): Promise<Array<{
  dev_addr: string;
  operator: string;
  packet_count: number;
  last_seen: string;
  avg_rssi: number;
  min_rssi: number;
  max_rssi: number;
  avg_snr: number;
  min_snr: number;
  max_snr: number;
  min_sf: number;
  max_sf: number;
  avg_interval_s: number;
  missed_packets: number;
  loss_percent: number;
}>> {
  const sql = getDb();

  const gwFilterRaw = buildGatewayFilterSql('', gatewayId, groupName);
  const gwFilterP = buildGatewayFilterSql('p', gatewayId, groupName);
  const devFilterRaw = buildDeviceFilterSql(deviceFilter);
  const devFilterP   = buildDeviceFilterSql(deviceFilter);

  const rssiHaving: string[] = [];
  if (rssiMin !== undefined) rssiHaving.push(`AVG(p.rssi) >= ${rssiMin}`);
  if (rssiMax !== undefined) rssiHaving.push(`AVG(p.rssi) <= ${rssiMax}`);
  const havingClause = rssiHaving.length > 0 ? `HAVING ${rssiHaving.join(' AND ')}` : '';

  const rows = await sql.unsafe(`
    WITH fcnt_gaps AS (
      SELECT
        dev_addr,
        f_cnt,
        LAG(f_cnt) OVER (PARTITION BY dev_addr, COALESCE(session_id, '') ORDER BY timestamp) AS prev_fcnt
      FROM packets
      WHERE packet_type = 'data'
        AND f_cnt IS NOT NULL
        AND timestamp > NOW() - make_interval(hours => ${hours})
        ${gwFilterRaw}
        ${devFilterRaw}
    ),
    loss_stats AS (
      SELECT
        dev_addr,
        SUM(CASE WHEN prev_fcnt IS NOT NULL AND f_cnt > prev_fcnt AND f_cnt - prev_fcnt > 1
            THEN f_cnt - prev_fcnt - 1 ELSE 0 END) AS missed
      FROM fcnt_gaps
      GROUP BY dev_addr
    )
    SELECT
      p.dev_addr,
      MIN(p.operator) AS operator,
      COUNT(*) AS packet_count,
      MAX(p.timestamp) AS last_seen,
      AVG(p.rssi) AS avg_rssi,
      MIN(p.rssi) AS min_rssi,
      MAX(p.rssi) AS max_rssi,
      AVG(p.snr) AS avg_snr,
      MIN(p.snr) AS min_snr,
      MAX(p.snr) AS max_snr,
      MIN(p.spreading_factor) AS min_sf,
      MAX(p.spreading_factor) AS max_sf,
      CASE WHEN COUNT(*) > 1
        THEN (EXTRACT(EPOCH FROM MAX(p.timestamp)) - EXTRACT(EPOCH FROM MIN(p.timestamp))) / (COUNT(*) - 1)
        ELSE 0
      END AS avg_interval_s,
      COALESCE(l.missed, 0) AS missed_packets,
      CASE WHEN COUNT(*) + COALESCE(l.missed, 0) > 0
        THEN COALESCE(l.missed, 0) * 100.0 / (COUNT(*) + COALESCE(l.missed, 0))
        ELSE 0
      END AS loss_percent
    FROM packets p
    LEFT JOIN loss_stats l ON p.dev_addr = l.dev_addr
    WHERE p.packet_type = 'data'
      AND p.timestamp > NOW() - make_interval(hours => ${hours})
      ${gwFilterP}
      ${devFilterP}
    GROUP BY p.dev_addr, l.missed
    ${havingClause}
    ORDER BY packet_count DESC
    LIMIT ${limit}
  `);

  return rows.map((r: Record<string, unknown>) => ({
    dev_addr: r.dev_addr as string,
    operator: r.operator as string,
    packet_count: Number(r.packet_count),
    last_seen: r.last_seen instanceof Date ? r.last_seen.toISOString() : String(r.last_seen),
    avg_rssi: Number(r.avg_rssi),
    min_rssi: Number(r.min_rssi),
    max_rssi: Number(r.max_rssi),
    avg_snr: Number(r.avg_snr),
    min_snr: Number(r.min_snr),
    max_snr: Number(r.max_snr),
    min_sf: Number(r.min_sf),
    max_sf: Number(r.max_sf),
    avg_interval_s: Number(r.avg_interval_s),
    missed_packets: Number(r.missed_packets),
    loss_percent: Number(r.loss_percent),
  }));
}

export async function getDeviceActivity(
  devAddr: string,
  hours: number = 24,
  gatewayId: string | null = null
): Promise<Array<{
  timestamp: string;
  gateway_id: string;
  f_cnt: number | null;
  f_port: number | null;
  rssi: number;
  snr: number;
  spreading_factor: number | null;
  frequency: number;
  payload_size: number;
  airtime_us: number;
}>> {
  const sql = getDb();

  const rows = await sql<Array<{
    timestamp: Date;
    gateway_id: string;
    f_cnt: number | null;
    f_port: number | null;
    rssi: number;
    snr: number;
    spreading_factor: number | null;
    frequency: string;
    payload_size: number;
    airtime_us: number;
  }>>`
    SELECT
      timestamp, gateway_id, f_cnt, f_port, rssi, snr,
      spreading_factor, frequency, payload_size, airtime_us
    FROM packets
    WHERE dev_addr = ${devAddr}
      AND timestamp > NOW() - make_interval(hours => ${hours})
      ${gatewayId ? sql`AND gateway_id = ${gatewayId}` : sql``}
    ORDER BY timestamp DESC
    LIMIT 1000
  `;

  return rows.map(r => ({
    ...r,
    timestamp: r.timestamp.toISOString(),
    frequency: Number(r.frequency),
  }));
}

export async function getDevicePacketLoss(
  devAddr: string,
  hours: number = 24,
  gatewayId: string | null = null
): Promise<{
  total_received: number;
  total_expected: number;
  total_missed: number;
  loss_percent: number;
  per_gateway: Array<{
    gateway_id: string;
    received: number;
    missed: number;
    loss_percent: number;
  }>;
}> {
  const sql = getDb();

  const rows = await sql<Array<{
    gateway_id: string;
    received: string;
    missed: string;
  }>>`
    WITH ordered AS (
      SELECT
        gateway_id,
        f_cnt,
        LAG(f_cnt) OVER (PARTITION BY gateway_id, COALESCE(session_id, '') ORDER BY timestamp) AS prev_fcnt
      FROM packets
      WHERE dev_addr = ${devAddr}
        AND packet_type = 'data'
        AND f_cnt IS NOT NULL
        AND timestamp > NOW() - make_interval(hours => ${hours})
        ${gatewayId ? sql`AND gateway_id = ${gatewayId}` : sql``}
    )
    SELECT
      gateway_id,
      COUNT(*) AS received,
      SUM(CASE WHEN prev_fcnt IS NOT NULL AND f_cnt > prev_fcnt AND f_cnt - prev_fcnt > 1
          THEN f_cnt - prev_fcnt - 1 ELSE 0 END) AS missed
    FROM ordered
    GROUP BY gateway_id
    ORDER BY received DESC
  `;

  const perGateway = rows.map(g => ({
    gateway_id: g.gateway_id,
    received: Number(g.received),
    missed: Number(g.missed),
    loss_percent: (Number(g.received) + Number(g.missed)) > 0
      ? (Number(g.missed) / (Number(g.received) + Number(g.missed))) * 100
      : 0,
  }));

  const totalReceived = perGateway.reduce((sum, g) => sum + g.received, 0);
  const totalMissed = perGateway.reduce((sum, g) => sum + g.missed, 0);
  const totalExpected = totalReceived + totalMissed;

  return {
    total_received: totalReceived,
    total_expected: totalExpected,
    total_missed: totalMissed,
    loss_percent: totalExpected > 0 ? (totalMissed / totalExpected) * 100 : 0,
    per_gateway: perGateway,
  };
}

export async function getJoinRequests(
  gatewayId: string | null = null,
  hours: number = 24,
  limit: number = 100,
  groupName?: string | null
): Promise<Array<{
  timestamp: string;
  gateway_id: string;
  join_eui: string;
  dev_eui: string;
  operator: string;
  rssi: number;
  snr: number;
}>> {
  const sql = getDb();
  const gwFilter = buildGatewayFilterSql('', gatewayId, groupName);

  const rows = await sql.unsafe(`
    SELECT timestamp, gateway_id, join_eui, dev_eui, operator, rssi, snr
    FROM packets
    WHERE packet_type = 'join_request'
      AND timestamp > NOW() - make_interval(hours => ${hours})
      ${gwFilter}
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `) as Array<Record<string, unknown>>;

  return rows.map(r => ({
    timestamp: r.timestamp instanceof Date ? (r.timestamp as Date).toISOString() : String(r.timestamp),
    gateway_id: r.gateway_id as string,
    join_eui: r.join_eui as string,
    dev_eui: r.dev_eui as string,
    operator: r.operator as string,
    rssi: Number(r.rssi),
    snr: Number(r.snr),
  }));
}

export async function getTimeSeries(options: {
  from?: Date;
  to?: Date;
  interval?: string;
  metric?: 'packets' | 'airtime';
  groupBy?: 'gateway' | 'operator';
  gatewayId?: string;
  deviceFilter?: DeviceFilter;
  groupName?: string | null;
}): Promise<TimeSeriesPoint[]> {
  const sql = getDb();

  const {
    from = new Date(Date.now() - 24 * 60 * 60 * 1000),
    to = new Date(),
    interval = '1h',
    metric = 'packets',
    groupBy,
    gatewayId,
    deviceFilter,
    groupName,
  } = options;

  const groupByExpr = groupBy === 'gateway'
    ? 'gateway_id'
    : groupBy === 'operator'
      ? 'operator'
      : null;

  const intervalMap: Record<string, string> = {
    '5m': '5 minutes',
    '15m': '15 minutes',
    '1h': '1 hour',
    '1d': '1 day',
  };
  const bucketInterval = intervalMap[interval] ?? '1 hour';

  // Use continuous aggregate for 1h/1d when no device filter
  if ((interval === '1h' || interval === '1d') && !deviceFilter) {
    const metricCol = metric === 'airtime' ? 'SUM(airtime_us_sum) / 1000000' : 'SUM(packet_count)';
    const operatorFilter = groupByExpr === 'operator' ? `AND packet_type = 'data'` : '';
    const gwFilter = buildGatewayFilterSql('', gatewayId, groupName);

    const selectGroup = groupByExpr ? `, ${groupByExpr} AS group_name` : '';
    const groupExtra = groupByExpr ? `, ${groupByExpr}` : '';

    const rows = await sql.unsafe(`
      SELECT
        time_bucket('${bucketInterval}', hour) AS ts
        ${selectGroup},
        ${metricCol} AS value
      FROM packets_hourly
      WHERE hour >= time_bucket('1 hour', $1::timestamptz)
        AND hour <= time_bucket('1 hour', $2::timestamptz)
        ${gwFilter}
        ${operatorFilter}
      GROUP BY ts ${groupExtra}
      ORDER BY ts ${groupByExpr ? `, ${groupByExpr}` : ''}
    `, [from, to]);

    return (rows as Array<Record<string, unknown>>).map(row => ({
      timestamp: row.ts instanceof Date ? row.ts : new Date(row.ts as string),
      value: Number(row.value),
      group: row.group_name as string | undefined,
    }));
  }

  // Raw packets query for 5m/15m or when device filter applies
  const metricExpr = metric === 'airtime' ? 'SUM(airtime_us) / 1000000.0' : 'COUNT(*)';
  const operatorFilter = groupByExpr === 'operator' ? `AND packet_type = 'data'` : '';
  const gwFilter = buildGatewayFilterSql('', gatewayId, groupName);
  const deviceFilterSql = buildDeviceFilterSql(deviceFilter);

  const selectGroup = groupByExpr ? `, ${groupByExpr} AS group_name` : '';
  const groupExtra = groupByExpr ? `, ${groupByExpr}` : '';

  const rows = await sql.unsafe(`
    SELECT
      time_bucket('${bucketInterval}', timestamp) AS ts
      ${selectGroup},
      ${metricExpr} AS value
    FROM packets
    WHERE timestamp >= $1::timestamptz
      AND timestamp <= $2::timestamptz
      ${gwFilter}
      ${deviceFilterSql}
      ${operatorFilter}
    GROUP BY ts ${groupExtra}
    ORDER BY ts ${groupByExpr ? `, ${groupByExpr}` : ''}
  `, [from, to]);

  return (rows as Array<Record<string, unknown>>).map(row => ({
    timestamp: row.ts instanceof Date ? row.ts : new Date(row.ts as string),
    value: Number(row.value),
    group: row.group_name as string | undefined,
  }));
}

// ============================================
// Custom operators
// ============================================

export async function getCustomOperators(): Promise<Array<{
  id: number;
  prefix: string;
  name: string;
  priority: number;
}>> {
  const sql = getDb();
  const rows = await sql<Array<{ id: number; prefix: string; name: string; priority: number }>>`
    SELECT id, prefix, name, priority FROM custom_operators ORDER BY priority DESC, id
  `;
  return rows;
}

export async function addCustomOperator(prefix: string, name: string, priority: number = 0): Promise<number> {
  const sql = getDb();
  const rows = await sql<Array<{ id: number }>>`
    INSERT INTO custom_operators (prefix, name, priority)
    VALUES (${prefix}, ${name}, ${priority})
    RETURNING id
  `;
  return rows[0].id;
}

export async function deleteCustomOperator(id: number): Promise<void> {
  const sql = getDb();
  await sql`DELETE FROM custom_operators WHERE id = ${id}`;
}

// ============================================
// Hide rules
// ============================================

export async function getHideRules(): Promise<Array<{
  id: number;
  rule_type: string;
  prefix: string;
  description: string | null;
}>> {
  const sql = getDb();
  const rows = await sql<Array<{ id: number; rule_type: string; prefix: string; description: string | null }>>`
    SELECT id, rule_type, prefix, description FROM hide_rules ORDER BY id
  `;
  return rows;
}

export async function addHideRule(
  ruleType: 'dev_addr' | 'join_eui',
  prefix: string,
  description?: string
): Promise<number> {
  const sql = getDb();
  const rows = await sql<Array<{ id: number }>>`
    INSERT INTO hide_rules (rule_type, prefix, description)
    VALUES (${ruleType}, ${prefix}, ${description ?? null})
    RETURNING id
  `;
  return rows[0].id;
}

export async function deleteHideRule(id: number): Promise<void> {
  const sql = getDb();
  await sql`DELETE FROM hide_rules WHERE id = ${id}`;
}

// ============================================
// Tree Navigation Queries
// ============================================

export async function getGatewayOperatorsWithDeviceCounts(
  gatewayId: string,
  hours: number = 24,
  groupName?: string | null
): Promise<TreeOperator[]> {
  const sql = getDb();
  const gwFilter = buildGatewayFilterSql('', gatewayId !== 'all' ? gatewayId : null, groupName);

  const rows = await sql.unsafe(`
    SELECT
      operator,
      COUNT(DISTINCT dev_addr) AS device_count,
      COUNT(*) AS packet_count,
      SUM(airtime_us) / 1000 AS airtime_ms
    FROM packets
    WHERE timestamp > NOW() - make_interval(hours => ${hours})
      AND packet_type = 'data'
      ${gwFilter}
    GROUP BY operator
    ORDER BY packet_count DESC
  `) as Array<Record<string, unknown>>;

  return rows.map(r => ({
    operator: r.operator as string,
    device_count: Number(r.device_count),
    packet_count: Number(r.packet_count),
    airtime_ms: Number(r.airtime_ms),
  }));
}

export async function getDevicesForGatewayOperator(
  gatewayId: string,
  operator: string,
  hours: number = 24,
  limit: number = 50
): Promise<TreeDevice[]> {
  const sql = getDb();

  const rows = await sql<Array<{
    dev_addr: string;
    packet_count: string;
    last_seen: Date;
    avg_rssi: string;
    avg_snr: string;
  }>>`
    SELECT
      dev_addr,
      COUNT(*) AS packet_count,
      MAX(timestamp) AS last_seen,
      AVG(rssi) AS avg_rssi,
      AVG(snr) AS avg_snr
    FROM packets
    WHERE gateway_id = ${gatewayId}
      AND operator = ${operator}
      AND packet_type = 'data'
      AND timestamp > NOW() - make_interval(hours => ${hours})
    GROUP BY dev_addr
    ORDER BY packet_count DESC
    LIMIT ${limit}
  `;

  return rows.map(r => ({
    dev_addr: r.dev_addr,
    packet_count: Number(r.packet_count),
    last_seen: r.last_seen.toISOString(),
    avg_rssi: Number(r.avg_rssi),
    avg_snr: Number(r.avg_snr),
  }));
}

// ============================================
// Device Profile Queries
// ============================================

export async function getDeviceProfile(
  devAddr: string,
  hours: number = 24,
  gatewayId: string | null = null
): Promise<DeviceProfile | null> {
  const sql = getDb();

  const rows = await sql<Array<{
    dev_addr: string;
    operator: string;
    first_seen: Date;
    last_seen: Date;
    packet_count: string;
    total_airtime_ms: string;
    avg_rssi: string;
    avg_snr: string;
  }>>`
    SELECT
      dev_addr,
      MIN(operator) AS operator,
      MIN(timestamp) AS first_seen,
      MAX(timestamp) AS last_seen,
      COUNT(*) AS packet_count,
      SUM(airtime_us) / 1000 AS total_airtime_ms,
      AVG(rssi) AS avg_rssi,
      AVG(snr) AS avg_snr
    FROM packets
    WHERE dev_addr = ${devAddr}
      AND packet_type = 'data'
      AND timestamp > NOW() - make_interval(hours => ${hours})
      ${gatewayId ? sql`AND gateway_id = ${gatewayId}` : sql``}
    GROUP BY dev_addr
  `;

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    dev_addr: r.dev_addr,
    operator: r.operator,
    first_seen: r.first_seen.toISOString(),
    last_seen: r.last_seen.toISOString(),
    packet_count: Number(r.packet_count),
    total_airtime_ms: Number(r.total_airtime_ms),
    avg_rssi: Number(r.avg_rssi),
    avg_snr: Number(r.avg_snr),
  };
}

export async function getDeviceFCntTimeline(
  devAddr: string,
  hours: number = 24
): Promise<FCntTimelinePoint[]> {
  const sql = getDb();

  const rows = await sql<Array<{
    timestamp: Date;
    f_cnt: number;
    gap: boolean;
  }>>`
    SELECT
      timestamp,
      f_cnt,
      CASE WHEN f_cnt IS NOT NULL
        AND LAG(f_cnt) OVER (PARTITION BY COALESCE(session_id, '') ORDER BY timestamp) IS NOT NULL
        AND f_cnt - LAG(f_cnt) OVER (PARTITION BY COALESCE(session_id, '') ORDER BY timestamp) > 1
        THEN TRUE ELSE FALSE
      END AS gap
    FROM packets
    WHERE dev_addr = ${devAddr}
      AND packet_type = 'data'
      AND f_cnt IS NOT NULL
      AND timestamp > NOW() - make_interval(hours => ${hours})
    ORDER BY timestamp
  `;

  return rows.map(r => ({
    timestamp: r.timestamp.toISOString(),
    f_cnt: r.f_cnt,
    gap: r.gap,
  }));
}

export async function getDevicePacketIntervals(
  devAddr: string,
  hours: number = 24
): Promise<IntervalHistogram[]> {
  const sql = getDb();

  const rows = await sql<Array<{
    interval_seconds: string;
    count: string;
  }>>`
    WITH intervals AS (
      SELECT
        EXTRACT(EPOCH FROM (timestamp - LAG(timestamp) OVER (PARTITION BY COALESCE(session_id, '') ORDER BY timestamp)))::bigint AS interval_sec
      FROM packets
      WHERE dev_addr = ${devAddr}
        AND packet_type = 'data'
        AND timestamp > NOW() - make_interval(hours => ${hours})
    )
    SELECT
      (FLOOR(interval_sec / 60) * 60)::bigint AS interval_seconds,
      COUNT(*) AS count
    FROM intervals
    WHERE interval_sec > 0 AND interval_sec < 86400
    GROUP BY interval_seconds
    ORDER BY interval_seconds
  `;

  return rows.map(r => ({
    interval_seconds: Number(r.interval_seconds),
    count: Number(r.count),
  }));
}

export async function getDeviceSignalTrends(
  devAddr: string,
  hours: number = 24,
  _interval: string = '1h',
  gatewayId: string | null = null
): Promise<SignalTrendPoint[]> {
  const sql = getDb();

  const rows = await sql<Array<{
    timestamp: Date;
    avg_rssi: number;
    avg_snr: number;
    packet_count: number;
  }>>`
    SELECT
      timestamp,
      rssi AS avg_rssi,
      snr AS avg_snr,
      1 AS packet_count
    FROM packets
    WHERE dev_addr = ${devAddr}
      AND packet_type = 'data'
      AND timestamp > NOW() - make_interval(hours => ${hours})
      ${gatewayId ? sql`AND gateway_id = ${gatewayId}` : sql``}
    ORDER BY timestamp
    LIMIT 500
  `;

  return rows.map(r => ({
    timestamp: r.timestamp.toISOString(),
    avg_rssi: r.avg_rssi,
    avg_snr: r.avg_snr,
    packet_count: r.packet_count,
  }));
}

export async function getDeviceDistributions(
  devAddr: string,
  hours: number = 24,
  gatewayId: string | null = null
): Promise<{ sf: DistributionItem[]; frequency: DistributionItem[] }> {
  const sql = getDb();

  const sfRows = await sql<Array<{ key: string; value: string; count: string }>>`
    SELECT
      spreading_factor::text AS key,
      spreading_factor AS value,
      COUNT(*) AS count
    FROM packets
    WHERE dev_addr = ${devAddr}
      AND packet_type = 'data'
      AND spreading_factor IS NOT NULL
      AND timestamp > NOW() - make_interval(hours => ${hours})
      ${gatewayId ? sql`AND gateway_id = ${gatewayId}` : sql``}
    GROUP BY spreading_factor
    ORDER BY spreading_factor
  `;

  const freqRows = await sql<Array<{ key: string; value: string; count: string }>>`
    SELECT
      frequency::text AS key,
      frequency AS value,
      COUNT(*) AS count
    FROM packets
    WHERE dev_addr = ${devAddr}
      AND packet_type = 'data'
      AND timestamp > NOW() - make_interval(hours => ${hours})
      ${gatewayId ? sql`AND gateway_id = ${gatewayId}` : sql``}
    GROUP BY frequency
    ORDER BY frequency
  `;

  return {
    sf: sfRows.map(r => ({ key: r.key, value: Number(r.value), count: Number(r.count) })),
    frequency: freqRows.map(r => ({ key: r.key, value: Number(r.value), count: Number(r.count) })),
  };
}

// ============================================
// Spectrum Analysis Queries
// ============================================

export async function getDutyCycleStats(
  gatewayId: string | null,
  hours: number = 1,
  deviceFilter?: DeviceFilter,
  groupName?: string | null
): Promise<SpectrumStats> {
  const sql = getDb();

  const deviceFilterSql = buildDeviceFilterSql(deviceFilter);
  const windowUs = hours * 3600 * 1_000_000;
  const gwFilter = buildGatewayFilterSql('', gatewayId, groupName);

  let rows: Array<{
    rx_airtime_us: string;
    rx_airtime_percent: string;
    tx_airtime_us: string;
    tx_duty_cycle_percent: string;
  }>;

  if (gatewayId && gatewayId !== 'all') {
    rows = await sql.unsafe(`
      SELECT
        SUM(CASE WHEN packet_type NOT IN ('downlink', 'tx_ack') THEN airtime_us ELSE 0 END) AS rx_airtime_us,
        SUM(CASE WHEN packet_type NOT IN ('downlink', 'tx_ack') THEN airtime_us ELSE 0 END)::float / ${windowUs} * 100 AS rx_airtime_percent,
        SUM(CASE WHEN packet_type = 'downlink' THEN airtime_us ELSE 0 END) AS tx_airtime_us,
        SUM(CASE WHEN packet_type = 'downlink' THEN airtime_us ELSE 0 END)::float / ${windowUs} * 100 AS tx_duty_cycle_percent
      FROM packets
      WHERE timestamp > NOW() - make_interval(hours => ${hours})
        ${gwFilter}
        ${deviceFilterSql}
    `);
  } else {
    rows = await sql.unsafe(`
      SELECT
        SUM(gw_rx_airtime_us) AS rx_airtime_us,
        AVG(gw_rx_pct) AS rx_airtime_percent,
        SUM(gw_tx_airtime_us) AS tx_airtime_us,
        AVG(gw_tx_pct) AS tx_duty_cycle_percent
      FROM (
        SELECT
          gateway_id,
          SUM(CASE WHEN packet_type NOT IN ('downlink', 'tx_ack') THEN airtime_us ELSE 0 END) AS gw_rx_airtime_us,
          SUM(CASE WHEN packet_type NOT IN ('downlink', 'tx_ack') THEN airtime_us ELSE 0 END)::float / ${windowUs} * 100 AS gw_rx_pct,
          SUM(CASE WHEN packet_type = 'downlink' THEN airtime_us ELSE 0 END) AS gw_tx_airtime_us,
          SUM(CASE WHEN packet_type = 'downlink' THEN airtime_us ELSE 0 END)::float / ${windowUs} * 100 AS gw_tx_pct
        FROM packets
        WHERE timestamp > NOW() - make_interval(hours => ${hours})
          ${gwFilter}
          ${deviceFilterSql}
        GROUP BY gateway_id
      ) sub
    `);
  }

  const r = (rows as Array<Record<string, unknown>>)[0];
  if (!r) return { rx_airtime_us: 0, rx_airtime_percent: 0, tx_airtime_us: 0, tx_duty_cycle_percent: 0 };
  return {
    rx_airtime_us: Number(r.rx_airtime_us),
    rx_airtime_percent: Number(r.rx_airtime_percent),
    tx_airtime_us: Number(r.tx_airtime_us),
    tx_duty_cycle_percent: Number(r.tx_duty_cycle_percent),
  };
}

export interface DownlinkStats {
  downlinks: number;
  tx_ack_ok: number;
  tx_ack_failed: number;
  tx_ack_duty_cycle: number;
}

export async function getDownlinkStats(
  gatewayId: string | null,
  hours: number = 24,
  groupName?: string | null
): Promise<DownlinkStats> {
  const sql = getDb();
  const gwFilter = buildGatewayFilterSql('', gatewayId, groupName);

  const rows = await sql.unsafe(`
    SELECT
      COUNT(*) FILTER (WHERE packet_type = 'downlink') AS downlinks,
      COUNT(*) FILTER (WHERE packet_type = 'tx_ack' AND f_port = 1) AS tx_ack_ok,
      COUNT(*) FILTER (WHERE packet_type = 'tx_ack' AND f_port NOT IN (0, 1)) AS tx_ack_failed,
      COUNT(*) FILTER (WHERE packet_type = 'tx_ack' AND f_port = 11) AS tx_ack_duty_cycle
    FROM packets
    WHERE timestamp > NOW() - make_interval(hours => ${hours})
      ${gwFilter}
  `) as Array<Record<string, unknown>>;

  const r = rows[0] ?? { downlinks: '0', tx_ack_ok: '0', tx_ack_failed: '0', tx_ack_duty_cycle: '0' };
  return {
    downlinks: Number(r.downlinks),
    tx_ack_ok: Number(r.tx_ack_ok),
    tx_ack_failed: Number(r.tx_ack_failed),
    tx_ack_duty_cycle: Number(r.tx_ack_duty_cycle),
  };
}

// Downlink/ACK stats scoped to CS devices.
// Downlinks are matched by dev_addr; tx_acks have no dev_addr so they are matched
// by joining on f_cnt (DL_ID) to their corresponding downlink row.
export async function getCsDownlinkStats(
  gatewayId: string | null,
  hours: number = 24
): Promise<DownlinkStats> {
  const sql = getDb();
  const gwFilter = gatewayId && gatewayId !== 'all'
    ? `AND gateway_id = '${gatewayId.replace(/'/g, "''")}'`
    : '';

  const csDevAddrSubquery = `
    SELECT dev_addr FROM cs_devices
    WHERE last_seen > NOW() - make_interval(hours => ${hours})
      AND dev_addr IS NOT NULL
  `;

  const rows = await sql.unsafe(`
    SELECT
      -- Downlinks: matched directly by dev_addr
      (SELECT COUNT(*) FROM packets
        WHERE packet_type = 'downlink'
          AND timestamp > NOW() - make_interval(hours => ${hours})
          ${gwFilter}
          AND dev_addr IN (${csDevAddrSubquery})
      ) AS downlinks,
      -- TX ACK OK: f_port=1, joined to a downlink for a CS device via DL_ID (f_cnt)
      (SELECT COUNT(*) FROM packets ack
        WHERE ack.packet_type = 'tx_ack'
          AND ack.timestamp > NOW() - make_interval(hours => ${hours})
          ${gwFilter}
          AND ack.f_port = 1
          AND ack.f_cnt IN (
            SELECT f_cnt FROM packets dl
            WHERE dl.packet_type = 'downlink'
              AND dl.timestamp > NOW() - make_interval(hours => ${hours})
              AND dl.dev_addr IN (${csDevAddrSubquery})
          )
      ) AS tx_ack_ok,
      -- TX ACK Fail: not f_port 0 or 1
      (SELECT COUNT(*) FROM packets ack
        WHERE ack.packet_type = 'tx_ack'
          AND ack.timestamp > NOW() - make_interval(hours => ${hours})
          ${gwFilter}
          AND ack.f_port NOT IN (0, 1)
          AND ack.f_cnt IN (
            SELECT f_cnt FROM packets dl
            WHERE dl.packet_type = 'downlink'
              AND dl.timestamp > NOW() - make_interval(hours => ${hours})
              AND dl.dev_addr IN (${csDevAddrSubquery})
          )
      ) AS tx_ack_failed
  `) as Array<Record<string, unknown>>;

  const r = rows[0] ?? { downlinks: '0', tx_ack_ok: '0', tx_ack_failed: '0' };
  return {
    downlinks: Number(r.downlinks),
    tx_ack_ok: Number(r.tx_ack_ok),
    tx_ack_failed: Number(r.tx_ack_failed),
    tx_ack_duty_cycle: 0,
  };
}


export async function getChannelDistribution(
  gatewayId: string,
  hours: number = 24,
  deviceFilter?: DeviceFilter,
  groupName?: string | null
): Promise<ChannelStats[]> {
  const sql = getDb();

  const gwFilter = buildGatewayFilterSql('', gatewayId !== 'all' ? gatewayId : null, groupName);

  // Use continuous aggregate when no device filter
  if (!deviceFilter && hours >= 1) {
    const rows = await sql.unsafe(`
      SELECT
        frequency,
        packet_count,
        channel_airtime AS airtime_us,
        CASE WHEN total_airtime > 0 THEN channel_airtime::float / total_airtime * 100 ELSE 0 END AS usage_percent
      FROM (
        SELECT
          frequency,
          SUM(packet_count) AS packet_count,
          SUM(airtime_us_sum) AS channel_airtime,
          SUM(SUM(airtime_us_sum)) OVER () AS total_airtime
        FROM packets_channel_sf_hourly
        WHERE hour >= time_bucket('1 hour', NOW() - make_interval(hours => ${hours}))
          ${gwFilter}
        GROUP BY frequency
      ) sub
      ORDER BY frequency
    `);
    return (rows as Array<Record<string, unknown>>).map(r => ({
      frequency: Number(r.frequency),
      packet_count: Number(r.packet_count),
      airtime_us: Number(r.airtime_us),
      usage_percent: Number(r.usage_percent),
    }));
  }

  const deviceFilterSql = buildDeviceFilterSql(deviceFilter);

  const rows = await sql.unsafe(`
    SELECT
      frequency,
      packet_count,
      channel_airtime AS airtime_us,
      CASE WHEN total_airtime > 0 THEN channel_airtime::float / total_airtime * 100 ELSE 0 END AS usage_percent
    FROM (
      SELECT
        frequency,
        COUNT(*) AS packet_count,
        SUM(airtime_us) AS channel_airtime,
        SUM(SUM(airtime_us)) OVER () AS total_airtime
      FROM packets
      WHERE timestamp > NOW() - make_interval(hours => ${hours})
        ${gwFilter}
        ${deviceFilterSql}
      GROUP BY frequency
    ) sub
    ORDER BY frequency
  `);

  return (rows as Array<Record<string, unknown>>).map(r => ({
    frequency: Number(r.frequency),
    packet_count: Number(r.packet_count),
    airtime_us: Number(r.airtime_us),
    usage_percent: Number(r.usage_percent),
  }));
}

export async function getSFDistribution(
  gatewayId: string,
  hours: number = 24,
  deviceFilter?: DeviceFilter,
  groupName?: string | null
): Promise<SFStats[]> {
  const sql = getDb();

  const gwFilter = buildGatewayFilterSql('', gatewayId !== 'all' ? gatewayId : null, groupName);

  // Use continuous aggregate when no device filter
  if (!deviceFilter && hours >= 1) {
    const rows = await sql.unsafe(`
      SELECT
        NULLIF(spreading_factor, 0) AS spreading_factor,
        packet_count,
        sf_airtime AS airtime_us,
        CASE WHEN total_airtime > 0 THEN sf_airtime::float / total_airtime * 100 ELSE 0 END AS usage_percent
      FROM (
        SELECT
          spreading_factor,
          SUM(packet_count) AS packet_count,
          SUM(airtime_us_sum) AS sf_airtime,
          SUM(SUM(airtime_us_sum)) OVER () AS total_airtime
        FROM packets_channel_sf_hourly
        WHERE spreading_factor != 0
          AND hour >= time_bucket('1 hour', NOW() - make_interval(hours => ${hours}))
          ${gwFilter}
        GROUP BY spreading_factor
      ) sub
      ORDER BY spreading_factor
    `);
    return (rows as Array<Record<string, unknown>>).map(r => ({
      spreading_factor: Number(r.spreading_factor),
      packet_count: Number(r.packet_count),
      airtime_us: Number(r.airtime_us),
      usage_percent: Number(r.usage_percent),
    }));
  }

  const deviceFilterSql = buildDeviceFilterSql(deviceFilter);

  const rows = await sql.unsafe(`
    SELECT
      spreading_factor,
      packet_count,
      sf_airtime AS airtime_us,
      CASE WHEN total_airtime > 0 THEN sf_airtime::float / total_airtime * 100 ELSE 0 END AS usage_percent
    FROM (
      SELECT
        spreading_factor,
        COUNT(*) AS packet_count,
        SUM(airtime_us) AS sf_airtime,
        SUM(SUM(airtime_us)) OVER () AS total_airtime
      FROM packets
      WHERE spreading_factor IS NOT NULL
        AND timestamp > NOW() - make_interval(hours => ${hours})
        ${gwFilter}
        ${deviceFilterSql}
      GROUP BY spreading_factor
    ) sub
    ORDER BY spreading_factor
  `);

  return (rows as Array<Record<string, unknown>>).map(r => ({
    spreading_factor: Number(r.spreading_factor),
    packet_count: Number(r.packet_count),
    airtime_us: Number(r.airtime_us),
    usage_percent: Number(r.usage_percent),
  }));
}

// ============================================
// Join Activity Queries
// ============================================

export async function getJoinRequestsByJoinEui(
  gatewayId: string | null = null,
  hours: number = 24
): Promise<JoinEuiGroup[]> {
  const sql = getDb();

  const rows = await sql<Array<{
    join_eui: string;
    operator: string;
    total_attempts: string;
    unique_dev_euis: string;
    first_seen: Date;
    last_seen: Date;
  }>>`
    SELECT
      join_eui,
      MIN(operator) AS operator,
      COUNT(*) AS total_attempts,
      COUNT(DISTINCT dev_eui) AS unique_dev_euis,
      MIN(timestamp) AS first_seen,
      MAX(timestamp) AS last_seen
    FROM packets
    WHERE packet_type = 'join_request'
      AND timestamp > NOW() - make_interval(hours => ${hours})
      ${gatewayId ? sql`AND gateway_id = ${gatewayId}` : sql``}
    GROUP BY join_eui
    ORDER BY total_attempts DESC
  `;

  return rows.map(r => ({
    join_eui: r.join_eui,
    operator: r.operator,
    total_attempts: Number(r.total_attempts),
    unique_dev_euis: Number(r.unique_dev_euis),
    first_seen: r.first_seen.toISOString(),
    last_seen: r.last_seen.toISOString(),
  }));
}

export async function getJoinEuiTimeline(
  joinEui: string,
  hours: number = 24
): Promise<Array<{
  timestamp: string;
  gateway_id: string;
  dev_eui: string;
  rssi: number;
  snr: number;
}>> {
  const sql = getDb();

  const rows = await sql<Array<{
    timestamp: Date;
    gateway_id: string;
    dev_eui: string;
    rssi: number;
    snr: number;
  }>>`
    SELECT timestamp, gateway_id, dev_eui, rssi, snr
    FROM packets
    WHERE packet_type = 'join_request'
      AND join_eui = ${joinEui}
      AND timestamp > NOW() - make_interval(hours => ${hours})
    ORDER BY timestamp DESC
    LIMIT 500
  `;

  return rows.map(r => ({ ...r, timestamp: r.timestamp.toISOString() }));
}

export async function getSummaryStats(
  hours: number = 24,
  gatewayId?: string,
  deviceFilter?: DeviceFilter,
  groupName?: string | null
): Promise<{ total_packets: number; unique_devices: number; total_airtime_ms: number }> {
  const sql = getDb();

  const gwFilter = buildGatewayFilterSql('', gatewayId, groupName);

  // packets_hourly unique_devices is grouped by (hour, gateway_id, operator, packet_type)
  // and cannot be safely summed across any dimension — always use raw packets for unique_devices.
  // Use the aggregate only for total_packets and airtime where SUM is correct.
  if (!deviceFilter && hours >= 1) {
    const [aggRows, devRows] = await Promise.all([
      sql.unsafe(`
        SELECT
          SUM(packet_count) AS total_packets,
          SUM(airtime_us_sum) / 1000 AS total_airtime_ms
        FROM packets_hourly
        WHERE hour >= time_bucket('1 hour', NOW() - make_interval(hours => ${hours}))
          ${gwFilter}
      `),
      sql.unsafe(`
        SELECT COUNT(DISTINCT dev_addr) AS unique_devices
        FROM packets
        WHERE packet_type = 'data'
          AND dev_addr IS NOT NULL
          AND timestamp > NOW() - make_interval(hours => ${hours})
          ${gwFilter}
      `),
    ]);
    const agg = (aggRows as Array<Record<string, unknown>>)[0];
    const dev = (devRows as Array<Record<string, unknown>>)[0];
    return {
      total_packets: Number(agg?.total_packets ?? 0),
      unique_devices: Number(dev?.unique_devices ?? 0),
      total_airtime_ms: Number(agg?.total_airtime_ms ?? 0),
    };
  }

  const deviceFilterSql = buildDeviceFilterSql(deviceFilter);

  const rows = await sql.unsafe(`
    SELECT
      COUNT(*) AS total_packets,
      COUNT(DISTINCT dev_addr) AS unique_devices,
      SUM(airtime_us) / 1000 AS total_airtime_ms
    FROM packets
    WHERE timestamp > NOW() - make_interval(hours => ${hours})
      ${gwFilter}
      ${deviceFilterSql}
  `);

  const r = (rows as Array<Record<string, unknown>>)[0];
  return {
    total_packets: Number(r?.total_packets ?? 0),
    unique_devices: Number(r?.unique_devices ?? 0),
    total_airtime_ms: Number(r?.total_airtime_ms ?? 0),
  };
}

export async function getOperatorStats(
  hours: number = 24,
  gatewayId?: string,
  deviceFilter?: DeviceFilter,
  groupName?: string | null
): Promise<OperatorStats[]> {
  const sql = getDb();

  const gwFilter = buildGatewayFilterSql('', gatewayId, groupName);

  // packets_hourly unique_devices cannot be safely summed across hours or operators.
  // Always use raw packets for unique_devices; use aggregate only for packet_count and airtime.
  if (!deviceFilter && hours >= 1) {
    const [aggRows, devRows] = await Promise.all([
      sql.unsafe(`
        SELECT
          operator,
          SUM(packet_count) AS packet_count,
          SUM(airtime_us_sum) / 1000 AS total_airtime_ms
        FROM packets_hourly
        WHERE hour >= time_bucket('1 hour', NOW() - make_interval(hours => ${hours}))
          AND packet_type = 'data'
          ${gwFilter}
        GROUP BY operator
        ORDER BY packet_count DESC
      `),
      sql.unsafe(`
        SELECT operator, COUNT(DISTINCT dev_addr) AS unique_devices
        FROM packets
        WHERE packet_type = 'data'
          AND dev_addr IS NOT NULL
          AND timestamp > NOW() - make_interval(hours => ${hours})
          ${gwFilter}
        GROUP BY operator
      `),
    ]);
    const devMap = new Map(
      (devRows as Array<Record<string, unknown>>).map(r => [r.operator as string, Number(r.unique_devices)])
    );
    return (aggRows as Array<Record<string, unknown>>).map(r => ({
      operator: r.operator as string,
      packet_count: Number(r.packet_count),
      unique_devices: devMap.get(r.operator as string) ?? 0,
      total_airtime_ms: Number(r.total_airtime_ms),
    }));
  }

  const deviceFilterSql = buildDeviceFilterSql(deviceFilter);

  const rows = await sql.unsafe(`
    SELECT
      operator,
      COUNT(*) AS packet_count,
      COUNT(DISTINCT dev_addr) AS unique_devices,
      SUM(airtime_us) / 1000 AS total_airtime_ms
    FROM packets
    WHERE timestamp > NOW() - make_interval(hours => ${hours})
      AND packet_type = 'data'
      ${gwFilter}
      ${deviceFilterSql}
    GROUP BY operator
    ORDER BY packet_count DESC
  `);

  return (rows as Array<Record<string, unknown>>).map(r => ({
    operator: r.operator as string,
    packet_count: Number(r.packet_count),
    unique_devices: Number(r.unique_devices),
    total_airtime_ms: Number(r.total_airtime_ms),
  }));
}

export async function getRecentPackets(
  limit: number = 100,
  gatewayId?: string,
  deviceFilter?: { include?: Array<{prefix: number, mask: number}>, exclude?: Array<{prefix: number, mask: number}> },
  packetTypes?: string[],
  devAddr?: string,
  hours?: number,
  rssiMin?: number,
  rssiMax?: number,
  search?: string,
  gatewayIds?: string[]
): Promise<Array<{
  timestamp: string;
  gateway_id: string;
  packet_type: string;
  dev_addr: string | null;
  join_eui: string | null;
  dev_eui: string | null;
  operator: string;
  frequency: number;
  spreading_factor: number | null;
  bandwidth: number;
  rssi: number;
  snr: number;
  payload_size: number;
  f_cnt: number | null;
  f_port: number | null;
  confirmed: boolean | null;
  airtime_us: number;
  gateway_name?: string | null;
}>> {
  const sql = getDb();

  // Fetch gateway metadata
  const gwRows = await sql<Array<{ gateway_id: string; name: string | null }>>`
    SELECT gateway_id, name FROM gateways
  `;
  const gatewayMeta = new Map(gwRows.map(g => [g.gateway_id, g]));

  // Build filter SQL fragments (raw strings since we use sql.unsafe for the full query)
  const parts: string[] = ['WHERE 1=1'];

  if (gatewayId) {
    parts.push(`AND p.gateway_id = '${gatewayId.replace(/'/g, "''")}'`);
  }

  if (gatewayIds && gatewayIds.length > 0) {
    const ids = gatewayIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',');
    parts.push(`AND p.gateway_id IN (${ids})`);
  }

  if (devAddr) {
    const safeDevAddr = devAddr.replace(/'/g, "''");
    const hoursClause = hours ? `AND timestamp > NOW() - make_interval(hours => ${hours})` : '';
    parts.push(`AND (p.dev_addr = '${safeDevAddr}' OR (p.packet_type = 'tx_ack' AND p.f_cnt IN (
      SELECT f_cnt FROM packets WHERE dev_addr = '${safeDevAddr}' AND packet_type = 'downlink' ${hoursClause}
    )))`);
  }

  if (hours) {
    parts.push(`AND p.timestamp > NOW() - make_interval(hours => ${hours})`);
  }

  if (rssiMin !== undefined || rssiMax !== undefined) {
    const rssiConds: string[] = [];
    if (rssiMin !== undefined) rssiConds.push(`p.rssi >= ${rssiMin}`);
    if (rssiMax !== undefined) rssiConds.push(`p.rssi <= ${rssiMax}`);
    parts.push(`AND (p.packet_type IN ('tx_ack', 'downlink') OR (${rssiConds.join(' AND ')}))`);
  }

  if (deviceFilter) {
    const conditions: string[] = [];
    if (deviceFilter.include && deviceFilter.include.length > 0) {
      const includeConditions = deviceFilter.include.map((r) =>
        `(dev_addr_uint32(p.dev_addr) & ${r.mask >>> 0} = ${r.prefix >>> 0})`
      );
      conditions.push(`(p.packet_type NOT IN ('data', 'downlink') OR p.dev_addr IS NULL OR p.dev_addr = '' OR (${includeConditions.join(' OR ')}))`);
    }
    if (deviceFilter.exclude && deviceFilter.exclude.length > 0) {
      const excludeConditions = deviceFilter.exclude.map((r) =>
        `(dev_addr_uint32(p.dev_addr) & ${r.mask >>> 0} != ${r.prefix >>> 0})`
      );
      conditions.push(`(p.packet_type NOT IN ('data', 'downlink') OR p.dev_addr IS NULL OR p.dev_addr = '' OR (${excludeConditions.join(' AND ')}))`);
    }
    if (conditions.length > 0) parts.push('AND ' + conditions.join(' AND '));
  }

  if (packetTypes && packetTypes.length > 0 && packetTypes.length < 4) {
    const types = packetTypes.map(t => `'${t.replace(/'/g, "''")}'`).join(', ');
    parts.push(`AND p.packet_type IN (${types})`);
  }

  if (search) {
    const needle = search.replace(/'/g, "''").toLowerCase();
    const chConditions = [
      `p.gateway_id ILIKE '%${needle}%'`,
      `p.operator ILIKE '%${needle}%'`,
      `p.dev_addr ILIKE '%${needle}%'`,
      `p.dev_eui ILIKE '%${needle}%'`,
      `p.join_eui ILIKE '%${needle}%'`,
    ];
    // Gateway metadata matches
    const matchedGwIds = gwRows
      .filter(g => g.name && g.name.toLowerCase().includes(search.toLowerCase()))
      .map(g => `'${g.gateway_id.replace(/'/g, "''")}'`);
    if (matchedGwIds.length > 0) {
      chConditions.push(`p.gateway_id IN (${matchedGwIds.join(',')})`);
    }
    parts.push(`AND (${chConditions.join(' OR ')})`);
  }

  const whereClause = parts.join('\n      ');

  const packets = await sql.unsafe(`
    SELECT
      p.timestamp,
      p.gateway_id,
      p.packet_type,
      p.dev_addr,
      p.join_eui,
      p.dev_eui,
      p.operator,
      p.frequency,
      p.spreading_factor,
      p.bandwidth,
      p.rssi,
      p.snr,
      p.payload_size,
      p.f_cnt,
      p.f_port,
      p.confirmed,
      p.airtime_us
    FROM packets p
    ${whereClause}
    ORDER BY p.timestamp DESC
    LIMIT ${limit}
  `);

  return (packets as Array<Record<string, unknown>>).map(p => {
    const gw = gatewayMeta.get(p.gateway_id as string);
    return {
      timestamp: p.timestamp instanceof Date ? p.timestamp.toISOString() : String(p.timestamp),
      gateway_id: p.gateway_id as string,
      packet_type: p.packet_type as string,
      dev_addr: p.dev_addr as string | null,
      join_eui: p.join_eui as string | null,
      dev_eui: p.dev_eui as string | null,
      operator: p.operator as string,
      frequency: Number(p.frequency),
      spreading_factor: p.spreading_factor != null ? Number(p.spreading_factor) : null,
      bandwidth: Number(p.bandwidth),
      rssi: Number(p.rssi),
      snr: Number(p.snr),
      payload_size: Number(p.payload_size),
      f_cnt: p.f_cnt != null ? Number(p.f_cnt) : null,
      f_port: p.f_port != null ? Number(p.f_port) : null,
      confirmed: p.confirmed as boolean | null,
      airtime_us: Number(p.airtime_us),
      gateway_name: gw?.name ?? null,
    };
  });
}

// ============================================
// ChirpStack Devices Packet Insert (batched)
// ============================================

type CsPacketRow = {
  timestamp: Date;
  dev_eui: string;
  dev_addr: string | null;
  device_name: string;
  application_id: string;
  operator: string;
  frequency: number;
  spreading_factor: number | null;
  bandwidth: number;
  rssi: number;
  snr: number;
  payload_size: number;
  airtime_us: number;
  f_cnt: number | null;
  f_port: number | null;
  confirmed: boolean | null;
};

let csPacketBuffer: CsPacketRow[] = [];
let csFlushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushCsPacketBuffer(): Promise<void> {
  if (csFlushTimer) {
    clearTimeout(csFlushTimer);
    csFlushTimer = null;
  }
  if (csPacketBuffer.length === 0) return;

  const batch = csPacketBuffer;
  csPacketBuffer = [];

  const sql = getDb();
  try {
    await sql`INSERT INTO cs_packets ${sql(batch)}`;
  } catch (err) {
    console.error(`Failed to flush ${batch.length} CS packets to Postgres:`, err);
    csPacketBuffer = [...batch, ...csPacketBuffer];
  }
}

function scheduleCsFlush(): void {
  if (!csFlushTimer) {
    csFlushTimer = setTimeout(() => {
      csFlushTimer = null;
      flushCsPacketBuffer().catch(err => console.error('CS packet buffer flush error:', err));
    }, FLUSH_INTERVAL_MS);
  }
}

export async function flushCsPackets(): Promise<void> {
  await flushCsPacketBuffer();
}

export async function insertCsPacket(event: ChirpStackUplinkEvent): Promise<void> {
  const airtime_us = event.spreadingFactor && event.bandwidth
    ? calculateAirtime({ spreadingFactor: event.spreadingFactor, bandwidth: event.bandwidth, payloadSize: event.payloadSize })
    : 0;

  csPacketBuffer.push({
    timestamp: event.timestamp,
    dev_eui: event.devEui,
    dev_addr: event.devAddr,
    device_name: event.deviceName,
    application_id: event.applicationId,
    operator: event.applicationName ?? event.applicationId,
    frequency: event.frequency,
    spreading_factor: event.spreadingFactor,
    bandwidth: event.bandwidth,
    rssi: event.rssi,
    snr: event.snr,
    payload_size: event.payloadSize,
    airtime_us,
    f_cnt: event.fCnt,
    f_port: event.fPort,
    confirmed: event.confirmed,
  });

  if (csPacketBuffer.length >= BATCH_SIZE) {
    await flushCsPacketBuffer();
  } else {
    scheduleCsFlush();
  }
}

export async function upsertCsDevice(event: ChirpStackUplinkEvent): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO cs_devices (dev_eui, dev_addr, device_name, application_id, application_name, last_seen, packet_count)
    VALUES (${event.devEui}, ${event.devAddr ?? null}, ${event.deviceName}, ${event.applicationId}, ${event.applicationName ?? null}, ${event.timestamp}, 1)
    ON CONFLICT (dev_eui) DO UPDATE SET
      dev_addr         = EXCLUDED.dev_addr,
      device_name      = EXCLUDED.device_name,
      application_id   = EXCLUDED.application_id,
      application_name = EXCLUDED.application_name,
      last_seen        = EXCLUDED.last_seen,
      packet_count     = cs_devices.packet_count + 1
  `;
}

// ============================================
// ChirpStack Query Functions
// ============================================

// Returns gateway stats for gateways that have seen CS devices, with CS packet counts
export async function getCsGatewayStats(hours: number = 24): Promise<Array<{ gateway_id: string; packet_count: number }>> {
  const sql = getDb();
  const rows = await sql.unsafe(`
    SELECT p.gateway_id, COUNT(*) AS packet_count
    FROM packets p
    WHERE p.timestamp > NOW() - make_interval(hours => ${hours})
      AND p.dev_addr IN (
        SELECT dev_addr FROM cs_devices
        WHERE last_seen > NOW() - make_interval(hours => ${hours})
          AND dev_addr IS NOT NULL
      )
    GROUP BY p.gateway_id
  `) as Array<{ gateway_id: string; packet_count: string }>;
  return rows.map(r => ({ gateway_id: r.gateway_id, packet_count: Number(r.packet_count) }));
}

export async function getCsDevices(
  hours: number = 24,
  gatewayId?: string | null
): Promise<CsDevice[]> {
  const sql = getDb();

  // When gatewayId is given, filter by devices whose devAddr appears in that gateway's recent packets
  const gwFilterSql = (gatewayId && gatewayId !== 'all')
    ? `AND d.dev_addr IN (SELECT DISTINCT dev_addr FROM packets WHERE gateway_id = '${gatewayId.replace(/'/g, "''")}' AND timestamp > NOW() - make_interval(hours => ${hours}))`
    : '';

  const rows = await sql.unsafe(`
    WITH pkt_lag AS (
      SELECT
        dev_eui,
        rssi,
        snr,
        f_cnt,
        LAG(f_cnt) OVER (PARTITION BY dev_eui ORDER BY timestamp) AS prev_fcnt
      FROM cs_packets
      WHERE timestamp > NOW() - make_interval(hours => ${hours})
    ),
    pkt_stats AS (
      SELECT
        dev_eui,
        AVG(rssi)  AS avg_rssi,
        AVG(snr)   AS avg_snr,
        COUNT(*)   AS pkt_received,
        SUM(CASE WHEN prev_fcnt IS NOT NULL AND f_cnt > prev_fcnt AND f_cnt - prev_fcnt > 1
                 THEN f_cnt - prev_fcnt - 1 ELSE 0 END) AS pkt_missed
      FROM pkt_lag
      GROUP BY dev_eui
    )
    SELECT
      d.dev_eui,
      d.dev_addr,
      d.device_name,
      d.application_id,
      d.application_name,
      d.last_seen,
      d.packet_count,
      p.avg_rssi,
      p.avg_snr,
      p.pkt_received,
      p.pkt_missed
    FROM cs_devices d
    LEFT JOIN pkt_stats p ON p.dev_eui = d.dev_eui
    WHERE d.last_seen > NOW() - make_interval(hours => ${hours})
    ${gwFilterSql}
    ORDER BY d.last_seen DESC
  `) as Array<Record<string, unknown>>;

  return rows.map(r => {
    const received = Number(r.pkt_received ?? 0);
    const missed   = Number(r.pkt_missed   ?? 0);
    const expected = received + missed;
    return {
      dev_eui: r.dev_eui as string,
      dev_addr: r.dev_addr as string | null,
      device_name: r.device_name as string,
      application_id: r.application_id as string,
      application_name: r.application_name as string | null,
      last_seen: r.last_seen instanceof Date ? r.last_seen.toISOString() : String(r.last_seen),
      packet_count: Number(r.packet_count),
      avg_rssi: r.avg_rssi != null ? Number(r.avg_rssi) : null,
      avg_snr:  r.avg_snr  != null ? Number(r.avg_snr)  : null,
      loss_percent: expected > 0 ? (missed / expected) * 100 : 0,
    };
  });
}

export async function getCsDeviceByEui(devEui: string): Promise<CsDevice | null> {
  const sql = getDb();
  const rows = await sql<Array<{
    dev_eui: string;
    dev_addr: string | null;
    device_name: string;
    application_id: string;
    application_name: string | null;
    last_seen: Date;
    packet_count: string;
  }>>`
    SELECT dev_eui, dev_addr, device_name, application_id, application_name, last_seen, packet_count
    FROM cs_devices WHERE dev_eui = ${devEui.toUpperCase()}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    dev_eui: r.dev_eui,
    dev_addr: r.dev_addr,
    device_name: r.device_name,
    application_id: r.application_id,
    application_name: r.application_name,
    last_seen: r.last_seen.toISOString(),
    packet_count: Number(r.packet_count),
  };
}

export async function getCsSummaryStats(
  hours: number = 24,
  gatewayId?: string | null
): Promise<{ total_packets: number; unique_devices: number; total_airtime_ms: number }> {
  const sql = getDb();

  const gwFilter = (gatewayId && gatewayId !== 'all')
    ? `AND dev_addr IN (SELECT DISTINCT dev_addr FROM packets WHERE gateway_id = '${gatewayId.replace(/'/g, "''")}' AND timestamp > NOW() - make_interval(hours => ${hours}))`
    : '';

  const rows = await sql.unsafe(`
    SELECT
      COUNT(*) AS total_packets,
      COUNT(DISTINCT dev_eui) AS unique_devices,
      SUM(airtime_us) / 1000 AS total_airtime_ms
    FROM cs_packets
    WHERE timestamp > NOW() - make_interval(hours => ${hours})
    ${gwFilter}
  `) as Array<Record<string, unknown>>;

  const r = rows[0];
  return {
    total_packets: Number(r?.total_packets ?? 0),
    unique_devices: Number(r?.unique_devices ?? 0),
    total_airtime_ms: Number(r?.total_airtime_ms ?? 0),
  };
}

export async function getCsOperatorStats(
  hours: number = 24,
  gatewayId?: string | null
): Promise<OperatorStats[]> {
  const sql = getDb();

  const gwFilter = (gatewayId && gatewayId !== 'all')
    ? `AND dev_addr IN (SELECT DISTINCT dev_addr FROM packets WHERE gateway_id = '${gatewayId.replace(/'/g, "''")}' AND timestamp > NOW() - make_interval(hours => ${hours}))`
    : '';

  const rows = await sql.unsafe(`
    SELECT
      operator,
      COUNT(*) AS packet_count,
      COUNT(DISTINCT dev_eui) AS unique_devices,
      SUM(airtime_us) / 1000 AS total_airtime_ms
    FROM cs_packets
    WHERE timestamp > NOW() - make_interval(hours => ${hours})
    ${gwFilter}
    GROUP BY operator
    ORDER BY packet_count DESC
  `) as Array<Record<string, unknown>>;

  return rows.map(r => ({
    operator: r.operator as string,
    packet_count: Number(r.packet_count),
    unique_devices: Number(r.unique_devices),
    total_airtime_ms: Number(r.total_airtime_ms),
  }));
}

export async function getCsTimeSeries(options: {
  from?: Date;
  to?: Date;
  interval?: string;
  metric?: 'packets' | 'airtime';
  gatewayId?: string | null;
}): Promise<TimeSeriesPoint[]> {
  const sql = getDb();

  const {
    from = new Date(Date.now() - 24 * 60 * 60 * 1000),
    to = new Date(),
    interval = '1h',
    metric = 'packets',
    gatewayId,
  } = options;

  const intervalMap: Record<string, string> = {
    '5m': '5 minutes',
    '15m': '15 minutes',
    '1h': '1 hour',
    '1d': '1 day',
  };
  const bucketInterval = intervalMap[interval] ?? '1 hour';

  const metricExpr = metric === 'airtime' ? 'SUM(airtime_us) / 1000000.0' : 'COUNT(*)';

  const gwFilter = (gatewayId && gatewayId !== 'all')
    ? `AND dev_addr IN (SELECT DISTINCT dev_addr FROM packets WHERE gateway_id = '${gatewayId.replace(/'/g, "''")}' AND timestamp BETWEEN $1::timestamptz AND $2::timestamptz)`
    : '';

  const rows = await sql.unsafe(`
    SELECT
      time_bucket('${bucketInterval}', timestamp) AS ts,
      operator AS group_name,
      ${metricExpr} AS value
    FROM cs_packets
    WHERE timestamp >= $1::timestamptz
      AND timestamp <= $2::timestamptz
    ${gwFilter}
    GROUP BY ts, operator
    ORDER BY ts, operator
  `, [from, to]);

  return (rows as Array<Record<string, unknown>>).map(row => ({
    timestamp: row.ts instanceof Date ? row.ts : new Date(row.ts as string),
    value: Number(row.value),
    group: row.group_name as string | undefined,
  }));
}

export async function getCsDutyCycleStats(
  hours: number = 1,
  gatewayId?: string | null
): Promise<SpectrumStats> {
  const sql = getDb();
  const windowUs = hours * 3600 * 1_000_000;

  const csDevAddrSubquery = `
    SELECT dev_addr FROM cs_devices
    WHERE last_seen > NOW() - make_interval(hours => ${hours})
      AND dev_addr IS NOT NULL
  `;

  const gwFilter = (gatewayId && gatewayId !== 'all')
    ? `AND dev_addr IN (SELECT DISTINCT dev_addr FROM packets WHERE gateway_id = '${gatewayId.replace(/'/g, "''")}' AND timestamp > NOW() - make_interval(hours => ${hours}))`
    : '';

  const [rxRows, txRows] = await Promise.all([
    sql.unsafe(`
      SELECT
        SUM(airtime_us) AS rx_airtime_us,
        SUM(airtime_us)::float / ${windowUs} * 100 AS rx_airtime_percent
      FROM cs_packets
      WHERE timestamp > NOW() - make_interval(hours => ${hours})
      ${gwFilter}
    `),
    sql.unsafe(`
      SELECT
        SUM(airtime_us) AS tx_airtime_us,
        SUM(airtime_us)::float / ${windowUs} * 100 AS tx_duty_cycle_percent
      FROM packets
      WHERE packet_type = 'downlink'
        AND timestamp > NOW() - make_interval(hours => ${hours})
        AND dev_addr IN (${csDevAddrSubquery})
        ${gatewayId && gatewayId !== 'all' ? `AND gateway_id = '${gatewayId.replace(/'/g, "''")}'` : ''}
    `),
  ]) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>];

  const rx = rxRows[0];
  const tx = txRows[0];
  return {
    rx_airtime_us: Number(rx?.rx_airtime_us ?? 0),
    rx_airtime_percent: Number(rx?.rx_airtime_percent ?? 0),
    tx_airtime_us: Number(tx?.tx_airtime_us ?? 0),
    tx_duty_cycle_percent: Number(tx?.tx_duty_cycle_percent ?? 0),
  };
}

export async function getCsChannelDistribution(
  hours: number = 24,
  gatewayId?: string | null
): Promise<ChannelStats[]> {
  const sql = getDb();

  const gwFilter = (gatewayId && gatewayId !== 'all')
    ? `AND dev_addr IN (SELECT DISTINCT dev_addr FROM packets WHERE gateway_id = '${gatewayId.replace(/'/g, "''")}' AND timestamp > NOW() - make_interval(hours => ${hours}))`
    : '';

  const rows = await sql.unsafe(`
    SELECT
      frequency,
      COUNT(*) AS packet_count,
      SUM(airtime_us) AS airtime_us,
      SUM(airtime_us)::float / NULLIF(SUM(SUM(airtime_us)) OVER (), 0) * 100 AS usage_percent
    FROM cs_packets
    WHERE timestamp > NOW() - make_interval(hours => ${hours})
    ${gwFilter}
    GROUP BY frequency
    ORDER BY frequency
  `) as Array<Record<string, unknown>>;

  return rows.map(r => ({
    frequency: Number(r.frequency),
    packet_count: Number(r.packet_count),
    airtime_us: Number(r.airtime_us),
    usage_percent: Number(r.usage_percent ?? 0),
  }));
}

export async function getCsSFDistribution(
  hours: number = 24,
  gatewayId?: string | null
): Promise<SFStats[]> {
  const sql = getDb();

  const gwFilter = (gatewayId && gatewayId !== 'all')
    ? `AND dev_addr IN (SELECT DISTINCT dev_addr FROM packets WHERE gateway_id = '${gatewayId.replace(/'/g, "''")}' AND timestamp > NOW() - make_interval(hours => ${hours}))`
    : '';

  const rows = await sql.unsafe(`
    SELECT
      spreading_factor,
      COUNT(*) AS packet_count,
      SUM(airtime_us) AS airtime_us,
      SUM(airtime_us)::float / NULLIF(SUM(SUM(airtime_us)) OVER (), 0) * 100 AS usage_percent
    FROM cs_packets
    WHERE spreading_factor IS NOT NULL
      AND timestamp > NOW() - make_interval(hours => ${hours})
    ${gwFilter}
    GROUP BY spreading_factor
    ORDER BY spreading_factor
  `) as Array<Record<string, unknown>>;

  return rows.map(r => ({
    spreading_factor: Number(r.spreading_factor),
    packet_count: Number(r.packet_count),
    airtime_us: Number(r.airtime_us),
    usage_percent: Number(r.usage_percent ?? 0),
  }));
}

export async function getCsRecentPackets(
  limit: number = 100,
  gatewayId?: string | null
): Promise<Array<{
  timestamp: string;
  dev_eui: string;
  dev_addr: string | null;
  device_name: string;
  application_id: string;
  operator: string;
  frequency: number;
  spreading_factor: number | null;
  bandwidth: number;
  rssi: number;
  snr: number;
  payload_size: number;
  f_cnt: number | null;
  f_port: number | null;
  confirmed: boolean | null;
  airtime_us: number;
}>> {
  const sql = getDb();

  const gwFilter = (gatewayId && gatewayId !== 'all')
    ? `AND dev_addr IN (SELECT DISTINCT dev_addr FROM packets WHERE gateway_id = '${gatewayId.replace(/'/g, "''")}' AND timestamp > NOW() - INTERVAL '24 hours')`
    : '';

  const rows = await sql.unsafe(`
    SELECT
      timestamp, dev_eui, dev_addr, device_name, application_id, operator,
      frequency, spreading_factor, bandwidth, rssi, snr, payload_size,
      f_cnt, f_port, confirmed, airtime_us
    FROM cs_packets
    WHERE 1=1
    ${gwFilter}
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `) as Array<Record<string, unknown>>;

  return rows.map(r => ({
    timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
    dev_eui: r.dev_eui as string,
    dev_addr: r.dev_addr as string | null,
    device_name: r.device_name as string,
    application_id: r.application_id as string,
    operator: r.operator as string,
    frequency: Number(r.frequency),
    spreading_factor: r.spreading_factor != null ? Number(r.spreading_factor) : null,
    bandwidth: Number(r.bandwidth),
    rssi: Number(r.rssi),
    snr: Number(r.snr),
    payload_size: Number(r.payload_size),
    f_cnt: r.f_cnt != null ? Number(r.f_cnt) : null,
    f_port: r.f_port != null ? Number(r.f_port) : null,
    confirmed: r.confirmed as boolean | null,
    airtime_us: Number(r.airtime_us),
  }));
}

export async function getCsDeviceActivity(
  devEui: string,
  hours: number = 24
): Promise<Array<{
  timestamp: string;
  f_cnt: number | null;
  f_port: number | null;
  rssi: number;
  snr: number;
  spreading_factor: number | null;
  frequency: number;
  payload_size: number;
  airtime_us: number;
}>> {
  const sql = getDb();

  const rows = await sql<Array<{
    timestamp: Date;
    f_cnt: number | null;
    f_port: number | null;
    rssi: number;
    snr: number;
    spreading_factor: number | null;
    frequency: string;
    payload_size: number;
    airtime_us: number;
  }>>`
    SELECT timestamp, f_cnt, f_port, rssi, snr, spreading_factor, frequency, payload_size, airtime_us
    FROM cs_packets
    WHERE dev_eui = ${devEui.toUpperCase()}
      AND timestamp > NOW() - make_interval(hours => ${hours})
    ORDER BY timestamp DESC
    LIMIT 1000
  `;

  return rows.map(r => ({
    ...r,
    timestamp: r.timestamp.toISOString(),
    frequency: Number(r.frequency),
  }));
}

export async function getCsDeviceProfile(
  devEui: string,
  hours: number = 24
): Promise<{ dev_eui: string; device_name: string; application_id: string; application_name: string | null; first_seen: string; last_seen: string; packet_count: number; total_airtime_ms: number; avg_rssi: number; avg_snr: number } | null> {
  const sql = getDb();

  const rows = await sql<Array<{
    dev_eui: string;
    device_name: string;
    application_id: string;
    application_name: string | null;
    first_seen: Date;
    last_seen: Date;
    packet_count: string;
    total_airtime_ms: string;
    avg_rssi: string;
    avg_snr: string;
  }>>`
    SELECT
      p.dev_eui,
      MIN(p.device_name) AS device_name,
      MIN(p.application_id) AS application_id,
      d.application_name,
      MIN(p.timestamp) AS first_seen,
      MAX(p.timestamp) AS last_seen,
      COUNT(*) AS packet_count,
      SUM(p.airtime_us) / 1000 AS total_airtime_ms,
      AVG(p.rssi) AS avg_rssi,
      AVG(p.snr) AS avg_snr
    FROM cs_packets p
    LEFT JOIN cs_devices d ON p.dev_eui = d.dev_eui
    WHERE p.dev_eui = ${devEui.toUpperCase()}
      AND p.timestamp > NOW() - make_interval(hours => ${hours})
    GROUP BY p.dev_eui, d.application_name
  `;

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    dev_eui: r.dev_eui,
    device_name: r.device_name,
    application_id: r.application_id,
    application_name: r.application_name,
    first_seen: r.first_seen.toISOString(),
    last_seen: r.last_seen.toISOString(),
    packet_count: Number(r.packet_count),
    total_airtime_ms: Number(r.total_airtime_ms),
    avg_rssi: Number(r.avg_rssi),
    avg_snr: Number(r.avg_snr),
  };
}

export async function getCsDeviceSignalTrends(
  devEui: string,
  hours: number = 24
): Promise<SignalTrendPoint[]> {
  const sql = getDb();

  const rows = await sql<Array<{
    timestamp: Date;
    avg_rssi: number;
    avg_snr: number;
    packet_count: number;
  }>>`
    SELECT timestamp, rssi AS avg_rssi, snr AS avg_snr, 1 AS packet_count
    FROM cs_packets
    WHERE dev_eui = ${devEui.toUpperCase()}
      AND timestamp > NOW() - make_interval(hours => ${hours})
    ORDER BY timestamp
    LIMIT 500
  `;

  return rows.map(r => ({
    timestamp: r.timestamp.toISOString(),
    avg_rssi: r.avg_rssi,
    avg_snr: r.avg_snr,
    packet_count: r.packet_count,
  }));
}

export async function getCsDeviceDistributions(
  devEui: string,
  hours: number = 24
): Promise<{ sf: DistributionItem[]; frequency: DistributionItem[] }> {
  const sql = getDb();

  const sfRows = await sql<Array<{ key: string; value: string; count: string }>>`
    SELECT
      spreading_factor::text AS key,
      spreading_factor AS value,
      COUNT(*) AS count
    FROM cs_packets
    WHERE dev_eui = ${devEui.toUpperCase()}
      AND spreading_factor IS NOT NULL
      AND timestamp > NOW() - make_interval(hours => ${hours})
    GROUP BY spreading_factor
    ORDER BY spreading_factor
  `;

  const freqRows = await sql<Array<{ key: string; value: string; count: string }>>`
    SELECT
      frequency::text AS key,
      frequency AS value,
      COUNT(*) AS count
    FROM cs_packets
    WHERE dev_eui = ${devEui.toUpperCase()}
      AND timestamp > NOW() - make_interval(hours => ${hours})
    GROUP BY frequency
    ORDER BY frequency
  `;

  return {
    sf: sfRows.map(r => ({ key: r.key, value: Number(r.value), count: Number(r.count) })),
    frequency: freqRows.map(r => ({ key: r.key, value: Number(r.value), count: Number(r.count) })),
  };
}

export async function getCsDeviceFCntTimeline(
  devEui: string,
  hours: number = 24
): Promise<FCntTimelinePoint[]> {
  const sql = getDb();

  const rows = await sql<Array<{
    timestamp: Date;
    f_cnt: number;
    gap: boolean;
  }>>`
    SELECT
      timestamp,
      f_cnt,
      CASE WHEN f_cnt IS NOT NULL
        AND LAG(f_cnt) OVER (ORDER BY timestamp) IS NOT NULL
        AND f_cnt - LAG(f_cnt) OVER (ORDER BY timestamp) > 1
        THEN TRUE ELSE FALSE
      END AS gap
    FROM cs_packets
    WHERE dev_eui = ${devEui.toUpperCase()}
      AND f_cnt IS NOT NULL
      AND timestamp > NOW() - make_interval(hours => ${hours})
    ORDER BY timestamp
  `;

  return rows.map(r => ({
    timestamp: r.timestamp.toISOString(),
    f_cnt: r.f_cnt,
    gap: r.gap,
  }));
}

export async function getCsDevicePacketIntervals(
  devEui: string,
  hours: number = 24
): Promise<IntervalHistogram[]> {
  const sql = getDb();

  const rows = await sql<Array<{
    interval_seconds: string;
    count: string;
  }>>`
    WITH intervals AS (
      SELECT
        EXTRACT(EPOCH FROM (timestamp - LAG(timestamp) OVER (ORDER BY timestamp)))::bigint AS interval_sec
      FROM cs_packets
      WHERE dev_eui = ${devEui.toUpperCase()}
        AND timestamp > NOW() - make_interval(hours => ${hours})
    )
    SELECT
      (FLOOR(interval_sec / 60) * 60)::bigint AS interval_seconds,
      COUNT(*) AS count
    FROM intervals
    WHERE interval_sec > 0 AND interval_sec < 86400
    GROUP BY interval_seconds
    ORDER BY interval_seconds
  `;

  return rows.map(r => ({
    interval_seconds: Number(r.interval_seconds),
    count: Number(r.count),
  }));
}

export async function getCsDevicePacketLoss(
  devEui: string,
  hours: number = 24
): Promise<{
  total_received: number;
  total_expected: number;
  total_missed: number;
  loss_percent: number;
  per_gateway: Array<{ gateway_id: string; received: number; missed: number; loss_percent: number }>;
}> {
  const sql = getDb();

  const rows = await sql<Array<{
    received: string;
    missed: string;
  }>>`
    WITH ordered AS (
      SELECT
        f_cnt,
        LAG(f_cnt) OVER (ORDER BY timestamp) AS prev_fcnt
      FROM cs_packets
      WHERE dev_eui = ${devEui.toUpperCase()}
        AND f_cnt IS NOT NULL
        AND timestamp > NOW() - make_interval(hours => ${hours})
    )
    SELECT
      COUNT(*) AS received,
      SUM(CASE WHEN prev_fcnt IS NOT NULL AND f_cnt > prev_fcnt AND f_cnt - prev_fcnt > 1
          THEN f_cnt - prev_fcnt - 1 ELSE 0 END) AS missed
    FROM ordered
  `;

  const r = rows[0] ?? { received: '0', missed: '0' };
  const totalReceived = Number(r.received);
  const totalMissed = Number(r.missed);
  const totalExpected = totalReceived + totalMissed;

  return {
    total_received: totalReceived,
    total_expected: totalExpected,
    total_missed: totalMissed,
    loss_percent: totalExpected > 0 ? (totalMissed / totalExpected) * 100 : 0,
    per_gateway: [],  // CS packets don't have gateway_id
  };
}

export async function getCsDevEuis(): Promise<string[]> {
  const sql = getDb();
  const rows = await sql<Array<{ dev_eui: string }>>`SELECT dev_eui FROM cs_devices`;
  return rows.map(r => r.dev_eui);
}

export async function getCsDevicesForCache(): Promise<Array<{ dev_eui: string; dev_addr: string | null; device_name: string; application_id: string; application_name: string | null }>> {
  const sql = getDb();
  return sql<Array<{ dev_eui: string; dev_addr: string | null; device_name: string; application_id: string; application_name: string | null }>>`
    SELECT dev_eui, dev_addr, device_name, application_id, application_name FROM cs_devices
  `;
}

export async function getCsModeAvailable(): Promise<boolean> {
  const sql = getDb();
  const rows = await sql<Array<{ count: string }>>`SELECT COUNT(*) AS count FROM cs_devices`;
  return Number(rows[0]?.count ?? 0) > 0;
}
