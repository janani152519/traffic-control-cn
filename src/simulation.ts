// SDN Simulation Engine

export type NodeType = 'pc' | 'server' | 'switch' | 'controller';
export type TrafficLevel = 'low' | 'normal' | 'high' | 'extreme';
export type LinkState = 'active' | 'congested' | 'rerouted' | 'inactive';

export interface NetworkNode {
  id: string;
  label: string;
  type: NodeType;
  x: number;
  y: number;
  ip?: string;
  packetsForwarded: number;
  queueLength: number;
  cpu: number;
}

export interface NetworkLink {
  id: string;
  from: string;
  to: string;
  bandwidth: number; // Mbps
  utilization: number; // 0-100%
  latency: number; // ms
  packetLoss: number; // 0-100%
  state: LinkState;
  active: boolean;
  currentPath?: boolean;
}

export interface Packet {
  id: string;
  from: string;
  to: string;
  path: string[];
  pathIndex: number;
  progress: number; // 0-1 along current link
  color: string;
  size: number;
  type: 'data' | 'control' | 'ack';
  dropped?: boolean;
}

export interface FlowRule {
  switchId: string;
  inPort: string;
  outPort: string;
  match: string;
  action: string;
  priority: number;
  timestamp: number;
}

export interface RoutingCandidate {
  path: string[];
  pathStr: string;
  utilization: number;
  latency: number;
  packetLoss: number;
  hops: number;
  cost: number;
  selected: boolean;
}

export interface AlertEvent {
  id: string;
  timestamp: number;
  type: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  detail?: string;
}

export interface SimStats {
  packetsSent: number;
  packetsReceived: number;
  packetsDropped: number;
  avgLatency: number;
  throughput: number; // Mbps
  totalFlowUpdates: number;
  rerouteCount: number;
}

// --- Topology Definition ---
export const INITIAL_NODES: NetworkNode[] = [
  { id: 'PC1',  label: 'PC-1',     type: 'pc',         x: 60,  y: 120, ip: '10.0.0.1', packetsForwarded: 0, queueLength: 0, cpu: 0 },
  { id: 'PC2',  label: 'PC-2',     type: 'pc',         x: 60,  y: 280, ip: '10.0.0.2', packetsForwarded: 0, queueLength: 0, cpu: 0 },
  { id: 'PC3',  label: 'PC-3',     type: 'pc',         x: 60,  y: 440, ip: '10.0.0.3', packetsForwarded: 0, queueLength: 0, cpu: 0 },
  { id: 'R1',   label: 'SW-R1',    type: 'switch',     x: 220, y: 200, ip: '192.168.1.1', packetsForwarded: 0, queueLength: 0, cpu: 0 },
  { id: 'R2',   label: 'SW-R2',    type: 'switch',     x: 380, y: 120, ip: '192.168.1.2', packetsForwarded: 0, queueLength: 0, cpu: 0 },
  { id: 'R3',   label: 'SW-R3',    type: 'switch',     x: 380, y: 280, ip: '192.168.1.3', packetsForwarded: 0, queueLength: 0, cpu: 0 },
  { id: 'R4',   label: 'SW-R4',    type: 'switch',     x: 380, y: 440, ip: '192.168.1.4', packetsForwarded: 0, queueLength: 0, cpu: 0 },
  { id: 'R5',   label: 'SW-R5',    type: 'switch',     x: 540, y: 200, ip: '192.168.1.5', packetsForwarded: 0, queueLength: 0, cpu: 0 },
  { id: 'R6',   label: 'SW-R6',    type: 'switch',     x: 540, y: 380, ip: '192.168.1.6', packetsForwarded: 0, queueLength: 0, cpu: 0 },
  { id: 'SDN',  label: 'SDN CTRL', type: 'controller', x: 380, y: 200, ip: '10.255.0.1', packetsForwarded: 0, queueLength: 0, cpu: 45 },
  { id: 'SRV1', label: 'Server-1', type: 'server',     x: 700, y: 120, ip: '10.0.1.1', packetsForwarded: 0, queueLength: 0, cpu: 0 },
  { id: 'SRV2', label: 'Server-2', type: 'server',     x: 700, y: 280, ip: '10.0.1.2', packetsForwarded: 0, queueLength: 0, cpu: 0 },
  { id: 'SRV3', label: 'Server-3', type: 'server',     x: 700, y: 440, ip: '10.0.1.3', packetsForwarded: 0, queueLength: 0, cpu: 0 },
];

export const INITIAL_LINKS: NetworkLink[] = [
  // PC to R1
  { id: 'PC1-R1', from: 'PC1', to: 'R1', bandwidth: 100, utilization: 0, latency: 2, packetLoss: 0, state: 'active', active: true },
  { id: 'PC2-R1', from: 'PC2', to: 'R1', bandwidth: 100, utilization: 0, latency: 2, packetLoss: 0, state: 'active', active: true },
  { id: 'PC3-R4', from: 'PC3', to: 'R4', bandwidth: 100, utilization: 0, latency: 2, packetLoss: 0, state: 'active', active: true },
  // R1 paths
  { id: 'R1-R2',  from: 'R1', to: 'R2', bandwidth: 1000, utilization: 0, latency: 5, packetLoss: 0, state: 'active', active: true },
  { id: 'R1-R3',  from: 'R1', to: 'R3', bandwidth: 1000, utilization: 0, latency: 8, packetLoss: 0, state: 'active', active: true },
  // Mid-tier
  { id: 'R2-R5',  from: 'R2', to: 'R5', bandwidth: 1000, utilization: 0, latency: 5, packetLoss: 0, state: 'active', active: true },
  { id: 'R3-R5',  from: 'R3', to: 'R5', bandwidth: 1000, utilization: 0, latency: 8, packetLoss: 0, state: 'active', active: true },
  { id: 'R3-R6',  from: 'R3', to: 'R6', bandwidth: 1000, utilization: 0, latency: 6, packetLoss: 0, state: 'active', active: true },
  { id: 'R4-R6',  from: 'R4', to: 'R6', bandwidth: 1000, utilization: 0, latency: 5, packetLoss: 0, state: 'active', active: true },
  // R5/R6 to servers
  { id: 'R5-SRV1', from: 'R5', to: 'SRV1', bandwidth: 1000, utilization: 0, latency: 3, packetLoss: 0, state: 'active', active: true },
  { id: 'R5-SRV2', from: 'R5', to: 'SRV2', bandwidth: 1000, utilization: 0, latency: 3, packetLoss: 0, state: 'active', active: true },
  { id: 'R6-SRV2', from: 'R6', to: 'SRV2', bandwidth: 1000, utilization: 0, latency: 3, packetLoss: 0, state: 'active', active: true },
  { id: 'R6-SRV3', from: 'R6', to: 'SRV3', bandwidth: 1000, utilization: 0, latency: 3, packetLoss: 0, state: 'active', active: true },
  // Cross-links
  { id: 'R2-R3',  from: 'R2', to: 'R3', bandwidth: 1000, utilization: 0, latency: 4, packetLoss: 0, state: 'active', active: true },
  { id: 'R1-R4',  from: 'R1', to: 'R4', bandwidth: 1000, utilization: 0, latency: 6, packetLoss: 0, state: 'active', active: true },
  { id: 'R4-R5',  from: 'R4', to: 'R5', bandwidth: 1000, utilization: 0, latency: 7, packetLoss: 0, state: 'active', active: true },
];

// Route definitions: [from, to] -> array of possible paths (each path = array of node IDs)
export const ROUTE_PATHS: Record<string, string[][]> = {
  'PC1-SRV1': [
    ['PC1','R1','R2','R5','SRV1'],
    ['PC1','R1','R3','R5','SRV1'],
    ['PC1','R1','R4','R6','R5','SRV1'],
  ],
  'PC1-SRV2': [
    ['PC1','R1','R2','R5','SRV2'],
    ['PC1','R1','R3','R5','SRV2'],
    ['PC1','R1','R3','R6','SRV2'],
    ['PC1','R1','R4','R6','SRV2'],
  ],
  'PC2-SRV1': [
    ['PC2','R1','R2','R5','SRV1'],
    ['PC2','R1','R3','R5','SRV1'],
    ['PC2','R1','R4','R5','SRV1'],
  ],
  'PC2-SRV2': [
    ['PC2','R1','R2','R5','SRV2'],
    ['PC2','R1','R3','R6','SRV2'],
    ['PC2','R1','R4','R6','SRV2'],
  ],
  'PC3-SRV3': [
    ['PC3','R4','R6','SRV3'],
    ['PC3','R4','R5','R6','SRV3'],
  ],
  'PC3-SRV2': [
    ['PC3','R4','R6','SRV2'],
    ['PC3','R4','R5','SRV2'],
  ],
};

export function getLinkId(from: string, to: string): string {
  // canonical order
  const links = INITIAL_LINKS;
  const direct = links.find(l => l.id === `${from}-${to}`);
  if (direct) return direct.id;
  const rev = links.find(l => l.id === `${to}-${from}`);
  if (rev) return rev.id;
  return `${from}-${to}`;
}

export function getPathLinks(path: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    result.push(getLinkId(path[i], path[i+1]));
  }
  return result;
}

export function calcPathCost(path: string[], links: NetworkLink[]): { util: number; latency: number; loss: number; cost: number } {
  const linkIds = getPathLinks(path);
  let totalUtil = 0, totalLatency = 0, totalLoss = 0;
  for (const lid of linkIds) {
    const l = links.find(x => x.id === lid);
    if (l) {
      totalUtil += l.utilization;
      totalLatency += l.latency;
      totalLoss += l.packetLoss;
    }
  }
  const avgUtil = totalUtil / linkIds.length;
  // weighted cost formula
  const cost = avgUtil * 0.5 + totalLatency * 2 + totalLoss * 10 + path.length * 5;
  return { util: avgUtil, latency: totalLatency, loss: totalLoss, cost };
}
