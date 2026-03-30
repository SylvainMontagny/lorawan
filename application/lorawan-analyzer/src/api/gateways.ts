import type { FastifyInstance } from 'fastify';
import {
  getGateways,
  getGatewayById,
  getGatewayOperators,
  getGatewayDevices,
  getGatewayOperatorsWithDeviceCounts,
  getDevicesForGatewayOperator,
  getCsDevices,
  getCsGatewayStats,
  type DeviceFilter,
} from '../db/queries.js';

function parseDeviceFilter(filterMode: string, prefixes?: string): DeviceFilter | undefined {
  if (filterMode === 'all' || !prefixes) return undefined;
  const parsed = prefixes.split(',').map(p => {
    const [hex, bitsStr] = p.split('/');
    const bits = parseInt(bitsStr || '32', 10);
    const prefix = parseInt(hex, 16);
    const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    return { prefix: (prefix & mask) >>> 0, mask };
  });
  if (filterMode === 'owned')   return { include: parsed };
  if (filterMode === 'foreign') return { exclude: parsed };
  return undefined;
}

export async function gatewayRoutes(fastify: FastifyInstance): Promise<void> {
  // List all gateways
  fastify.get<{ Querystring: { hours?: string } }>('/api/gateways', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const gateways = await getGateways(hours);
    return { gateways };
  });

  // Get gateway details
  fastify.get<{ Params: { id: string } }>('/api/gateways/:id', async (request, reply) => {
    const gateway = await getGatewayById(request.params.id);
    if (!gateway) {
      reply.code(404);
      return { error: 'Gateway not found' };
    }
    return { gateway };
  });

  // Get operators seen on gateway
  fastify.get<{
    Params: { id: string };
    Querystring: { hours?: string };
  }>('/api/gateways/:id/operators', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const operators = await getGatewayOperators(request.params.id, hours);
    return { operators };
  });

  // Get devices seen on gateway
  fastify.get<{
    Params: { id: string };
    Querystring: { hours?: string; limit?: string; rssi_min?: string; rssi_max?: string; group_name?: string };
  }>('/api/gateways/:id/devices', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const limit = parseInt(request.query.limit ?? '100', 10);
    const rssiMin = request.query.rssi_min ? parseInt(request.query.rssi_min, 10) : undefined;
    const rssiMax = request.query.rssi_max ? parseInt(request.query.rssi_max, 10) : undefined;
    const groupName = request.query.group_name || null;
    const devices = await getGatewayDevices(request.params.id, hours, limit, rssiMin, rssiMax, groupName);
    return { devices };
  });

  // Get All DevAddr across all gateways with optional filter_mode/source/prefixes/group_name
  fastify.get<{
    Querystring: { hours?: string; limit?: string; group_name?: string; filter_mode?: string; prefixes?: string; source?: string };
  }>('/api/devices', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const limit = parseInt(request.query.limit ?? '500', 10);
    const groupName = request.query.group_name || null;
    const source = request.query.source;
    if (source === 'chirpstack') {
      const csDevices = await getCsDevices(hours, null);
      // Normalise to the same shape as getGatewayDevices so the frontend card works
      const devices = csDevices.map(d => ({
        dev_addr: d.dev_addr ?? d.dev_eui,
        dev_eui: d.dev_eui,
        device_name: d.device_name,
        operator: d.application_name ?? d.application_id,
        packet_count: d.packet_count,
        last_seen: d.last_seen,
        avg_rssi: d.avg_rssi,
        avg_snr: d.avg_snr,
        avg_interval_s: 0,
        missed_packets: 0,
        loss_percent: d.loss_percent,
        min_rssi: null as number | null,
        max_rssi: null as number | null,
        min_snr: null as number | null,
        max_snr: null as number | null,
        min_sf: null as number | null,
        max_sf: null as number | null,
      }));
      return { devices };
    }
    const deviceFilter = parseDeviceFilter(request.query.filter_mode || 'all', request.query.prefixes);
    const devices = await getGatewayDevices(null, hours, limit, undefined, undefined, groupName, deviceFilter);
    return { devices };
  });

  // Get gateway tree (operators with device counts for lazy-load navigation)
  fastify.get<{
    Params: { id: string };
    Querystring: { hours?: string; group_name?: string };
  }>('/api/gateways/:id/tree', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const groupName = request.query.group_name || null;
    const operators = await getGatewayOperatorsWithDeviceCounts(request.params.id, hours, groupName);
    return { operators };
  });

  // Get devices for specific operator on gateway
  fastify.get<{
    Params: { id: string; operator: string };
    Querystring: { hours?: string; limit?: string };
  }>('/api/gateways/:id/operators/:operator/devices', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const limit = parseInt(request.query.limit ?? '50', 10);
    const devices = await getDevicesForGatewayOperator(
      request.params.id,
      decodeURIComponent(request.params.operator),
      hours,
      limit
    );
    return { devices };
  });

  // Get ChirpStack devices (active in time window)
  fastify.get<{
    Querystring: { hours?: string; gateway_id?: string };
  }>('/api/cs-devices', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const gatewayId = request.query.gateway_id || null;
    const devices = await getCsDevices(hours, gatewayId);
    return { devices };
  });

  // Returns gateways active for CS devices with CS-specific packet counts
  fastify.get<{
    Querystring: { hours?: string };
  }>('/api/cs-gateway-ids', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const stats = await getCsGatewayStats(hours);
    return { gateways: stats };
  });
}
