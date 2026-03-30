// Built-in LoRaWAN operator prefixes from TTN NetID assignments
// Format: DevAddr prefix -> Operator name
// Prefixes are in the format "AABBCCDD/bits" where bits is the prefix length
import TYPE_0 from './type0-netids.json';
import TYPE_3 from './type3-netids.json';
import TYPE_7 from './type7-netids.json';
import HELIUM from './helium-netids.json';

const OPERATOR_PREFIXES = [TYPE_0, TYPE_3, TYPE_7, HELIUM].flat();

export interface OperatorPrefix {
  prefix: number;
  mask: number;
  bits: number;
  name: string;
  priority: number;
  color?: string;
}

// Parse a prefix string like "26000000/7" into prefix and mask
function parsePrefix(prefixStr: string): { prefix: number; mask: number; bits: number } {
  const [hexPart, bitsStr] = prefixStr.split('/');
  const prefix = parseInt(hexPart, 16);
  const bits = parseInt(bitsStr, 10);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { prefix, mask, bits };
}

// Built-in operator database from LoRa Alliance NetID assignments
const BUILTIN_OPERATORS: Array<{ prefix: string; name: string; color?: string }> = OPERATOR_PREFIXES;

let operatorPrefixes: OperatorPrefix[] = [];

export function initOperatorPrefixes(customOperators: Array<{ prefix: string | string[]; name: string; priority?: number; color?: string }> = []): void {
  operatorPrefixes = [];

  // Add built-in operators with priority 0
  for (const op of BUILTIN_OPERATORS) {
    const { prefix, mask, bits } = parsePrefix(op.prefix);
    operatorPrefixes.push({ prefix, mask, bits, name: op.name, priority: 0, color: op.color });
  }

  // Add custom operators with higher priority (default 100)
  for (const op of customOperators) {
    if (!op.prefix) continue;  // color-only entries (e.g. CS application names)
    const prefixes = Array.isArray(op.prefix) ? op.prefix : [op.prefix];
    for (const prefixStr of prefixes) {
      const { prefix, mask, bits } = parsePrefix(prefixStr);
      operatorPrefixes.push({ prefix, mask, bits, name: op.name, priority: op.priority ?? 100, color: op.color });
    }
  }

  // Sort by priority descending (higher priority first), then by bits descending (more specific first)
  operatorPrefixes.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.bits - a.bits;
  });
}

export function getOperatorPrefixes(): OperatorPrefix[] {
  return operatorPrefixes;
}

// Returns a map of operator name -> color for all operators that have a color defined.
// Higher-priority operators (custom/config) override built-in colors for the same name.
export function getOperatorColorMap(): Record<string, string> {
  const colors: Record<string, string> = {};
  // Iterate in reverse priority order so higher-priority entries override
  for (let i = operatorPrefixes.length - 1; i >= 0; i--) {
    const op = operatorPrefixes[i];
    if (op.color) {
      colors[op.name] = op.color;
    }
  }
  return colors;
}
