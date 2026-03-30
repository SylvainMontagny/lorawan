import type { WebSocket } from '@fastify/websocket';
import type { ParsedPacket, LivePacket, ChirpStackUplinkEvent, ChirpStackTxAckEvent, ChirpStackAckEvent, ChirpStackDownlinkEvent } from '../types.js';
import { onPacket, removePacketHandler } from '../mqtt/consumer.js';

interface DevicePrefix {
  prefix: number;
  mask: number;
}

interface LiveClient {
  ws: WebSocket;
  gatewayId: string | null;        // null = all gateways
  gatewayIds: Set<string> | null;  // null = no restriction; used for group filtering
  packetTypes: Set<string> | null; // null = all types
  rssiMin: number | null;
  rssiMax: number | null;
  filterMode: string | null;       // 'owned' | 'foreign' | null (all)
  prefixes: DevicePrefix[];
  search: string | null;           // lowercase search string, null = no filter
  sourceMode: 'gateway' | 'chirpstack';  // which source to receive
}

const clients: Set<LiveClient> = new Set();

// In-memory cache of gateway metadata for live broadcast (populated by upsertGateway)
const gatewayNameCache = new Map<string, { name: string | null; alias: string | null; group_name: string | null }>();

// In-memory cache of CS device info keyed by devEui (uppercased), populated on each uplink
const csDeviceCache = new Map<string, { deviceName: string; applicationId: string; applicationName: string | null; devAddr: string | null }>();
// Reverse lookup: devAddr (uppercase) -> devEui (uppercase)
const csDeviceByAddr = new Map<string, string>();

export function updateCsDeviceCache(devEui: string, deviceName: string, applicationId: string, applicationName: string | null, devAddr?: string | null): void {
  const key = devEui.toUpperCase();
  csDeviceCache.set(key, { deviceName, applicationId, applicationName, devAddr: devAddr ?? null });
  if (devAddr) {
    csDeviceByAddr.set(devAddr.toUpperCase(), key);
  }
}

export function updateGatewayCache(
  gatewayId: string,
  name: string | null,
  alias: string | null,
  group_name: string | null
): void {
  gatewayNameCache.set(gatewayId, { name, alias, group_name });
}

export function addLiveClient(
  ws: WebSocket,
  gatewayId: string | null,
  packetTypes: string[] | null = null,
  rssiMin: number | null = null,
  rssiMax: number | null = null,
  filterMode: string | null = null,
  prefixes: DevicePrefix[] = [],
  search: string | null = null,
  gatewayIds: string[] | null = null,
  sourceMode: 'gateway' | 'chirpstack' = 'gateway',
): void {
  const client: LiveClient = {
    ws,
    gatewayId,
    gatewayIds: gatewayIds && gatewayIds.length > 0 ? new Set(gatewayIds) : null,
    packetTypes: packetTypes ? new Set(packetTypes) : null,
    rssiMin,
    rssiMax,
    filterMode,
    prefixes,
    search: search ? search.toLowerCase() : null,
    sourceMode,
  };
  clients.add(client);

  ws.on('close', () => {
    clients.delete(client);
  });

  ws.on('error', () => {
    clients.delete(client);
  });
}

function matchesDeviceFilter(devAddr: string | null, filterMode: string | null, prefixes: DevicePrefix[]): boolean {
  if (!filterMode || prefixes.length === 0) return true;

  // Non-data packets always pass
  if (!devAddr) return true;

  const addrNum = parseInt(devAddr, 16);
  const isOwned = prefixes.some(p => (addrNum & p.mask) === (p.prefix & p.mask));

  if (filterMode === 'owned') return isOwned;
  if (filterMode === 'foreign') return !isOwned;
  return true;
}

export function broadcastCsUplink(event: ChirpStackUplinkEvent): void {
  // Keep device cache fresh (include devAddr for reverse lookup)
  updateCsDeviceCache(event.devEui, event.deviceName, event.applicationId, event.applicationName, event.devAddr);

  const livePacket: LivePacket = {
    timestamp: event.timestamp.getTime(),
    gateway_id: '',  // CS packets have no single gateway
    type: 'data',
    dev_addr: event.devAddr ?? undefined,
    dev_eui: event.devEui,
    operator: event.applicationName ?? event.applicationId,
    data_rate: event.spreadingFactor && event.bandwidth
      ? `SF${event.spreadingFactor}BW${event.bandwidth / 1000}`
      : 'Unknown',
    frequency: event.frequency / 1_000_000,
    snr: event.snr,
    rssi: event.rssi,
    payload_size: event.payloadSize,
    airtime_ms: 0,
    f_cnt: event.fCnt ?? undefined,
    f_port: event.fPort ?? undefined,
    confirmed: event.confirmed ?? undefined,
  };
  const message = JSON.stringify({ ...livePacket, device_name: event.deviceName, source: 'chirpstack' });

  for (const client of clients) {
    if (client.sourceMode !== 'chirpstack') continue;

    // RSSI filter
    if (client.rssiMin != null && event.rssi < client.rssiMin) continue;
    if (client.rssiMax != null && event.rssi > client.rssiMax) continue;

    // Search filter
    if (client.search) {
      const haystack = [event.devEui, event.devAddr, event.deviceName, event.applicationName, event.applicationId]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(client.search)) continue;
    }

    try {
      if (client.ws.readyState === 1) {
        client.ws.send(message);
      }
    } catch {
      clients.delete(client);
    }
  }
}

export function broadcastCsTxAck(event: ChirpStackTxAckEvent): void {
  const livePacket: LivePacket = {
    timestamp: event.timestamp.getTime(),
    gateway_id: event.gatewayId ?? '',
    type: 'tx_ack',
    dev_eui: event.devEui,
    operator: event.applicationName ?? event.applicationId,
    data_rate: event.spreadingFactor && event.bandwidth
      ? `SF${event.spreadingFactor}BW${event.bandwidth / 1000}`
      : 'Unknown',
    frequency: event.frequency / 1_000_000,
    snr: 0,
    rssi: 0,
    payload_size: 0,
    airtime_ms: 0,
    f_cnt: event.fCntDown ?? undefined,
    confirmed: true,
  };
  const message = JSON.stringify({ ...livePacket, device_name: event.deviceName, source: 'chirpstack', tx_status: 'OK' });
  sendToCsClients(message, event.devEui, event.applicationName);
}

export function broadcastCsAck(event: ChirpStackAckEvent): void {
  const livePacket: LivePacket = {
    timestamp: event.timestamp.getTime(),
    gateway_id: '',
    type: 'tx_ack',
    dev_eui: event.devEui,
    operator: event.applicationName ?? event.applicationId,
    data_rate: 'Unknown',
    frequency: 0,
    snr: 0,
    rssi: 0,
    payload_size: 0,
    airtime_ms: 0,
    f_cnt: event.fCntDown ?? undefined,
    confirmed: event.acknowledged,
  };
  const status = event.acknowledged ? 'ACK' : 'NACK';
  const message = JSON.stringify({ ...livePacket, device_name: event.deviceName, source: 'chirpstack', tx_status: status });
  sendToCsClients(message, event.devEui, event.applicationName);
}

export function broadcastCsDownlink(event: ChirpStackDownlinkEvent): void {
  const cached = csDeviceCache.get(event.devEui.toUpperCase());
  const deviceName = cached?.deviceName ?? event.devEui;
  const applicationName = cached?.applicationName ?? null;
  const operator = applicationName ?? event.applicationId;
  // Update devAddr reverse lookup if available
  if (cached?.devAddr) {
    csDeviceByAddr.set(cached.devAddr.toUpperCase(), event.devEui.toUpperCase());
  }

  const livePacket: LivePacket = {
    timestamp: event.timestamp.getTime(),
    gateway_id: '',
    type: 'downlink',
    dev_eui: event.devEui,
    operator,
    data_rate: 'Unknown',
    frequency: 0,
    snr: 0,
    rssi: 0,
    payload_size: event.payloadSize,
    airtime_ms: 0,
    f_port: event.fPort ?? undefined,
    confirmed: event.confirmed,
  };
  const message = JSON.stringify({ ...livePacket, device_name: deviceName, source: 'chirpstack' });
  sendToCsClients(message, event.devEui, applicationName);
}

// Broadcast a gateway-level downlink packet to CS clients if its dev_addr belongs to a CS device
function broadcastGatewayDownlinkToCs(packet: ParsedPacket): void {
  if (!packet.dev_addr) return;
  const devEui = csDeviceByAddr.get(packet.dev_addr.toUpperCase());
  if (!devEui) return;

  const cached = csDeviceCache.get(devEui);
  if (!cached) return;

  const gwRow = gatewayNameCache.get(packet.gateway_id);
  const dataRate = packet.spreading_factor && packet.bandwidth
    ? `SF${packet.spreading_factor}BW${packet.bandwidth / 1000}`
    : 'Unknown';

  const livePacket: LivePacket = {
    timestamp: packet.timestamp.getTime(),
    gateway_id: packet.gateway_id,
    gateway_name: gwRow?.name ?? undefined,
    type: 'downlink',
    dev_eui: devEui,
    dev_addr: packet.dev_addr ?? undefined,
    operator: cached.applicationName ?? cached.applicationId,
    data_rate: dataRate,
    frequency: packet.frequency / 1_000_000,
    snr: 0,
    rssi: 0,
    payload_size: packet.payload_size,
    airtime_ms: packet.airtime_us / 1000,
    f_cnt: packet.f_cnt ?? undefined,
    f_port: packet.f_port ?? undefined,
    confirmed: packet.confirmed ?? undefined,
  };
  const message = JSON.stringify({ ...livePacket, device_name: cached.deviceName, source: 'chirpstack' });
  sendToCsClients(message, devEui, cached.applicationName);
}

function sendToCsClients(message: string, devEui: string, applicationName: string | null): void {
  for (const client of clients) {
    if (client.sourceMode !== 'chirpstack') continue;
    if (client.search) {
      const haystack = [devEui, applicationName].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(client.search)) continue;
    }
    try {
      if (client.ws.readyState === 1) client.ws.send(message);
    } catch {
      clients.delete(client);
    }
  }
}

export function broadcastPacket(packet: ParsedPacket): void {
  const gwRow = gatewayNameCache.get(packet.gateway_id);

  // If this is a gateway downlink for a CS device, also send to CS clients
  if (packet.packet_type === 'downlink') {
    broadcastGatewayDownlinkToCs(packet);
  }

  const livePacket = convertToLivePacket(packet, gwRow);
  const message = JSON.stringify(livePacket);

  for (const client of clients) {
    // Skip CS-mode clients — they only receive CS uplinks
    if (client.sourceMode === 'chirpstack') continue;

    // Filter by gateway if specified
    if (client.gatewayId && client.gatewayId !== packet.gateway_id) {
      continue;
    }
    // Filter by gateway set (group filter)
    if (client.gatewayIds && !client.gatewayIds.has(packet.gateway_id)) {
      continue;
    }

    // Filter by packet type if specified
    if (client.packetTypes && !client.packetTypes.has(packet.packet_type)) {
      continue;
    }

    // RSSI filter (skip downlink/tx_ack which have no RSSI)
    if ((packet.packet_type === 'data' || packet.packet_type === 'join_request') && packet.rssi != null) {
      if (client.rssiMin != null && packet.rssi < client.rssiMin) continue;
      if (client.rssiMax != null && packet.rssi > client.rssiMax) continue;
    }

    // Device ownership filter (only for data/downlink)
    if (packet.packet_type === 'data' || packet.packet_type === 'downlink') {
      if (!matchesDeviceFilter(packet.dev_addr, client.filterMode, client.prefixes)) {
        continue;
      }
    }

    // Search filter — check all text fields including gateway metadata
    if (client.search) {
      const haystack = [
        packet.gateway_id,
        gwRow?.name,
        gwRow?.alias,
        gwRow?.group_name,
        packet.operator,
        packet.dev_addr,
        packet.dev_eui,
        packet.join_eui,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(client.search)) continue;
    }

    try {
      if (client.ws.readyState === 1) {  // OPEN
        client.ws.send(message);
      }
    } catch {
      // Client disconnected
      clients.delete(client);
    }
  }
}

function convertToLivePacket(packet: ParsedPacket, gwRow?: { name: string | null; alias?: string | null; group_name?: string | null }): LivePacket {
  const dataRate = packet.spreading_factor && packet.bandwidth
    ? `SF${packet.spreading_factor}BW${packet.bandwidth / 1000}`
    : 'Unknown';

  const base: LivePacket = {
    timestamp: packet.timestamp.getTime(),
    gateway_id: packet.gateway_id,
    gateway_name: gwRow?.name ?? undefined,
    border_gateway_id: packet.border_gateway_id ?? undefined,
    type: packet.packet_type,
    operator: packet.operator,
    data_rate: dataRate,
    frequency: packet.frequency / 1_000_000,  // Convert to MHz
    snr: packet.snr,
    rssi: packet.rssi,
    payload_size: packet.payload_size,
    airtime_ms: packet.airtime_us / 1000,
  };

  if (packet.packet_type === 'data' || packet.packet_type === 'downlink') {
    return {
      ...base,
      dev_addr: packet.dev_addr ?? undefined,
      f_cnt: packet.f_cnt ?? undefined,
      f_port: packet.f_port ?? undefined,
      confirmed: packet.confirmed ?? undefined,
    };
  } else if (packet.packet_type === 'tx_ack') {
    return {
      ...base,
      tx_status: packet.operator,  // Status name is stored in operator field
      f_cnt: packet.f_cnt ?? undefined,  // downlink_id for correlation
    };
  } else {
    return {
      ...base,
      join_eui: packet.join_eui ?? undefined,
      dev_eui: packet.dev_eui ?? undefined,
    };
  }
}

// Handler for broadcasting packets to WebSocket clients
let broadcastHandler: ((packet: ParsedPacket) => void) | null = null;

export function startLiveBroadcast(): void {
  if (broadcastHandler) return;

  broadcastHandler = (packet) => {
    broadcastPacket(packet);
  };

  onPacket(broadcastHandler);
}

export function stopLiveBroadcast(): void {
  if (broadcastHandler) {
    removePacketHandler(broadcastHandler);
    broadcastHandler = null;
  }
}

export function getClientCount(): number {
  return clients.size;
}
