import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import type { MqttConfig, MqttServerConfig, ParsedPacket, ChirpStackUplinkEvent, ChirpStackTxAckEvent, ChirpStackAckEvent, ChirpStackDownlinkEvent } from '../types.js';
import { parseUplinkFrame, parseProtobufUplink, extractGatewayLocationFromJSON, extractGatewayLocationFromProtobuf, extractGatewayLocationsFromJSON } from '../parser/uplink.js';
import type { GatewayLocation } from '../parser/uplink.js';
import { parseDownlinkFrame, parseProtobufDownlink } from '../parser/downlink.js';
import { parseTxAck, parseProtobufTxAck } from '../parser/txack.js';

type PacketHandler = (packet: ParsedPacket, gatewayLocation?: GatewayLocation | null) => void;
type LocationHandler = (gatewayId: string, location: GatewayLocation) => void;
type ChirpStackUplinkHandler = (event: ChirpStackUplinkEvent) => void;
type ChirpStackTxAckHandler = (event: ChirpStackTxAckEvent) => void;
type ChirpStackAckHandler = (event: ChirpStackAckEvent) => void;
type ChirpStackDownlinkHandler = (event: ChirpStackDownlinkEvent) => void;

let clients: MqttClient[] = [];
let packetHandlers: PacketHandler[] = [];
let locationHandlers: LocationHandler[] = [];
let csUplinkHandlers: ChirpStackUplinkHandler[] = [];
let csTxAckHandlers: ChirpStackTxAckHandler[] = [];
let csAckHandlers: ChirpStackAckHandler[] = [];
let csDownlinkHandlers: ChirpStackDownlinkHandler[] = [];

export function onChirpStackUplink(handler: ChirpStackUplinkHandler): void {
  csUplinkHandlers.push(handler);
}

export function onChirpStackTxAck(handler: ChirpStackTxAckHandler): void {
  csTxAckHandlers.push(handler);
}

export function onChirpStackAck(handler: ChirpStackAckHandler): void {
  csAckHandlers.push(handler);
}

export function onChirpStackDownlink(handler: ChirpStackDownlinkHandler): void {
  csDownlinkHandlers.push(handler);
}

export function onPacket(handler: PacketHandler): void {
  packetHandlers.push(handler);
}

export function onGatewayLocation(handler: LocationHandler): void {
  locationHandlers.push(handler);
}

export function removePacketHandler(handler: PacketHandler): void {
  packetHandlers = packetHandlers.filter(h => h !== handler);
}

export function connectMqtt(config: MqttConfig | MqttServerConfig): MqttClient {
  const options: IClientOptions = {
    username: config.username || undefined,
    password: config.password || undefined,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
  };

  console.log(`Connecting to MQTT broker: ${config.server}`);
  const newClient = mqtt.connect(config.server, options);
  clients.push(newClient);

  newClient.on('connect', () => {
    console.log(`MQTT connected: ${config.server}`);

    newClient.subscribe(config.topic, { qos: 0 }, (err) => {
      if (err) {
        console.error(`MQTT subscribe error for ${config.topic}:`, err);
      } else {
        console.log(`Subscribed to: ${config.topic}`);
      }
    });
  });

  newClient.on('error', (err) => {
    console.error(`MQTT error (${config.server}):`, err.message);
  });

  newClient.on('reconnect', () => {
    console.log(`MQTT reconnecting: ${config.server}`);
  });

  newClient.on('message', (topic, message) => {
    handleMessage(topic, message, config.format);
  });

  return newClient;
}

type EventType = 'up' | 'ack' | 'down' | 'stats' | 'txack' | 'unknown';

function getEventType(topic: string): EventType {
  if (topic.includes('/event/up')) return 'up';
  if (topic.includes('/event/txack')) return 'txack';
  if (topic.includes('/event/ack')) return 'ack';
  if (topic.includes('/command/down')) return 'down';
  if (topic.includes('/event/stats')) return 'stats';
  return 'unknown';
}

function isApplicationTopic(topic: string): boolean {
  return topic.startsWith('application/');
}

function handleMessage(topic: string, message: Buffer, format: 'protobuf' | 'json'): void {
  const eventType = getEventType(topic);

  // Application-level events — handle separately, don't parse as gateway packets
  if (isApplicationTopic(topic)) {
    if (eventType === 'up') handleApplicationUplink(message, format);
    else if (eventType === 'txack') handleApplicationTxAck(message);
    else if (eventType === 'ack') handleApplicationAck(message);
    else if (eventType === 'down') handleApplicationDownlink(topic, message);
    return;
  }

  // Extract gateway ID from topic (e.g. eu868/gateway/{id}/event/up)
  const parts = topic.split('/');
  const gatewayIdx = parts.indexOf('gateway');
  if (gatewayIdx === -1 || gatewayIdx + 1 >= parts.length) {
    return; // Not a gateway topic, skip silently
  }

  const gatewayIdFromTopic = parts[gatewayIdx + 1];
  const timestamp = new Date();
  let packet: ParsedPacket | null = null;
  let gatewayLocation: GatewayLocation | null = null;

  try {
    switch (eventType) {
      case 'up':
        // Uplink frame from device
        if (format === 'json') {
          const frame = JSON.parse(message.toString());
          packet = parseUplinkFrame(frame, timestamp);
          gatewayLocation = extractGatewayLocationFromJSON(frame);
        } else {
          packet = parseProtobufUplink(message, timestamp);
          gatewayLocation = extractGatewayLocationFromProtobuf(message);
        }
        break;

      case 'down':
        // Downlink command sent to gateway for TX
        if (format === 'json') {
          const frame = JSON.parse(message.toString());
          packet = parseDownlinkFrame(frame, timestamp, gatewayIdFromTopic);
        } else {
          packet = parseProtobufDownlink(message, timestamp, gatewayIdFromTopic);
        }
        break;

      case 'ack':
        // TX acknowledgement - confirms downlink was transmitted
        if (format === 'json') {
          const ack = JSON.parse(message.toString());
          packet = parseTxAck(ack, timestamp, gatewayIdFromTopic);
        } else {
          packet = parseProtobufTxAck(message, timestamp, gatewayIdFromTopic);
        }
        break;

      case 'stats':
        // Gateway stats - could be used for monitoring but not packet tracking
        // Skip for now
        break;

      default:
        console.warn('Unknown event type for topic:', topic);
    }

    if (packet) {
      if (gatewayLocation?.name) {
        packet.gateway_name = gatewayLocation.name;
      }

      // Emit to all handlers
      for (const handler of packetHandlers) {
        try {
          handler(packet, gatewayLocation);
        } catch (err) {
          console.error('Packet handler error:', err);
        }
      }
    }
  } catch (err) {
    console.error(`Error parsing ${eventType} message:`, err);
  }
}

function handleApplicationDownlink(topic: string, message: Buffer): void {
  try {
    // Topic: application/{appId}/device/{devEui}/command/down
    const parts = topic.split('/');
    const devIdx = parts.indexOf('device');
    const appIdx = parts.indexOf('application');
    if (devIdx === -1 || appIdx === -1) return;
    const devEui = parts[devIdx + 1];
    const applicationId = parts[appIdx + 1];
    if (!devEui || !applicationId) return;

    const payload = JSON.parse(message.toString()) as Record<string, unknown>;
    const payloadB64 = payload.data as string | undefined;
    const payloadSize = payloadB64 ? Buffer.from(payloadB64, 'base64').length : 0;

    const event: ChirpStackDownlinkEvent = {
      devEui: devEui.toUpperCase(),
      applicationId,
      confirmed: payload.confirmed === true,
      fPort: payload.fPort != null ? Number(payload.fPort) : null,
      payloadSize,
      timestamp: new Date(),
    };

    for (const handler of csDownlinkHandlers) {
      try { handler(event); } catch (err) { console.error('CS downlink handler error:', err); }
    }
  } catch (_) { /* ignore */ }
}

function handleApplicationTxAck(message: Buffer): void {
  try {
    const frame = JSON.parse(message.toString());
    const event = parseChirpStackTxAckEvent(frame);
    if (event && csTxAckHandlers.length > 0) {
      for (const handler of csTxAckHandlers) {
        try { handler(event); } catch (err) { console.error('CS txack handler error:', err); }
      }
    }
  } catch (_) { /* ignore */ }
}

function handleApplicationAck(message: Buffer): void {
  try {
    const frame = JSON.parse(message.toString());
    const event = parseChirpStackAckEvent(frame);
    if (event && csAckHandlers.length > 0) {
      for (const handler of csAckHandlers) {
        try { handler(event); } catch (err) { console.error('CS ack handler error:', err); }
      }
    }
  } catch (_) { /* ignore */ }
}

function parseChirpStackTxAckEvent(frame: Record<string, unknown>): ChirpStackTxAckEvent | null {
  try {
    const deviceInfo = frame.deviceInfo as Record<string, unknown> | undefined;
    if (!deviceInfo) return null;
    const devEui = deviceInfo.devEui as string | undefined;
    if (!devEui) return null;

    const txInfo = frame.txInfo as Record<string, unknown> | undefined;
    const frequency = txInfo ? Number(txInfo.frequency ?? 0) : 0;
    const modulation = txInfo?.modulation as Record<string, unknown> | undefined;
    const lora = modulation?.lora as Record<string, unknown> | undefined;
    const spreadingFactor = lora ? (Number(lora.spreadingFactor ?? 0) || null) : null;
    const bandwidth = lora ? Number(lora.bandwidth ?? 125000) : 125000;
    const power = txInfo?.power != null ? Number(txInfo.power) : null;

    let timestamp = new Date();
    if (frame.time) {
      const parsed = new Date(frame.time as string);
      if (!isNaN(parsed.getTime())) timestamp = parsed;
    }

    return {
      devEui: devEui.toUpperCase(),
      deviceName: (deviceInfo.deviceName as string) ?? '',
      applicationId: (deviceInfo.applicationId as string) ?? '',
      applicationName: (deviceInfo.applicationName as string | undefined) ?? null,
      downlinkId: frame.downlinkId != null ? Number(frame.downlinkId) : null,
      fCntDown: frame.fCntDown != null ? Number(frame.fCntDown) : null,
      gatewayId: (frame.gatewayId as string | undefined) ?? null,
      frequency,
      spreadingFactor: spreadingFactor && spreadingFactor > 0 ? spreadingFactor : null,
      bandwidth,
      power,
      timestamp,
    };
  } catch (_) { return null; }
}

function parseChirpStackAckEvent(frame: Record<string, unknown>): ChirpStackAckEvent | null {
  try {
    const deviceInfo = frame.deviceInfo as Record<string, unknown> | undefined;
    if (!deviceInfo) return null;
    const devEui = deviceInfo.devEui as string | undefined;
    if (!devEui) return null;

    let timestamp = new Date();
    if (frame.time) {
      const parsed = new Date(frame.time as string);
      if (!isNaN(parsed.getTime())) timestamp = parsed;
    }

    return {
      devEui: devEui.toUpperCase(),
      deviceName: (deviceInfo.deviceName as string) ?? '',
      applicationId: (deviceInfo.applicationId as string) ?? '',
      applicationName: (deviceInfo.applicationName as string | undefined) ?? null,
      acknowledged: frame.acknowledged === true,
      fCntDown: frame.fCntDown != null ? Number(frame.fCntDown) : null,
      timestamp,
    };
  } catch (_) { return null; }
}

function handleApplicationUplink(message: Buffer, format: 'protobuf' | 'json'): void {
  // Always try to parse as JSON for ChirpStack Devices events
  // (application integration events are always JSON regardless of gateway bridge format)
  try {
    const frame = JSON.parse(message.toString());

    // Extract gateway locations
    const locations = extractGatewayLocationsFromJSON(frame);
    for (const [gwId, loc] of locations) {
      emitLocation(gwId, loc);
    }

    // Parse as ChirpStack Devices uplink event and emit to CS handlers
    const csEvent = parseChirpStackUplinkEvent(frame);
    if (csEvent && csUplinkHandlers.length > 0) {
      for (const handler of csUplinkHandlers) {
        try {
          handler(csEvent);
        } catch (err) {
          console.error('ChirpStack uplink handler error:', err);
        }
      }
    }
  } catch (jsonErr) {
    // Not JSON — fall back to protobuf location extraction
    if (format !== 'json') {
      try {
        const locations = decodeApplicationUplinkLocations(message);
        for (const [gwId, loc] of locations) {
          emitLocation(gwId, loc);
        }
      } catch (_err) {
        // Silently ignore
      }
    }
  }
}

function parseChirpStackUplinkEvent(frame: Record<string, unknown>): ChirpStackUplinkEvent | null {
  try {
    const deviceInfo = frame.deviceInfo as Record<string, unknown> | undefined;
    if (!deviceInfo) return null;

    const devEui = deviceInfo.devEui as string | undefined;
    if (!devEui) return null;

    const rxInfo = frame.rxInfo as Array<Record<string, unknown>> | undefined;
    const firstRx = rxInfo && rxInfo.length > 0 ? rxInfo[0] : null;
    const rssi = firstRx ? Number(firstRx.rssi ?? 0) : 0;
    const snr = firstRx ? Number(firstRx.snr ?? 0) : 0;

    const txInfo = frame.txInfo as Record<string, unknown> | undefined;
    const frequency = txInfo ? Number(txInfo.frequency ?? 0) : 0;

    const modulation = txInfo?.modulation as Record<string, unknown> | undefined;
    const lora = modulation?.lora as Record<string, unknown> | undefined;
    const spreadingFactor = lora ? Number(lora.spreadingFactor ?? 0) || null : null;
    const bandwidth = lora ? Number(lora.bandwidth ?? 125000) : 125000;

    // Decode payload to get size
    const payloadB64 = frame.data as string | undefined;
    let payloadSize = 0;
    if (payloadB64) {
      try {
        payloadSize = Buffer.from(payloadB64, 'base64').length;
      } catch (_) {
        payloadSize = 0;
      }
    }

    // Parse timestamp
    let timestamp = new Date();
    if (frame.time) {
      const parsed = new Date(frame.time as string);
      if (!isNaN(parsed.getTime())) timestamp = parsed;
    }

    return {
      devEui: devEui.toUpperCase(),
      devAddr: (frame.devAddr as string | undefined) ?? null,
      deviceName: (deviceInfo.deviceName as string) ?? '',
      applicationId: (deviceInfo.applicationId as string) ?? '',
      applicationName: (deviceInfo.applicationName as string | undefined) ?? null,
      rssi,
      snr,
      dr: frame.dr != null ? Number(frame.dr) : null,
      frequency,
      spreadingFactor: spreadingFactor && spreadingFactor > 0 ? spreadingFactor : null,
      bandwidth,
      payloadSize,
      fCnt: frame.fCnt != null ? Number(frame.fCnt) : null,
      fPort: frame.fPort != null ? Number(frame.fPort) : null,
      confirmed: frame.confirmed != null ? Boolean(frame.confirmed) : null,
      timestamp,
    };
  } catch (_err) {
    return null;
  }
}

function emitLocation(gatewayId: string, location: GatewayLocation): void {
  for (const handler of locationHandlers) {
    try {
      handler(gatewayId, location);
    } catch (err) {
      console.error('Location handler error:', err);
    }
  }
}

// Decode rxInfo entries from integration.UplinkEvent protobuf
// Field 12: rxInfo (repeated UplinkRxInfo)
function decodeApplicationUplinkLocations(data: Buffer): Map<string, GatewayLocation> {
  const locations = new Map<string, GatewayLocation>();
  let offset = 0;

  while (offset < data.length) {
    const [tag, newOffset] = readVarint(data, offset);
    offset = newOffset;

    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;

    if (wireType === 2) { // Length-delimited
      const [length, lenOffset] = readVarint(data, offset);
      offset = lenOffset;
      const fieldData = data.subarray(offset, offset + length);
      offset += length;

      if (fieldNumber === 12) { // rxInfo entry
        const rxInfo = decodeRxInfoForLocation(fieldData);
        if (rxInfo.gatewayId && rxInfo.location && !locations.has(rxInfo.gatewayId)) {
          locations.set(rxInfo.gatewayId, rxInfo.location);
        }
      }
    } else if (wireType === 0) {
      const [, nextOffset] = readVarint(data, offset);
      offset = nextOffset;
    } else if (wireType === 5) {
      offset += 4;
    } else if (wireType === 1) {
      offset += 8;
    } else {
      break;
    }
  }

  return locations;
}

// Lightweight rxInfo decoder that only extracts gatewayId, location, and metadata
function decodeRxInfoForLocation(data: Buffer): { gatewayId?: string; location?: GatewayLocation } {
  const result: { gatewayId?: string; location?: GatewayLocation } = {};
  const metadata: Record<string, string> = {};
  let offset = 0;

  while (offset < data.length) {
    const [tag, newOffset] = readVarint(data, offset);
    offset = newOffset;

    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;

    if (wireType === 2) {
      const [length, lenOffset] = readVarint(data, offset);
      offset = lenOffset;
      const fieldData = data.subarray(offset, offset + length);
      offset += length;

      if (fieldNumber === 1) { // gateway_id
        result.gatewayId = fieldData.toString('utf-8');
      } else if (fieldNumber === 12) { // location
        const loc = decodeLocationFromBuffer(fieldData);
        if (loc) result.location = loc;
      } else if (fieldNumber === 15) { // metadata map entry
        const entry = decodeMapEntryFromBuffer(fieldData);
        if (entry) metadata[entry[0]] = entry[1];
      }
    } else if (wireType === 0) {
      // Use BigInt reader to handle negative varints (rssi etc)
      const [, nextOffset] = readVarintBigInt(data, offset);
      offset = nextOffset;
    } else if (wireType === 5) {
      offset += 4;
    } else if (wireType === 1) {
      offset += 8;
    } else {
      break;
    }
  }

  // Fallback: Helium metadata
  if (!result.location && metadata.gateway_lat && metadata.gateway_long) {
    const lat = parseFloat(metadata.gateway_lat);
    const lng = parseFloat(metadata.gateway_long);
    if (!isNaN(lat) && !isNaN(lng) && !(lat === 0 && lng === 0)) {
      result.location = { latitude: lat, longitude: lng };
    }
  }

  if (result.location && metadata.gateway_name) {
    result.location.name = metadata.gateway_name;
  }

  return result;
}

// Minimal protobuf decoders (duplicated to avoid circular deps with uplink.ts internals)
function readVarint(data: Buffer, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  while (offset < data.length) {
    const byte = data[offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift >= 35) break;
  }
  return [value >>> 0, offset];
}

function readVarintBigInt(data: Buffer, offset: number): [bigint, number] {
  let value = BigInt(0);
  let shift = BigInt(0);
  while (offset < data.length) {
    const byte = data[offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += BigInt(7);
  }
  return [value, offset];
}

function decodeLocationFromBuffer(data: Buffer): GatewayLocation | null {
  const loc = { latitude: 0, longitude: 0, altitude: 0 };
  let offset = 0;
  while (offset < data.length) {
    const [tag, newOffset] = readVarint(data, offset);
    offset = newOffset;
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;
    if (wireType === 1) {
      const value = data.readDoubleLE(offset);
      offset += 8;
      if (fieldNumber === 1) loc.latitude = value;
      else if (fieldNumber === 2) loc.longitude = value;
      else if (fieldNumber === 3) loc.altitude = value;
    } else if (wireType === 0) {
      const [, next] = readVarint(data, offset);
      offset = next;
    } else if (wireType === 2) {
      const [len, lo] = readVarint(data, offset);
      offset = lo + len;
    } else if (wireType === 5) {
      offset += 4;
    } else { break; }
  }
  if (loc.latitude === 0 && loc.longitude === 0) return null;
  return loc;
}

function decodeMapEntryFromBuffer(data: Buffer): [string, string] | null {
  let key = '';
  let value = '';
  let offset = 0;
  while (offset < data.length) {
    const [tag, newOffset] = readVarint(data, offset);
    offset = newOffset;
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      const [len, lo] = readVarint(data, offset);
      offset = lo;
      const str = data.subarray(offset, offset + len).toString('utf-8');
      offset += len;
      if (fieldNumber === 1) key = str;
      else if (fieldNumber === 2) value = str;
    } else if (wireType === 0) {
      const [, next] = readVarint(data, offset);
      offset = next;
    } else { break; }
  }
  return key ? [key, value] : null;
}

export function getMqttClient(): MqttClient | null {
  return clients[0] ?? null;
}

export async function disconnectMqtt(): Promise<void> {
  await Promise.all(clients.map(c => new Promise<void>((resolve) => {
    c.end(false, {}, () => resolve());
  })));
  clients = [];
}
