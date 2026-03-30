import path from 'path';
import fs from 'fs';
import { loadConfig } from './config.js';
import { initPostgres, closePostgres } from './db/index.js';
import { runMigrations } from './db/migrations.js';
import { insertPacket, flushPackets, upsertGateway, getCustomOperators, insertCsPacket, upsertCsDevice, flushCsPackets, getCsDevicesForCache } from './db/queries.js';
import { connectMqtt, onPacket, onGatewayLocation, disconnectMqtt, onChirpStackUplink, onChirpStackTxAck, onChirpStackAck, onChirpStackDownlink } from './mqtt/consumer.js';
import { initOperatorPrefixes } from './operators/prefixes.js';
import { startApi } from './api/index.js';
import { broadcastCsUplink, broadcastCsTxAck, broadcastCsAck, broadcastCsDownlink, updateCsDeviceCache } from './websocket/live.js';
import { SessionTracker } from './session/tracker.js';
import type { ParsedPacket, MyDeviceRange, OperatorMapping } from './types.js';

const CONFIG_PATH = process.env.CONFIG_PATH ?? './config.toml';

async function seedGatewaysFromCsv(csvPath: string): Promise<void> {
  if (!fs.existsSync(csvPath)) return;
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  for (const line of lines.slice(1)) {
    const [id, name, alias, group, lat, lng] = line.split(',').map(s => s.trim());
    if (!id) continue;
    const location = (lat && lng)
      ? { latitude: parseFloat(lat), longitude: parseFloat(lng) }
      : null;
    await upsertGateway(id, name || null, location, alias || null, group || null);
  }
  console.log(`Seeded gateways from ${csvPath}`);
}

function buildKnownDeviceRanges(operators: OperatorMapping[]): MyDeviceRange[] {
  const ranges: MyDeviceRange[] = [];

  for (const op of operators) {
    if (!op.known_devices || !op.prefix) continue;
    const prefixes = Array.isArray(op.prefix) ? op.prefix : [op.prefix];
    for (const prefix of prefixes) {
      ranges.push({
        type: 'dev_addr',
        prefix,
        description: op.name,
      });
    }
  }

  return ranges;
}

async function main(): Promise<void> {
  console.log('LoRaWAN Analyzer starting...');

  // Load configuration
  const config = loadConfig(CONFIG_PATH);
  console.log('Configuration loaded');

  // Initialize Postgres
  initPostgres(config.postgres);
  console.log(`Postgres client initialized: ${config.postgres.url}`);

  // Run migrations
  await runMigrations();

  // Pre-populate CS device cache from DB (for devAddr→devEui reverse lookup)
  const cachedDevices = await getCsDevicesForCache();
  for (const d of cachedDevices) {
    updateCsDeviceCache(d.dev_eui, d.device_name, d.application_id, d.application_name, d.dev_addr);
  }
  console.log(`Pre-populated CS device cache: ${cachedDevices.length} devices`);

  // Seed gateway names from gateways.csv if present
  const csvPath = path.resolve(path.dirname(path.resolve(CONFIG_PATH)), 'data', 'gateways.csv');
  await seedGatewaysFromCsv(csvPath);

  // Load custom operators from DB and config
  const dbOperators = await getCustomOperators();
  const allOperators = [...dbOperators, ...config.operators];
  initOperatorPrefixes(allOperators);
  console.log(`Loaded ${allOperators.length} custom operator mappings`);

  // Initialize session tracker
  const sessionTracker = new SessionTracker();
  sessionTrackerRef = sessionTracker;

  // Connect to MQTT (non-blocking, auto-reconnects)
  connectMqtt(config.mqtt);
  for (const srv of config.mqtt_servers ?? []) {
    connectMqtt(srv);
  }

  // Handle incoming packets
  onPacket(async (packet: ParsedPacket, gatewayLocation) => {
    try {
      // Enrich packet with session tracking
      const sessionResult = sessionTracker.processPacket(packet);
      if (sessionResult.session_id) {
        packet.session_id = sessionResult.session_id;
      }
      if (sessionResult.dev_eui && !packet.dev_eui) {
        packet.dev_eui = sessionResult.dev_eui;
      }

      // Insert packet into database
      await insertPacket(packet);

      // Update gateway (with location and name if available from uplink metadata)
      await upsertGateway(packet.gateway_id, gatewayLocation?.name ?? null, gatewayLocation);

      // If packet was relayed, also track the border gateway
      if (packet.border_gateway_id) {
        await upsertGateway(packet.border_gateway_id, null, null);
      }

      // Log packet info
      let info: string;
      let logLine: string;

      if (packet.packet_type === 'data') {
        info = `DevAddr=${packet.dev_addr} FCnt=${packet.f_cnt} FPort=${packet.f_port}`;
        logLine = `[${packet.gateway_id}] ${packet.packet_type.padEnd(12)} | ${info} | ` +
          `${packet.operator} | SF${packet.spreading_factor} | ` +
          `RSSI=${packet.rssi}dBm SNR=${packet.snr.toFixed(1)}dB | ` +
          `${(packet.airtime_us / 1000).toFixed(2)}ms`;
      } else if (packet.packet_type === 'downlink') {
        info = `DevAddr=${packet.dev_addr ?? 'N/A'} | DL_ID=${packet.f_cnt ?? 'N/A'}`;
        logLine = `[${packet.gateway_id}] ${packet.packet_type.padEnd(12)} | ${info} | ` +
          `${packet.operator} | SF${packet.spreading_factor} | TX | ` +
          `${(packet.airtime_us / 1000).toFixed(2)}ms`;
      } else if (packet.packet_type === 'tx_ack') {
        // packet.operator contains the status name, packet.f_cnt contains downlink_id
        info = `DL_ID=${packet.f_cnt ?? 'N/A'} | Status=${packet.operator}`;
        logLine = `[${packet.gateway_id}] ${packet.packet_type.padEnd(12)} | ${info}`;
      } else {
        info = `JoinEUI=${packet.join_eui} DevEUI=${packet.dev_eui}`;
        logLine = `[${packet.gateway_id}] ${packet.packet_type.padEnd(12)} | ${info} | ` +
          `${packet.operator} | SF${packet.spreading_factor} | ` +
          `RSSI=${packet.rssi}dBm SNR=${packet.snr.toFixed(1)}dB`;
      }

      console.log(logLine);
    } catch (err) {
      console.error('Error processing packet:', err);
    }
  });

  // Handle gateway location updates from application-level MQTT messages
  onGatewayLocation((gatewayId, location) => {
    upsertGateway(gatewayId, location.name ?? null, location).catch(err => {
      console.error('Error updating gateway location:', err);
    });
  });

  // Handle ChirpStack Devices uplinks
  onChirpStackUplink(async (event) => {
    try {
      await insertCsPacket(event);
      await upsertCsDevice(event);
      broadcastCsUplink(event);
      console.log(`[CS] ${event.deviceName} (${event.devEui}) FCnt=${event.fCnt} RSSI=${event.rssi}dBm`);
    } catch (err) {
      console.error('Error processing ChirpStack uplink:', err);
    }
  });

  // Handle ChirpStack TX-ACK (gateway confirmed downlink transmission)
  onChirpStackTxAck((event) => {
    broadcastCsTxAck(event);
    console.log(`[CS txack] ${event.deviceName} (${event.devEui}) FCntDown=${event.fCntDown} GW=${event.gatewayId}`);
  });

  // Handle ChirpStack ACK (device confirmed downlink receipt)
  onChirpStackAck((event) => {
    broadcastCsAck(event);
    console.log(`[CS ack] ${event.deviceName} (${event.devEui}) FCntDown=${event.fCntDown} ack=${event.acknowledged}`);
  });

  // Handle ChirpStack downlink command (application/.../command/down)
  onChirpStackDownlink((event) => {
    broadcastCsDownlink(event);
    console.log(`[CS down] ${event.devEui} fPort=${event.fPort} confirmed=${event.confirmed} size=${event.payloadSize}B`);
  });

  // Build known device ranges from operators with known_devices = true
  const myDeviceRanges = buildKnownDeviceRanges(config.operators);
  console.log(`Known device ranges: ${myDeviceRanges.length} prefixes`);
  if (myDeviceRanges.length > 0) {
    console.log('Known device prefixes:', myDeviceRanges.map(r => r.prefix).join(', '));
  }

  // Start API server
  await startApi(config.api, myDeviceRanges, allOperators);

  console.log('LoRaWAN Analyzer running');

  // Handle shutdown
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

let sessionTrackerRef: SessionTracker | null = null;

async function shutdown(): Promise<void> {
  console.log('\nShutting down...');

  try {
    sessionTrackerRef?.stopCleanup();
    await disconnectMqtt();
    await flushPackets();
    await flushCsPackets();
    await closePostgres();
  } catch (err) {
    console.error('Error during shutdown:', err);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
