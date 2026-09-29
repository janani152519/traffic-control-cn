/**
 * Intelligent Traffic Management Dashboard - SDN Controller Backend
 * Pure Node.js HTTP Server with no external dependencies required.
 */

import http from 'node:http';

const PORT = process.env.BACKEND_PORT ? parseInt(process.env.BACKEND_PORT) : 3001;

// ── SDN Topology & Route Paths ──────────────────────────────────────────────
export const ROUTE_PATHS = {
  'PC1-SRV1': [
    { id: 0, path: ['PC1', 'R1', 'R2', 'R5', 'SRV1'], via: 'SW-R2', label: 'Primary via SW-R2' },
    { id: 1, path: ['PC1', 'R1', 'R3', 'R5', 'SRV1'], via: 'SW-R3', label: 'Alternate via SW-R3' },
    { id: 2, path: ['PC1', 'R1', 'R4', 'R6', 'R5', 'SRV1'], via: 'SW-R4', label: 'Bypass via SW-R4' },
  ],
  'PC1-SRV2': [
    { id: 0, path: ['PC1', 'R1', 'R2', 'R5', 'SRV2'], via: 'SW-R2', label: 'Primary via SW-R2' },
    { id: 1, path: ['PC1', 'R1', 'R3', 'R5', 'SRV2'], via: 'SW-R3', label: 'Alternate via SW-R3' },
    { id: 2, path: ['PC1', 'R1', 'R3', 'R6', 'SRV2'], via: 'SW-R6', label: 'Direct via SW-R6' },
  ],
  'PC2-SRV1': [
    { id: 0, path: ['PC2', 'R1', 'R2', 'R5', 'SRV1'], via: 'SW-R2', label: 'Primary via SW-R2' },
    { id: 1, path: ['PC2', 'R1', 'R3', 'R5', 'SRV1'], via: 'SW-R3', label: 'Alternate via SW-R3' },
    { id: 2, path: ['PC2', 'R1', 'R4', 'R6', 'R5', 'SRV1'], via: 'SW-R4', label: 'Low-Load via SW-R4' },
  ],
  'PC2-SRV2': [
    { id: 0, path: ['PC2', 'R1', 'R2', 'R5', 'SRV2'], via: 'SW-R2', label: 'Primary via SW-R2' },
    { id: 1, path: ['PC2', 'R1', 'R3', 'R6', 'SRV2'], via: 'SW-R3', label: 'Alternate via SW-R3' },
  ],
  'PC3-SRV3': [
    { id: 0, path: ['PC3', 'R4', 'R6', 'SRV3'], via: 'SW-R6', label: 'Primary via SW-R6' },
    { id: 1, path: ['PC3', 'R4', 'R3', 'R5', 'SRV3'], via: 'SW-R3', label: 'Alternate via SW-R3' },
  ],
  'PC3-SRV2': [
    { id: 0, path: ['PC3', 'R4', 'R6', 'SRV2'], via: 'SW-R6', label: 'Direct via SW-R6' },
    { id: 1, path: ['PC3', 'R4', 'R5', 'SRV2'], via: 'SW-R5', label: 'Alternate via SW-R5' },
  ],
};

// ── Controller State ────────────────────────────────────────────────────────
const state = {
  running: true,
  trafficLevel: 'normal',
  autoRouting: true,
  activeRoutes: {
    'PC1-SRV1': 0,
    'PC1-SRV2': 0,
    'PC2-SRV1': 0,
    'PC2-SRV2': 0,
    'PC3-SRV3': 0,
    'PC3-SRV2': 0,
  },
  flowRules: [
    {
      switchId: 'R1',
      inPort: 'eth0',
      outPort: 'eth1',
      match: 'dst=10.0.1.1',
      action: 'forward(R2)',
      priority: 100,
      timestamp: Date.now(),
    },
    {
      switchId: 'R2',
      inPort: 'eth0',
      outPort: 'eth1',
      match: 'dst=10.0.1.1',
      action: 'forward(R5)',
      priority: 100,
      timestamp: Date.now(),
    },
    {
      switchId: 'R5',
      inPort: 'eth0',
      outPort: 'eth2',
      match: 'dst=10.0.1.1',
      action: 'forward(SRV1)',
      priority: 100,
      timestamp: Date.now(),
    },
  ],
  routingHistory: [
    `[${new Date().toLocaleTimeString()}] SDN Controller initialized. OpenFlow v1.3 handshake successful.`,
  ],
  stats: {
    rerouteCount: 0,
    totalFlowUpdates: 3,
  },
};

// ── OpenFlow Rule Generator ────────────────────────────────────────────────
function generateFlowRulesForPath(path, priority = 250) {
  const rules = [];
  for (let i = 1; i < path.length - 1; i++) {
    const current = path[i];
    const next = path[i + 1];
    if (current.startsWith('R')) {
      rules.push({
        switchId: current,
        inPort: 'eth' + (i % 2),
        outPort: 'eth' + ((i + 1) % 2 + 1),
        match: `dst=${path[path.length - 1]}`,
        action: `forward(${next})`,
        priority,
        timestamp: Date.now(),
      });
    }
  }
  return rules;
}

// ── HTTP API Handler ───────────────────────────────────────────────────────
export function handleApiRequest(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // JSON helper
  const sendJson = (statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // Parse JSON Body Helper
  const parseBody = (callback) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        callback(null, parsed);
      } catch (err) {
        callback(err);
      }
    });
  };

  // ── Routes ───────────────────────────────────────────────────────────────

  // Health check
  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(200, {
      status: 'ok',
      service: 'SDN Traffic Management Backend',
      version: '2.5.0',
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
    return true;
  }

  // Get full state
  if (pathname === '/api/status' && req.method === 'GET') {
    sendJson(200, {
      ...state,
      availableRoutes: ROUTE_PATHS,
      connected: true,
      timestamp: Date.now(),
    });
    return true;
  }

  // Get route catalog
  if (pathname === '/api/routes' && req.method === 'GET') {
    sendJson(200, {
      routes: ROUTE_PATHS,
      activeRoutes: state.activeRoutes,
    });
    return true;
  }

  // Manual Reroute (Change Router/Path for a flow)
  if (pathname === '/api/reroute' && req.method === 'POST') {
    parseBody((err, body) => {
      if (err) return sendJson(400, { error: 'Invalid JSON body' });

      const { routeKey, pathIndex, targetRouter } = body;
      const paths = ROUTE_PATHS[routeKey];

      if (!paths) {
        return sendJson(404, { error: `Route key '${routeKey}' not found` });
      }

      let selectedIndex = pathIndex;

      // If targetRouter was specified instead of pathIndex, find path via that router
      if (targetRouter && typeof targetRouter === 'string') {
        const foundIdx = paths.findIndex(p => p.via === targetRouter || p.path.includes(targetRouter));
        if (foundIdx !== -1) {
          selectedIndex = foundIdx;
        }
      }

      if (typeof selectedIndex !== 'number' || selectedIndex < 0 || selectedIndex >= paths.length) {
        return sendJson(400, { error: 'Invalid pathIndex or targetRouter' });
      }

      const prevIndex = state.activeRoutes[routeKey] ?? 0;
      state.activeRoutes[routeKey] = selectedIndex;

      const chosen = paths[selectedIndex];
      const prev = paths[prevIndex];

      // Generate new OpenFlow rules
      const newRules = generateFlowRulesForPath(chosen.path);
      state.flowRules = [...newRules, ...state.flowRules].slice(0, 25);
      state.stats.rerouteCount++;
      state.stats.totalFlowUpdates += newRules.length;

      const eventMsg = `[MANUAL REROUTE] ${routeKey} switched from ${prev.via} to ${chosen.via} (${chosen.path.join(' → ')})`;
      state.routingHistory.unshift(`[${new Date().toLocaleTimeString()}] ${eventMsg}`);
      state.routingHistory = state.routingHistory.slice(0, 30);

      sendJson(200, {
        success: true,
        routeKey,
        pathIndex: selectedIndex,
        newPath: chosen.path,
        via: chosen.via,
        flowRules: newRules,
        message: eventMsg,
        timestamp: Date.now(),
      });
    });
    return true;
  }

  // Bypass a specific congested router
  if (pathname === '/api/router/bypass' && req.method === 'POST') {
    parseBody((err, body) => {
      if (err) return sendJson(400, { error: 'Invalid JSON body' });
      const { routerId } = body; // e.g. 'R2' or 'SW-R2'
      if (!routerId) return sendJson(400, { error: 'Missing routerId' });

      const normRouter = routerId.replace('SW-', '');
      const affectedFlows = [];

      // Find all routes that traverse this router and switch them
      for (const [key, paths] of Object.entries(ROUTE_PATHS)) {
        const currentIdx = state.activeRoutes[key] ?? 0;
        const currentPath = paths[currentIdx];

        if (currentPath && currentPath.path.includes(normRouter)) {
          // Find an alternate path that does NOT use normRouter
          const altIdx = paths.findIndex(p => !p.path.includes(normRouter));
          if (altIdx !== -1 && altIdx !== currentIdx) {
            state.activeRoutes[key] = altIdx;
            const newPath = paths[altIdx];
            const newRules = generateFlowRulesForPath(newPath.path);
            state.flowRules = [...newRules, ...state.flowRules].slice(0, 25);
            state.stats.rerouteCount++;
            state.stats.totalFlowUpdates += newRules.length;

            affectedFlows.push({
              routeKey: key,
              fromVia: currentPath.via,
              toVia: newPath.via,
              newPath: newPath.path,
            });
          }
        }
      }

      const logMsg = `[ROUTER BYPASS] Router ${routerId} bypassed. Diverted ${affectedFlows.length} traffic flows to alternate routers.`;
      state.routingHistory.unshift(`[${new Date().toLocaleTimeString()}] ${logMsg}`);
      state.routingHistory = state.routingHistory.slice(0, 30);

      sendJson(200, {
        success: true,
        bypassedRouter: routerId,
        divertedFlowsCount: affectedFlows.length,
        affectedFlows,
        activeRoutes: state.activeRoutes,
        message: logMsg,
      });
    });
    return true;
  }

  // Update Traffic Level
  if (pathname === '/api/traffic' && req.method === 'POST') {
    parseBody((err, body) => {
      if (err) return sendJson(400, { error: 'Invalid JSON body' });
      const { level } = body;
      if (['low', 'normal', 'high', 'extreme'].includes(level)) {
        state.trafficLevel = level;
        state.routingHistory.unshift(`[${new Date().toLocaleTimeString()}] Traffic profile updated to ${level.toUpperCase()}`);
        sendJson(200, { success: true, trafficLevel: level });
      } else {
        sendJson(400, { error: 'Invalid traffic level' });
      }
    });
    return true;
  }

  // Toggle Auto-Routing
  if (pathname === '/api/auto-routing' && req.method === 'POST') {
    parseBody((err, body) => {
      if (err) return sendJson(400, { error: 'Invalid JSON body' });
      state.autoRouting = Boolean(body.enabled);
      sendJson(200, { success: true, autoRouting: state.autoRouting });
    });
    return true;
  }

  return false;
}

// ── Standalone Server Starter ──────────────────────────────────────────────
if (process.argv[1]?.endsWith('server.js') || process.env.RUN_STANDALONE === 'true') {
  const server = http.createServer((req, res) => {
    const handled = handleApiRequest(req, res);
    if (!handled) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SDN Backend] Server running on http://localhost:${PORT}`);
    console.log(`[SDN Backend] Ready for dynamic router changes and OpenFlow telemetry.`);
  });
}
