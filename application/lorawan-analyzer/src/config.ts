import { readFileSync, existsSync } from 'fs';
import toml from 'toml';
import type { Config, MqttServerConfig } from './types.js';

const DEFAULT_CONFIG: Config = {
  mqtt: {
    server: 'tcp://172.17.0.1:1883',
    username: '',
    password: '',
    topic: '#',
    format: 'protobuf',
  },
  postgres: {
    url: 'postgres://lorawan:lorawan@postgres:5432/lorawan',
  },
  api: {
    bind: '0.0.0.0:3000',
  },
  operators: [],
  hide_rules: [],
  mqtt_servers: [],
};

export function loadConfig(configPath: string): Config {
  if (!existsSync(configPath)) {
    console.warn(`Config file not found at ${configPath}, using defaults`);
    return DEFAULT_CONFIG;
  }

  const content = readFileSync(configPath, 'utf-8');
  const parsed = toml.parse(content) as Partial<Config> & { mqtt_servers?: Array<Partial<MqttServerConfig>> };

  return {
    mqtt: { ...DEFAULT_CONFIG.mqtt, ...parsed.mqtt },
    postgres: { ...DEFAULT_CONFIG.postgres, ...parsed.postgres },
    api: { ...DEFAULT_CONFIG.api, ...parsed.api },
    operators: parsed.operators ?? [],
    hide_rules: parsed.hide_rules ?? [],
    mqtt_servers: (parsed.mqtt_servers ?? []).map(s => ({
      server:   s.server   ?? DEFAULT_CONFIG.mqtt.server,
      username: s.username ?? '',
      password: s.password ?? '',
      topic:    s.topic    ?? DEFAULT_CONFIG.mqtt.topic,
      format:   s.format   ?? DEFAULT_CONFIG.mqtt.format,
    })),
  };
}
