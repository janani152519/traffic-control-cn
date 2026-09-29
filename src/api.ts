/**
 * Frontend API Client for SDN Controller Backend
 * Communicates with /api endpoints with automatic port detection and fallback
 */

export interface BackendStatus {
  connected: boolean;
  running: boolean;
  trafficLevel: string;
  autoRouting: boolean;
  activeRoutes: Record<string, number>;
  flowRules: any[];
  routingHistory: string[];
  stats: {
    rerouteCount: number;
    totalFlowUpdates: number;
  };
}

export interface RerouteResponse {
  success: boolean;
  routeKey: string;
  pathIndex: number;
  newPath: string[];
  via: string;
  flowRules?: any[];
  message: string;
}

export interface BypassResponse {
  success: boolean;
  bypassedRouter: string;
  divertedFlowsCount: number;
  affectedFlows: Array<{
    routeKey: string;
    fromVia: string;
    toVia: string;
    newPath: string[];
  }>;
  activeRoutes: Record<string, number>;
  message: string;
}

// Candidates for backend URL: same-origin /api first, then standalone localhost:3001/api
const API_ENDPOINTS = ['/api', 'http://localhost:3001/api'];
let workingEndpoint = '/api';

async function fetchWithFallback(path: string, options?: RequestInit): Promise<Response> {
  // Try current preferred endpoint
  try {
    const res = await fetch(`${workingEndpoint}${path}`, {
      ...options,
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok || res.status < 500) return res;
  } catch {
    // switch to alternate endpoint
  }

  // Try alternate endpoint
  const alternate = API_ENDPOINTS.find(e => e !== workingEndpoint) || '/api';
  try {
    const res = await fetch(`${alternate}${path}`, {
      ...options,
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok || res.status < 500) {
      workingEndpoint = alternate;
      return res;
    }
    return res;
  } catch (err) {
    throw err;
  }
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetchWithFallback('/health');
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

export async function fetchBackendStatus(): Promise<BackendStatus | null> {
  try {
    const res = await fetchWithFallback('/status');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function requestReroute(
  routeKey: string,
  pathIndex?: number,
  targetRouter?: string
): Promise<RerouteResponse | null> {
  try {
    const res = await fetchWithFallback('/reroute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routeKey, pathIndex, targetRouter }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function requestRouterBypass(routerId: string): Promise<BypassResponse | null> {
  try {
    const res = await fetchWithFallback('/router/bypass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routerId }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function requestTrafficLevel(level: string): Promise<boolean> {
  try {
    const res = await fetchWithFallback('/traffic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
