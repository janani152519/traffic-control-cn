import React, { useState, useEffect, useRef, useCallback } from 'react';
import TopologyCanvas from './components/TopologyCanvas';
import LiveCharts from './components/LiveCharts';
import {
  checkBackendHealth,
  requestReroute,
  requestRouterBypass,
  requestTrafficLevel,
} from './api';
import {
  INITIAL_NODES, INITIAL_LINKS, ROUTE_PATHS,
  getLinkId, getPathLinks, calcPathCost,
  type NetworkNode, type NetworkLink, type Packet,
  type FlowRule, type RoutingCandidate, type AlertEvent,
  type SimStats, type TrafficLevel,
} from './simulation';

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9); }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// High-contrast, vibrant packet colors that pop on beige
const PACKET_COLORS = {
  data: '#0284C7',     // Electric Sapphire
  control: '#D97706',  // Warm Amber
  ack: '#059669',      // Radiant Emerald
};

const TRAFFIC_RATE: Record<TrafficLevel, number> = {
  low: 400, normal: 180, high: 70, extreme: 25,
};

const TRAFFIC_LABEL: Record<TrafficLevel, { label: string; color: string; bg: string }> = {
  low: { label: 'LOW', color: '#059669', bg: '#ECFDF5' },
  normal: { label: 'NORMAL', color: '#0284C7', bg: '#F0F9FF' },
  high: { label: 'HIGH', color: '#D97706', bg: '#FFFBEB' },
  extreme: { label: 'EXTREME', color: '#DC2626', bg: '#FEF2F2' },
};

const FLOW_ROUTES: Record<string, string[][]> = ROUTE_PATHS;
const ALL_ROUTE_KEYS = Object.keys(FLOW_ROUTES);

// Identify intermediate transit router from a path
function getTransitRouter(path: string[]): string {
  const switches = path.filter(n => n.startsWith('R'));
  if (switches.length >= 2) return `SW-${switches[1]}`;
  if (switches.length === 1) return `SW-${switches[0]}`;
  return 'Direct';
}

// ── State types ───────────────────────────────────────────────────────────────

interface HistoryPoint {
  t: number;
  throughput: number;
  latency: number;
  r1r2: number; r1r3: number; r2r5: number; r3r5: number;
  dropped: number;
}

interface ActiveRoute {
  key: string;
  pathIndex: number;
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [running, setRunning] = useState(false);
  const [trafficLevel, setTrafficLevel] = useState<TrafficLevel>('normal');
  const [nodes, setNodes] = useState<NetworkNode[]>(() => INITIAL_NODES.map(n => ({ ...n })));
  const [links, setLinks] = useState<NetworkLink[]>(() => INITIAL_LINKS.map(l => ({ ...l })));
  const [packets, setPackets] = useState<Packet[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [flowRules, setFlowRules] = useState<FlowRule[]>([]);
  const [routingCandidates, setRoutingCandidates] = useState<RoutingCandidate[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [stats, setStats] = useState<SimStats>({
    packetsSent: 0, packetsReceived: 0, packetsDropped: 0,
    avgLatency: 0, throughput: 0, totalFlowUpdates: 0, rerouteCount: 0,
  });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [congestionAlert, setCongestionAlert] = useState<string | null>(null);
  const [autoRouting, setAutoRouting] = useState(true);
  const [activeRoutes, setActiveRoutes] = useState<ActiveRoute[]>(() =>
    ALL_ROUTE_KEYS.map(k => ({ key: k, pathIndex: 0 }))
  );
  const [activeTab, setActiveTab] = useState<'routers' | 'flowtable' | 'routing' | 'linkstats' | 'details'>('routers');
  const [demoMode, setDemoMode] = useState(false);
  const [controllerPulse, setControllerPulse] = useState(false);
  const [routingHistory, setRoutingHistory] = useState<string[]>([]);
  const [backendConnected, setBackendConnected] = useState(false);

  // Refs for simulation loop
  const runningRef = useRef(running);
  const trafficRef = useRef(trafficLevel);
  const linksRef = useRef(links);
  const packetsRef = useRef(packets);
  const statsRef = useRef(stats);
  const activeRoutesRef = useRef(activeRoutes);
  const autoRoutingRef = useRef(autoRouting);

  runningRef.current = running;
  trafficRef.current = trafficLevel;
  linksRef.current = links;
  packetsRef.current = packets;
  statsRef.current = stats;
  activeRoutesRef.current = activeRoutes;
  autoRoutingRef.current = autoRouting;

  const addAlert = useCallback((type: AlertEvent['type'], message: string, detail?: string) => {
    const ev: AlertEvent = { id: uid(), timestamp: Date.now(), type, message, detail };
    setAlerts(prev => [ev, ...prev].slice(0, 50));
  }, []);

  // ── Backend Health & Connection Sync ─────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const verifyBackend = async () => {
      const isOnline = await checkBackendHealth();
      if (mounted) setBackendConnected(isOnline);
    };

    verifyBackend();
    const interval = setInterval(verifyBackend, 4000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // ── Manual Router Switching Logic (User Reroutes on Demand) ──────────────
  const handleManualReroute = useCallback(async (routeKey: string, newPathIdx: number) => {
    const paths = FLOW_ROUTES[routeKey];
    if (!paths || !paths[newPathIdx]) return;

    const currentRoute = activeRoutesRef.current.find(r => r.key === routeKey);
    const oldIdx = currentRoute?.pathIndex ?? 0;
    if (oldIdx === newPathIdx) return;

    const oldPath = paths[oldIdx];
    const newPath = paths[newPathIdx];
    const oldVia = getTransitRouter(oldPath);
    const newVia = getTransitRouter(newPath);

    // 1. Update frontend active routes immediately
    setActiveRoutes(prev => prev.map(r => r.key === routeKey ? { ...r, pathIndex: newPathIdx } : r));

    // 2. Trigger SDN Controller visual pulse
    setControllerPulse(true);
    setTimeout(() => setControllerPulse(false), 1800);

    // 3. Generate OpenFlow flow rules for the new router
    const newRules: FlowRule[] = newPath.filter(n => n.startsWith('R')).map(sw => ({
      switchId: sw,
      inPort: 'eth0',
      outPort: 'eth1',
      match: `dst=${newPath[newPath.length - 1]}`,
      action: `forward(${newPath[newPath.indexOf(sw) + 1] ?? 'out'})`,
      priority: 300,
      timestamp: Date.now(),
    }));

    setFlowRules(prev => [...newRules, ...prev].slice(0, 25));
    setStats(s => ({ ...s, rerouteCount: s.rerouteCount + 1, totalFlowUpdates: s.totalFlowUpdates + newRules.length }));

    // 4. Mark links as rerouted/active
    const newLinkIds = getPathLinks(newPath);
    setLinks(prev => prev.map(link => {
      if (newLinkIds.includes(link.id)) return { ...link, state: 'rerouted' as const };
      return link;
    }));

    // Reset link rerouted state after 6s
    setTimeout(() => {
      setLinks(prev => prev.map(l => l.state === 'rerouted' ? { ...l, state: 'active' } : l));
    }, 6000);

    const logMsg = `[MANUAL REROUTE] ${routeKey} switched from ${oldVia} to ${newVia}`;
    addAlert('success', 'ROUTER SWITCHED', `${routeKey} redirected via ${newVia} (${newPath.join(' → ')})`);
    setRoutingHistory(prev => [`[${new Date().toLocaleTimeString()}] ${logMsg}`, ...prev].slice(0, 25));

    // 5. Notify the backend API
    await requestReroute(routeKey, newPathIdx, newVia);
  }, [addAlert]);

  // ── Bypass Specific Congested Router ─────────────────────────────────────
  const handleBypassRouter = useCallback(async (routerId: string) => {
    const normRouter = routerId.replace('SW-', '');
    let divertedCount = 0;

    // Find any flow currently traversing this router and switch it
    for (const routeKey of ALL_ROUTE_KEYS) {
      const paths = FLOW_ROUTES[routeKey];
      const activeIdx = activeRoutesRef.current.find(r => r.key === routeKey)?.pathIndex ?? 0;
      const currentPath = paths[activeIdx];

      if (currentPath && currentPath.includes(normRouter)) {
        // Find alternative path that bypasses normRouter
        const altIdx = paths.findIndex(p => !p.includes(normRouter));
        if (altIdx !== -1 && altIdx !== activeIdx) {
          handleManualReroute(routeKey, altIdx);
          divertedCount++;
        }
      }
    }

    if (divertedCount > 0) {
      addAlert('success', `ROUTER BYPASS ENGAGED`, `Diverted ${divertedCount} traffic streams away from ${routerId}`);
      await requestRouterBypass(routerId);
    } else {
      addAlert('info', `ROUTER BYPASS`, `No active traffic currently traversing ${routerId}`);
    }
  }, [handleManualReroute, addAlert]);

  // ── Spawn packet ─────────────────────────────────────────────────────────

  const spawnPacket = useCallback((routeKey: string, routeIdx: number, type: Packet['type'] = 'data') => {
    const paths = FLOW_ROUTES[routeKey];
    if (!paths) return;
    const path = paths[routeIdx] ?? paths[0];
    const color = PACKET_COLORS[type];
    const pkt: Packet = {
      id: uid(), from: path[0], to: path[path.length - 1],
      path, pathIndex: 0, progress: 0,
      color, size: type === 'control' ? 4 : 3, type,
    };
    setPackets(prev => [...prev.slice(-80), pkt]);
    setStats(prev => ({ ...prev, packetsSent: prev.packetsSent + 1 }));
  }, []);

  // ── Move packets ────────────────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      if (!runningRef.current) return;

      setPackets(prev => {
        const updatedLinks = new Map<string, number>();

        const next = prev.map(pkt => {
          if (pkt.dropped) return pkt;
          if (pkt.pathIndex >= pkt.path.length - 1) return { ...pkt, dropped: true };

          const linkId = getLinkId(pkt.path[pkt.pathIndex], pkt.path[pkt.pathIndex + 1]);
          const link = linksRef.current.find(l => l.id === linkId);

          const congestionFactor = link ? clamp(1 - (link.utilization - 50) / 100, 0.1, 1) : 1;
          const speed = 0.06 * congestionFactor;

          const newProgress = pkt.progress + speed;
          updatedLinks.set(linkId, (updatedLinks.get(linkId) ?? 0) + 1);

          if (newProgress >= 1) {
            const newIdx = pkt.pathIndex + 1;
            if (newIdx >= pkt.path.length - 1) {
              setStats(s => ({ ...s, packetsReceived: s.packetsReceived + 1 }));
              return { ...pkt, pathIndex: newIdx, progress: 0, dropped: true };
            }
            return { ...pkt, pathIndex: newIdx, progress: 0 };
          }
          return { ...pkt, progress: newProgress };
        });

        // Check for packet loss at congested links
        const finalNext = next.map(pkt => {
          if (pkt.dropped) return pkt;
          const linkId = getLinkId(pkt.path[pkt.pathIndex], pkt.path[pkt.pathIndex + 1]);
          const link = linksRef.current.find(l => l.id === linkId);
          if (link && link.packetLoss > 0 && Math.random() * 100 < link.packetLoss * 0.05) {
            setStats(s => ({ ...s, packetsDropped: s.packetsDropped + 1 }));
            return { ...pkt, dropped: true };
          }
          return pkt;
        });

        return finalNext.filter(p => !p.dropped || p.pathIndex < p.path.length - 1).slice(-80);
      });
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // ── Traffic generation ──────────────────────────────────────────────────

  useEffect(() => {
    let lastSpawn = 0;
    const interval = setInterval(() => {
      if (!runningRef.current) return;
      const now = Date.now();
      const rate = TRAFFIC_RATE[trafficRef.current];
      if (now - lastSpawn < rate) return;
      lastSpawn = now;

      const routeKey = ALL_ROUTE_KEYS[Math.floor(Math.random() * ALL_ROUTE_KEYS.length)];
      const activeRoute = activeRoutesRef.current.find(r => r.key === routeKey);
      const pathIdx = activeRoute?.pathIndex ?? 0;
      const type: Packet['type'] = Math.random() < 0.85 ? 'data' : Math.random() < 0.5 ? 'ack' : 'control';
      spawnPacket(routeKey, pathIdx, type);
    }, 20);
    return () => clearInterval(interval);
  }, [spawnPacket]);

  // ── Link utilization simulation ──────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      if (!runningRef.current) return;

      const trafficMultiplier: Record<TrafficLevel, number> = {
        low: 0.15, normal: 0.4, high: 0.75, extreme: 0.95,
      };
      const base = trafficMultiplier[trafficRef.current];

      const linkPackets = new Map<string, number>();
      for (const pkt of packetsRef.current) {
        if (!pkt.dropped && pkt.pathIndex < pkt.path.length - 1) {
          const lid = getLinkId(pkt.path[pkt.pathIndex], pkt.path[pkt.pathIndex + 1]);
          linkPackets.set(lid, (linkPackets.get(lid) ?? 0) + 1);
        }
      }

      setLinks(prev => {
        const updated = prev.map(link => {
          if (!link.active) return { ...link, utilization: 0 };

          const pktInfluence = (linkPackets.get(link.id) ?? 0) * 8;
          const routeInfluence = activeRoutesRef.current.some(r => {
            const paths = FLOW_ROUTES[r.key];
            const path = paths?.[r.pathIndex];
            if (!path) return false;
            const linkIds = getPathLinks(path);
            return linkIds.includes(link.id);
          }) ? base * 70 : base * 20;

          const target = clamp(routeInfluence + pktInfluence + Math.random() * 8 - 4, 0, 100);
          const newUtil = clamp(link.utilization + (target - link.utilization) * 0.12, 0, 100);
          const newLatency = link.latency * (1 + (newUtil / 100) * 3);
          const newLoss = newUtil > 80 ? (newUtil - 80) * 0.5 : 0;

          let state: NetworkLink['state'] = 'active';
          if (newUtil > 80) state = 'congested';
          if (link.state === 'rerouted') state = 'rerouted';

          return { ...link, utilization: newUtil, latency: newLatency, packetLoss: newLoss, state };
        });

        const congestedLinks = updated.filter(l => l.utilization > 80);
        if (congestedLinks.length > 0 && autoRoutingRef.current) {
          const linkId = congestedLinks[0].id;
          setTimeout(() => triggerReroute(linkId, updated), 100);
        }

        const hasCongestion = congestedLinks.length > 0;
        setCongestionAlert(hasCongestion ? `CONGESTION DETECTED ON ${congestedLinks.map(l => l.id).join(', ')}` : null);

        return updated;
      });

      // Update node queues
      setNodes(prev => prev.map(node => {
        if (node.type !== 'switch') return node;
        const activeOnNode = packetsRef.current.filter(p =>
          !p.dropped && (p.path[p.pathIndex] === node.id || p.path[p.pathIndex + 1] === node.id)
        ).length;
        const queueLength = clamp(activeOnNode * 3, 0, 100);
        const cpu = clamp(queueLength + Math.random() * 10, 5, 100);
        return { ...node, queueLength, cpu, packetsForwarded: node.packetsForwarded + Math.floor(Math.random() * 3) };
      }));

    }, 200);
    return () => clearInterval(interval);
  }, []);

  // ── History collection ───────────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      if (!runningRef.current) return;
      const ls = linksRef.current;
      const getUtil = (id: string) => ls.find(l => l.id === id)?.utilization ?? 0;

      setHistory(prev => {
        const point: HistoryPoint = {
          t: prev.length,
          throughput: statsRef.current.throughput,
          latency: statsRef.current.avgLatency,
          r1r2: getUtil('R1-R2'),
          r1r3: getUtil('R1-R3'),
          r2r5: getUtil('R2-R5'),
          r3r5: getUtil('R3-R5'),
          dropped: statsRef.current.packetsDropped,
        };
        return [...prev.slice(-120), point];
      });

      const totalUtil = linksRef.current.reduce((s, l) => s + l.utilization, 0) / linksRef.current.length;
      const maxBw = 1000;
      setStats(prev => ({
        ...prev,
        throughput: (totalUtil / 100) * maxBw * 0.4,
        avgLatency: linksRef.current.reduce((s, l) => s + l.latency, 0) / linksRef.current.length,
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── SDN Controller Auto Rerouting ────────────────────────────────────────

  const triggerReroute = useCallback((congestedLinkId: string, currentLinks?: NetworkLink[]) => {
    const ls = currentLinks ?? linksRef.current;

    for (const { key, pathIndex } of activeRoutesRef.current) {
      const paths = FLOW_ROUTES[key];
      if (!paths) continue;
      const currentPath = paths[pathIndex];
      if (!currentPath) continue;
      const currentLinkIds = getPathLinks(currentPath);
      if (!currentLinkIds.includes(congestedLinkId)) continue;

      const candidates: RoutingCandidate[] = paths.map((path, idx) => {
        const { util, latency, loss, cost } = calcPathCost(path, ls);
        return {
          path,
          pathStr: path.join(' → '),
          utilization: util,
          latency,
          packetLoss: loss,
          hops: path.length - 1,
          cost,
          selected: idx === pathIndex,
        };
      });

      setRoutingCandidates(candidates);

      const best = candidates
        .filter((_, i) => i !== pathIndex)
        .sort((a, b) => a.cost - b.cost)[0];

      if (!best) continue;
      const bestIdx = paths.findIndex(p => p === best.path);
      if (bestIdx === pathIndex) continue;

      setControllerPulse(true);
      setTimeout(() => setControllerPulse(false), 2000);

      const newRules: FlowRule[] = best.path.filter(n => n.startsWith('R')).map(sw => ({
        switchId: sw,
        inPort: 'eth0',
        outPort: 'eth1',
        match: `dst=${currentPath[currentPath.length - 1]}`,
        action: `forward(${best.path[best.path.indexOf(sw) + 1] ?? 'out'})`,
        priority: 200,
        timestamp: Date.now(),
      }));

      setFlowRules(prev => [...newRules, ...prev].slice(0, 20));

      const oldPathStr = currentPath.join(' → ');
      const newPathStr = best.path.join(' → ');
      addAlert('warning', `CONGESTION DETECTED`, `Link ${congestedLinkId} at ${Math.round(ls.find(l => l.id === congestedLinkId)?.utilization ?? 0)}% utilization`);
      setTimeout(() => addAlert('info', `ROUTE CALCULATED`, `Alt path: ${newPathStr} (cost=${best.cost.toFixed(1)})`), 400);
      setTimeout(() => addAlert('info', `FLOW RULES UPDATED`, `${newRules.length} switches reprogrammed`), 800);
      setTimeout(() => {
        addAlert('success', `TRAFFIC REROUTED`, `${oldPathStr} → ${newPathStr}`);
        setRoutingHistory(prev => [`[${new Date().toLocaleTimeString()}] ${key}: Path ${pathIndex + 1}→${bestIdx + 1} | ${congestedLinkId} congested`, ...prev].slice(0, 20));

        setActiveRoutes(prev => prev.map(r =>
          r.key === key ? { ...r, pathIndex: bestIdx } : r
        ));

        setLinks(prev => prev.map(link => {
          if (currentLinkIds.includes(link.id)) return { ...link, state: 'rerouted' as const };
          const newLinkIds = getPathLinks(best.path);
          if (newLinkIds.includes(link.id)) return { ...link, state: 'active' as const };
          return link;
        }));

        setStats(s => ({ ...s, rerouteCount: s.rerouteCount + 1, totalFlowUpdates: s.totalFlowUpdates + newRules.length }));
        setTimeout(() => addAlert('success', `CONGESTION RESOLVED`, `Traffic successfully rerouted via ${newPathStr}`), 1200);

        setTimeout(() => {
          setLinks(prev => prev.map(l => ({ ...l, state: l.utilization > 80 ? 'congested' : 'active' })));
        }, 8000);
      }, 1200);

      break;
    }
  }, [addAlert]);

  // ── Demo mode ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!demoMode) return;
    setRunning(true);
    setAutoRouting(true);
    const steps = [
      [1500, () => { setTrafficLevel('normal'); addAlert('info', 'DEMO MODE STARTED', 'Initializing normal traffic flow'); }],
      [4000, () => { setTrafficLevel('high'); addAlert('warning', 'TRAFFIC SURGE', 'Increasing network load to HIGH'); }],
      [8000, () => { setTrafficLevel('extreme'); addAlert('critical', 'EXTREME CONGESTION', 'Stress testing SDN rerouting mechanism'); }],
      [14000, () => { setTrafficLevel('high'); addAlert('info', 'LOAD STABILIZING', 'Congestion dissipated, normalizing route'); }],
      [18000, () => { setTrafficLevel('normal'); addAlert('success', 'DEMO COMPLETE', 'SDN operations stabilized perfectly'); setDemoMode(false); }],
    ] as [number, () => void][];

    const timers = steps.map(([delay, fn]) => setTimeout(fn, delay));
    return () => timers.forEach(clearTimeout);
  }, [demoMode, addAlert]);

  // ── Controls ─────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setRunning(false);
    setPackets([]);
    setNodes(INITIAL_NODES.map(n => ({ ...n })));
    setLinks(INITIAL_LINKS.map(l => ({ ...l })));
    setStats({ packetsSent: 0, packetsReceived: 0, packetsDropped: 0, avgLatency: 0, throughput: 0, totalFlowUpdates: 0, rerouteCount: 0 });
    setHistory([]);
    setAlerts([]);
    setFlowRules([]);
    setRoutingCandidates([]);
    setCongestionAlert(null);
    setActiveRoutes(ALL_ROUTE_KEYS.map(k => ({ key: k, pathIndex: 0 })));
    setRoutingHistory([]);
  }, []);

  const handleCreateCongestion = useCallback(() => {
    if (!running) return;
    setTrafficLevel('extreme');
    requestTrafficLevel('extreme');
    addAlert('critical', 'MANUAL CONGESTION', 'Traffic elevated to EXTREME level on SW-R2 link');
    setTimeout(() => {
      triggerReroute('R1-R2');
    }, 2000);
  }, [running, addAlert, triggerReroute]);

  const selectedNodeData = nodes.find(n => n.id === selectedNode);
  const selectedNodeLinks = links.filter(l => l.from === selectedNode || l.to === selectedNode);
  const trafficInfo = TRAFFIC_LABEL[trafficLevel];

  const getUtilColor = (v: number) => v > 80 ? '#DC2626' : v > 60 ? '#D97706' : '#059669';

  return (
    <div className="min-h-screen noc-grid font-display selection:bg-[#141312] selection:text-[#FCFAF7]">

      {/* ── Top Bar (Warm Beige Architectural Header with Backend Status) ── */}
      <header
        style={{
          borderBottom: '1px solid #D8CEBD',
          background: '#EFE7DA',
          boxShadow: '0 2px 8px rgba(45, 38, 25, 0.05)',
        }}
        className="px-5 py-2.5 flex items-center justify-between"
      >
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-3">
            {/* Obsidian Black Emblem */}
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 7,
                background: '#141312',
                border: '1px solid #2B2824',
                boxShadow: '0 4px 10px rgba(20, 19, 18, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ color: '#F59E0B', fontSize: 16, fontWeight: 700 }}>⬡</span>
            </div>
            <div>
              <div style={{ color: '#141312', fontFamily: 'Rajdhani', fontWeight: 800, fontSize: 17, letterSpacing: 2, textTransform: 'uppercase' }}>
                SDN Network Operations Center
              </div>
              <div style={{ color: '#5C564C', fontFamily: 'Share Tech Mono', fontSize: 9.5, letterSpacing: 1 }}>
                INTELLIGENT TRAFFIC MANAGEMENT & DYNAMIC ROUTER CONTROLLER
              </div>
            </div>
          </div>

          <div style={{ width: 1, height: 32, background: '#D8CEBD' }} />

          {/* Metric Stats Cards in Top Bar */}
          <div className="flex items-center gap-2.5">
            {[
              { label: 'PKT SENT', value: stats.packetsSent.toLocaleString(), color: '#0284C7' },
              { label: 'PKT RECV', value: stats.packetsReceived.toLocaleString(), color: '#059669' },
              { label: 'DROPPED', value: stats.packetsDropped.toLocaleString(), color: '#DC2626' },
              { label: 'THROUGHPUT', value: `${stats.throughput.toFixed(0)} Mbps`, color: '#D97706' },
              { label: 'AVG LATENCY', value: `${stats.avgLatency.toFixed(1)} ms`, color: '#7C3AED' },
              { label: 'REROUTES', value: stats.rerouteCount, color: '#0D9488' },
            ].map(s => (
              <div
                key={s.label}
                className="text-center px-2.5 py-1 rounded"
                style={{
                  minWidth: 74,
                  background: '#FCFAF7',
                  border: '1px solid #D8CEBD',
                  boxShadow: '0 1px 3px rgba(35, 28, 18, 0.04)',
                }}
              >
                <div style={{ color: s.color, fontFamily: 'Share Tech Mono', fontSize: 12.5, fontWeight: 700 }}>
                  {s.value}
                </div>
                <div style={{ color: '#5C564C', fontSize: 8, letterSpacing: 0.8, fontWeight: 600 }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Live Backend Connection Indicator */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded shadow-xs"
            style={{
              background: backendConnected ? '#ECFDF5' : '#FFFBEB',
              border: `1px solid ${backendConnected ? '#A7F3D0' : '#FDE68A'}`,
            }}
            title={backendConnected ? 'Connected to SDN Controller Backend API' : 'Using Local Engine'}
          >
            <span
              className="w-2 h-2 rounded-full inline-block animate-pulse"
              style={{ background: backendConnected ? '#059669' : '#D97706' }}
            />
            <span
              style={{
                color: backendConnected ? '#047857' : '#B45309',
                fontFamily: 'Share Tech Mono',
                fontSize: 9.5,
                fontWeight: 700,
              }}
            >
              {backendConnected ? 'BACKEND: CONNECTED [API]' : 'BACKEND: SYNCING'}
            </span>
          </div>

          {/* Traffic level pill */}
          <div
            style={{
              border: `1px solid ${trafficInfo.color}66`,
              borderRadius: 5,
              padding: '4px 10px',
              background: trafficInfo.bg,
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <span style={{ color: trafficInfo.color, fontFamily: 'Share Tech Mono', fontSize: 11, fontWeight: 700 }}>
              TRAFFIC: {trafficInfo.label}
            </span>
          </div>

          {/* Status pill */}
          <div
            className="flex items-center gap-2 px-2.5 py-1 rounded"
            style={{
              background: '#FCFAF7',
              border: '1px solid #D8CEBD',
            }}
          >
            <span
              className="status-dot animate-blink"
              style={{ background: running ? '#059669' : '#78716C' }}
            />
            <span
              style={{
                color: running ? '#059669' : '#5C564C',
                fontFamily: 'Share Tech Mono',
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {running ? 'LIVE SIM' : 'IDLE'}
            </span>
          </div>

          <div
            style={{
              color: '#5C564C',
              fontFamily: 'Share Tech Mono',
              fontSize: 10,
              fontWeight: 600,
              background: '#E6DFD2',
              padding: '3px 8px',
              borderRadius: 4,
            }}
          >
            {new Date().toLocaleTimeString()}
          </div>
        </div>
      </header>

      {/* ── Congestion Alert Banner with 1-Click Interactive Router Switching ── */}
      {congestionAlert && (
        <div
          className="animate-congestion px-5 py-2.5 flex items-center justify-between shadow-sm"
          style={{
            borderBottom: '1.5px solid #DC2626',
            background: '#FEF2F2',
          }}
        >
          <div className="flex items-center gap-2.5">
            <span style={{ color: '#DC2626', fontSize: 16 }}>⚠</span>
            <div>
              <span style={{ color: '#B91C1C', fontFamily: 'Share Tech Mono', fontSize: 11, fontWeight: 700, display: 'block' }}>
                {congestionAlert}
              </span>
              <span style={{ color: '#7F1D1D', fontFamily: 'Share Tech Mono', fontSize: 9 }}>
                Heavy traffic detected. Select an alternate router below to divert packets immediately:
              </span>
            </div>
          </div>

          {/* 1-Click Interactive Route Switch Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBypassRouter('R2')}
              className="px-3 py-1 rounded font-mono-tech text-[10px] font-bold cursor-pointer shadow-xs transition hover:brightness-105"
              style={{ background: '#DC2626', color: '#FFFFFF', border: '1px solid #B91C1C' }}
            >
              ⚡ BYPASS SW-R2
            </button>
            <button
              onClick={() => handleManualReroute('PC1-SRV1', 1)}
              className="px-2.5 py-1 rounded font-mono-tech text-[10px] font-bold cursor-pointer shadow-xs transition hover:brightness-95"
              style={{ background: '#FCFAF7', color: '#047857', border: '1px solid #059669' }}
            >
              🔀 DIVERT PC1 VIA SW-R3
            </button>
            <button
              onClick={() => handleManualReroute('PC1-SRV1', 2)}
              className="px-2.5 py-1 rounded font-mono-tech text-[10px] font-bold cursor-pointer shadow-xs transition hover:brightness-95"
              style={{ background: '#FCFAF7', color: '#0284C7', border: '1px solid #0284C7' }}
            >
              🔀 DIVERT PC1 VIA SW-R4
            </button>
          </div>
        </div>
      )}

      {/* ── Main Dashboard Workspace ── */}
      <div className="flex" style={{ height: congestionAlert ? 'calc(100vh - 98px)' : 'calc(100vh - 58px)', overflow: 'hidden' }}>

        {/* ── Left Panel: Controls + Real-Time Charts ── */}
        <div
          style={{
            width: 240,
            borderRight: '1px solid #D8CEBD',
            background: '#F8F4EC',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Controls Card */}
          <div className="panel" style={{ margin: 10, marginBottom: 8, flexShrink: 0 }}>
            <div className="panel-header flex items-center justify-between">
              <span>SYSTEM CONTROLS</span>
              <span className="w-2 h-2 rounded-full bg-[#141312]" />
            </div>

            <div className="p-2.5 flex flex-col gap-2">
              {/* Start/Pause Master Button */}
              <button
                onClick={() => setRunning(r => !r)}
                style={{
                  background: running ? '#FEF2F2' : '#141312',
                  border: `1.5px solid ${running ? '#DC2626' : '#141312'}`,
                  color: running ? '#DC2626' : '#FCFAF7',
                  borderRadius: 5,
                  padding: '7px 10px',
                  fontFamily: 'Share Tech Mono',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  letterSpacing: 1,
                  boxShadow: running ? 'none' : '0 4px 12px rgba(20, 19, 18, 0.25)',
                  transition: 'all 0.15s ease',
                }}
              >
                {running ? '⏸ PAUSE SIMULATION' : '▶ START SIMULATION'}
              </button>

              <button
                onClick={handleReset}
                style={{
                  background: '#EBE4D6',
                  border: '1px solid #C8BFB0',
                  color: '#2B2824',
                  borderRadius: 4,
                  padding: '5px 8px',
                  fontFamily: 'Share Tech Mono',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ↺ RESET ENGINE
              </button>

              {/* Traffic Level Selector */}
              <div style={{ borderTop: '1px solid #E2DDD2', paddingTop: 8, marginTop: 2 }}>
                <div style={{ color: '#5C564C', fontSize: 9, letterSpacing: 1, fontWeight: 700, marginBottom: 5 }}>
                  TRAFFIC PROFILE
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['low', 'normal', 'high', 'extreme'] as TrafficLevel[]).map(lvl => {
                    const ti = TRAFFIC_LABEL[lvl];
                    const active = trafficLevel === lvl;
                    return (
                      <button
                        key={lvl}
                        onClick={() => {
                          setTrafficLevel(lvl);
                          requestTrafficLevel(lvl);
                        }}
                        style={{
                          background: active ? '#141312' : '#FCFAF7',
                          border: `1px solid ${active ? '#141312' : '#D8CEBD'}`,
                          color: active ? '#FFFFFF' : '#47433B',
                          borderRadius: 4,
                          padding: '5px 4px',
                          fontFamily: 'Share Tech Mono',
                          fontSize: 9.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                          boxShadow: active ? '0 2px 6px rgba(0,0,0,0.15)' : 'none',
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: ti.color,
                            display: 'inline-block',
                          }}
                        />
                        {ti.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ borderTop: '1px solid #E2DDD2', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  onClick={handleCreateCongestion}
                  disabled={!running}
                  style={{
                    display: 'block',
                    width: '100%',
                    background: running ? '#FEF2F2' : '#F5F0E6',
                    border: `1px solid ${running ? '#DC2626' : '#D8CEBD'}`,
                    color: running ? '#DC2626' : '#8A8275',
                    borderRadius: 4,
                    padding: '6px 8px',
                    fontFamily: 'Share Tech Mono',
                    fontSize: 9.5,
                    fontWeight: 700,
                    cursor: running ? 'pointer' : 'not-allowed',
                  }}
                >
                  ⚡ SIMULATE HEAVY TRAFFIC
                </button>

                <button
                  onClick={() => setAutoRouting(a => !a)}
                  style={{
                    display: 'block',
                    width: '100%',
                    background: autoRouting ? '#F0F9FF' : '#FCFAF7',
                    border: `1px solid ${autoRouting ? '#0284C7' : '#D8CEBD'}`,
                    color: autoRouting ? '#0369A1' : '#5C564C',
                    borderRadius: 4,
                    padding: '6px 8px',
                    fontFamily: 'Share Tech Mono',
                    fontSize: 9.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {autoRouting ? '✓ AUTO REROUTING: ON' : '○ MANUAL OVERRIDE: ON'}
                </button>

                <button
                  onClick={() => { if (!demoMode) setDemoMode(true); }}
                  style={{
                    display: 'block',
                    width: '100%',
                    background: demoMode ? '#FEF3C7' : '#FCFAF7',
                    border: `1px solid ${demoMode ? '#D97706' : '#D8CEBD'}`,
                    color: demoMode ? '#B45309' : '#141312',
                    borderRadius: 4,
                    padding: '6px 8px',
                    fontFamily: 'Share Tech Mono',
                    fontSize: 9.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {demoMode ? '▶ DEMO IN PROGRESS...' : '▶ RUN DEMO SCENARIO'}
                </button>

                <button
                  onClick={() => {
                    if (!running) return;
                    for (const key of ALL_ROUTE_KEYS) {
                      for (let i = 0; i < 6; i++) {
                        setTimeout(() => spawnPacket(key, activeRoutesRef.current.find(r => r.key === key)?.pathIndex ?? 0), i * 80);
                      }
                    }
                    addAlert('info', 'TRAFFIC BURST', 'High-volume synthetic traffic injected across all SDN routes');
                  }}
                  disabled={!running}
                  style={{
                    background: running ? '#FCFAF7' : '#F5F0E6',
                    border: `1px solid ${running ? '#0284C7' : '#D8CEBD'}`,
                    color: running ? '#0284C7' : '#8A8275',
                    borderRadius: 4,
                    padding: '5px 8px',
                    fontFamily: 'Share Tech Mono',
                    fontSize: 9,
                    fontWeight: 700,
                    cursor: running ? 'pointer' : 'not-allowed',
                  }}
                >
                  ⚡ INJECT TRAFFIC BURST
                </button>
              </div>
            </div>
          </div>

          {/* Real-time Metric Charts */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 10px' }}>
            <LiveCharts history={history} />
          </div>
        </div>

        {/* ── Center Panel: Topology Canvas ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Canvas Sub-Header */}
          <div
            style={{
              padding: '8px 14px',
              borderBottom: '1px solid #D8CEBD',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#EAE2D3',
            }}
          >
            <div className="flex items-center gap-2">
              <span style={{ color: '#141312', fontFamily: 'Rajdhani', fontWeight: 800, fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                Network Topology — SDN OpenFlow Domain
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono-tech bg-[#141312] text-[#FCFAF7] font-bold">
                13 NODES • BLACK OBSIDIAN
              </span>
            </div>

            <div className="flex items-center gap-4">
              {[
                { label: 'Active Link', color: '#475569' },
                { label: 'Congested', color: '#DC2626' },
                { label: 'Rerouted', color: '#059669' },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <div style={{ width: 14, height: 3.5, background: s.color, borderRadius: 2 }} />
                  <span style={{ color: '#47433B', fontSize: 10, fontFamily: 'Share Tech Mono', fontWeight: 600 }}>
                    {s.label}
                  </span>
                </div>
              ))}

              <div
                className="px-2 py-0.5 rounded font-mono-tech text-[10px] font-bold"
                style={{ background: '#FCFAF7', border: '1px solid #D8CEBD', color: '#141312' }}
              >
                In-Flight: {packets.filter(p => !p.dropped).length}
              </div>
            </div>
          </div>

          {/* Interactive Canvas */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <TopologyCanvas
              nodes={nodes}
              links={links}
              packets={packets}
              selectedNode={selectedNode}
              onNodeClick={(id) => {
                setSelectedNode(id || null);
                if (id) setActiveTab('details');
              }}
              congestionAlert={congestionAlert}
            />

            {/* SDN Controller pulse overlay */}
            {controllerPulse && (
              <div
                style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  pointerEvents: 'none',
                  border: '3px solid #D97706',
                  animation: 'reroute-flash 0.6s infinite',
                }}
              />
            )}

            {/* Active Route Path Indicators (Bottom Left overlay) */}
            <div
              style={{
                position: 'absolute',
                bottom: 10,
                left: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                pointerEvents: 'none',
              }}
            >
              {activeRoutes.map(r => {
                const paths = FLOW_ROUTES[r.key];
                const path = paths?.[r.pathIndex];
                if (!path) return null;
                const transit = getTransitRouter(path);
                return (
                  <div
                    key={r.key}
                    style={{
                      background: 'rgba(252, 250, 247, 0.94)',
                      border: '1px solid #D1C7B7',
                      borderRadius: 4,
                      padding: '3px 8px',
                      fontFamily: 'Share Tech Mono',
                      fontSize: 8.5,
                      fontWeight: 700,
                      color: '#141312',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                    }}
                  >
                    <span style={{ color: '#0284C7' }}>{r.key}:</span> {path.join(' → ')}
                    <span className="ml-2 text-[#059669]">[{transit}]</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Realtime Link Utilization Status Bar */}
          <div
            style={{
              borderTop: '1px solid #D8CEBD',
              padding: '6px 14px',
              background: '#EFE7DA',
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <span style={{ fontFamily: 'Rajdhani', fontWeight: 800, fontSize: 11, color: '#141312', letterSpacing: 1 }}>
              LINK LOAD:
            </span>
            {links.filter(l => l.utilization > 0 || l.active).map(link => {
              const color = getUtilColor(link.utilization);
              return (
                <div key={link.id} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 105 }}>
                  <span style={{ color: '#47433B', fontFamily: 'Share Tech Mono', fontSize: 9, fontWeight: 700, minWidth: 48 }}>
                    {link.id}
                  </span>
                  <div style={{ width: 44, height: 5, background: '#D8CEBD', borderRadius: 3, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${link.utilization}%`,
                        height: '100%',
                        background: color,
                        transition: 'width 0.3s ease, background 0.3s ease',
                      }}
                    />
                  </div>
                  <span style={{ color, fontFamily: 'Share Tech Mono', fontSize: 9, fontWeight: 700 }}>
                    {Math.round(link.utilization)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right Panel: Route Analysis, Flow Rules, & Logs ── */}
        <div
          style={{
            width: 320,
            borderLeft: '1px solid #D8CEBD',
            background: '#F8F4EC',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Navigation Tabs (ROUTERS is the primary tab!) */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid #D8CEBD',
              background: '#EAE2D3',
              flexShrink: 0,
            }}
          >
            {([
              { id: 'routers', label: 'ROUTERS' },
              { id: 'flowtable', label: 'FLOWS' },
              { id: 'routing', label: 'HISTORY' },
              { id: 'linkstats', label: 'LINKS' },
              { id: 'details', label: 'NODE' },
            ] as const).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  padding: '8px 1px',
                  fontSize: 9,
                  letterSpacing: 0.5,
                  fontFamily: 'Share Tech Mono',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: activeTab === tab.id ? '#141312' : 'transparent',
                  color: activeTab === tab.id ? '#FCFAF7' : '#5C564C',
                  border: 'none',
                  transition: 'background 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content Area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>

            {/* ── TAB 1: INTERACTIVE ROUTER SWITCHER (CHANGE ROUTER) ── */}
            {activeTab === 'routers' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div style={{ color: '#141312', fontSize: 10, letterSpacing: 1, fontWeight: 800, fontFamily: 'Rajdhani', textTransform: 'uppercase' }}>
                    DYNAMIC ROUTER CONTROLLER
                  </div>
                  <span className="text-[8px] font-mono-tech px-1.5 py-0.5 rounded bg-[#FCFAF7] border border-[#D8CEBD] text-[#047857] font-bold">
                    INTERACTIVE
                  </span>
                </div>

                <div className="text-[8.5px] font-mono-tech text-[#5C564C] mb-3 leading-tight">
                  Click any alternate router below to divert packets in real-time. When traffic spikes, change routers immediately to bypass congestion.
                </div>

                {/* Flow streams with selectable routers */}
                <div className="flex flex-col gap-2.5">
                  {ALL_ROUTE_KEYS.map(key => {
                    const paths = FLOW_ROUTES[key];
                    const activeRoute = activeRoutes.find(r => r.key === key);
                    const currentIdx = activeRoute?.pathIndex ?? 0;
                    const currentPath = paths[currentIdx];
                    const currentVia = getTransitRouter(currentPath);

                    return (
                      <div
                        key={key}
                        className="p-2.5 rounded shadow-xs"
                        style={{
                          background: '#FCFAF7',
                          border: '1px solid #D8CEBD',
                        }}
                      >
                        {/* Stream Header */}
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-mono-tech font-bold text-[10px] text-[#141312]">
                            {key}
                          </span>
                          <span
                            className="font-mono-tech text-[8px] font-bold px-1.5 py-0.5 rounded"
                            style={{
                              background: '#E0F2FE',
                              color: '#0369A1',
                              border: '1px solid #BAE6FD',
                            }}
                          >
                            Active: {currentVia}
                          </span>
                        </div>

                        {/* Current Path String */}
                        <div className="text-[8px] font-mono-tech text-[#5C564C] mb-2">
                          Path: <span className="text-[#141312] font-semibold">{currentPath.join(' → ')}</span>
                        </div>

                        {/* Alternate Router Switching Buttons */}
                        <div className="flex flex-col gap-1">
                          <span className="text-[7.5px] font-mono-tech text-[#78716C] font-bold">
                            SWITCH ROUTER / PATH:
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {paths.map((p, idx) => {
                              const isActive = idx === currentIdx;
                              const via = getTransitRouter(p);
                              const cost = calcPathCost(p, links);
                              const isCongested = cost.util > 75;

                              return (
                                <button
                                  key={idx}
                                  onClick={() => handleManualReroute(key, idx)}
                                  className="text-left px-2 py-1 rounded text-[8.5px] font-mono-tech font-bold cursor-pointer transition shadow-xs flex items-center justify-between gap-1.5"
                                  style={{
                                    flex: '1 1 calc(50% - 4px)',
                                    background: isActive
                                      ? '#141312'
                                      : isCongested
                                      ? '#FEF2F2'
                                      : '#F5F0E6',
                                    color: isActive
                                      ? '#FFFFFF'
                                      : isCongested
                                      ? '#DC2626'
                                      : '#141312',
                                    border: `1px solid ${isActive ? '#141312' : isCongested ? '#FCA5A5' : '#D8CEBD'}`,
                                  }}
                                  title={`Switch ${key} to ${p.join(' → ')}`}
                                >
                                  <span>{isActive ? '● ' : '🔀 '}{via}</span>
                                  <span style={{ fontSize: '7.5px', opacity: isActive ? 0.85 : 1 }}>
                                    {Math.round(cost.util)}% load
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Router Quick Bypass Center */}
                <div className="mt-4 pt-3 border-t border-[#D8CEBD]">
                  <div style={{ color: '#141312', fontSize: 10, letterSpacing: 1, fontWeight: 800, fontFamily: 'Rajdhani', marginBottom: 6 }}>
                    ROUTER BYPASS MATRIX
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {['SW-R1', 'SW-R2', 'SW-R3', 'SW-R4', 'SW-R5', 'SW-R6'].map(routerId => {
                      const norm = routerId.replace('SW-', '');
                      const nodeObj = nodes.find(n => n.id === norm);
                      const isHighLoad = (nodeObj?.cpu ?? 0) > 60 || (nodeObj?.queueLength ?? 0) > 20;

                      return (
                        <button
                          key={routerId}
                          onClick={() => handleBypassRouter(routerId)}
                          className="px-2 py-1.5 rounded text-[8.5px] font-mono-tech font-bold cursor-pointer text-left transition shadow-xs flex items-center justify-between"
                          style={{
                            background: isHighLoad ? '#FEF2F2' : '#FCFAF7',
                            border: `1px solid ${isHighLoad ? '#DC2626' : '#D8CEBD'}`,
                            color: isHighLoad ? '#DC2626' : '#141312',
                          }}
                        >
                          <span>{routerId}</span>
                          <span className="text-[7.5px] underline">BYPASS</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB 2: OPENFLOW RULES ── */}
            {activeTab === 'flowtable' && (
              <div>
                <div style={{ color: '#5C564C', fontSize: 9, letterSpacing: 1, fontWeight: 700, marginBottom: 8, fontFamily: 'Share Tech Mono' }}>
                  ACTIVE OPENFLOW ENTRIES ({flowRules.length})
                </div>
                {flowRules.length === 0 && (
                  <div
                    className="p-4 rounded text-center"
                    style={{ background: '#FCFAF7', border: '1px solid #D8CEBD', color: '#5C564C', fontSize: 9.5, fontFamily: 'Share Tech Mono' }}
                  >
                    No OpenFlow rules installed yet.<br />Start simulation or switch routes to program SDN switches.
                  </div>
                )}
                {flowRules.map((rule, i) => (
                  <div
                    key={i}
                    className="mb-2 p-2 rounded shadow-xs"
                    style={{
                      border: '1px solid #D8CEBD',
                      background: '#FCFAF7',
                    }}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-mono-tech font-bold text-[10px] text-[#141312] bg-[#EBE4D6] px-1.5 py-0.5 rounded">
                        {rule.switchId}
                      </span>
                      <span className="font-mono-tech text-[8px] text-[#5C564C]">priority={rule.priority}</span>
                    </div>
                    <div className="font-mono-tech text-[8px] text-[#47433B] leading-relaxed">
                      <div><b className="text-[#0284C7]">MATCH:</b> {rule.match}</div>
                      <div><b className="text-[#D97706]">PORT:</b> {rule.inPort} → {rule.outPort}</div>
                      <div><b className="text-[#059669]">ACTION:</b> {rule.action}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── TAB 3: ROUTING HISTORY ── */}
            {activeTab === 'routing' && (
              <div>
                <div style={{ color: '#5C564C', fontSize: 9, letterSpacing: 1, fontWeight: 700, marginBottom: 8, fontFamily: 'Share Tech Mono' }}>
                  SDN REROUTING LOGS ({routingHistory.length})
                </div>
                {routingHistory.length === 0 && (
                  <div
                    className="p-4 rounded text-center"
                    style={{ background: '#FCFAF7', border: '1px solid #D8CEBD', color: '#5C564C', fontSize: 9.5, fontFamily: 'Share Tech Mono' }}
                  >
                    Network operating normally.<br />No reroute events recorded.
                  </div>
                )}
                {routingHistory.map((h, i) => (
                  <div
                    key={i}
                    className="mb-1.5 p-2 rounded"
                    style={{
                      border: '1px solid #A7F3D0',
                      background: '#ECFDF5',
                    }}
                  >
                    <span style={{ color: '#047857', fontFamily: 'Share Tech Mono', fontSize: 9, fontWeight: 600, lineHeight: 1.4, display: 'block' }}>
                      {h}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* ── TAB 4: TELEMETRY ── */}
            {activeTab === 'linkstats' && (
              <div>
                <div style={{ color: '#5C564C', fontSize: 9, letterSpacing: 1, fontWeight: 700, marginBottom: 8, fontFamily: 'Share Tech Mono' }}>
                  TELEMETRY METRICS
                </div>
                {links.map(link => {
                  const color = getUtilColor(link.utilization);
                  return (
                    <div
                      key={link.id}
                      className="mb-2 p-2 rounded shadow-xs"
                      style={{
                        border: `1px solid ${link.utilization > 80 ? '#FCA5A5' : '#D8CEBD'}`,
                        background: link.utilization > 80 ? '#FEF2F2' : '#FCFAF7',
                      }}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-mono-tech text-[10px] font-bold text-[#141312]">{link.id}</span>
                        <span className="font-mono-tech text-[10px] font-bold" style={{ color }}>{Math.round(link.utilization)}%</span>
                      </div>
                      <div style={{ height: 4, background: '#D8CEBD', borderRadius: 2, marginBottom: 4 }}>
                        <div
                          style={{
                            width: `${link.utilization}%`,
                            height: '100%',
                            background: color,
                            borderRadius: 2,
                            transition: 'width 0.4s ease',
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[8px] font-mono-tech text-[#5C564C]">
                        <span>LAT: <b style={{ color: '#D97706' }}>{link.latency.toFixed(1)}ms</b></span>
                        <span>BW: <b style={{ color: '#0284C7' }}>{link.bandwidth}M</b></span>
                        <span>LOSS: <b style={{ color: link.packetLoss > 0 ? '#DC2626' : '#059669' }}>{link.packetLoss.toFixed(1)}%</b></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── TAB 5: NODE INSPECTOR ── */}
            {activeTab === 'details' && (
              <div>
                {!selectedNode && (
                  <div
                    className="p-5 rounded text-center"
                    style={{ background: '#FCFAF7', border: '1px solid #D8CEBD', color: '#5C564C', fontSize: 9.5, fontFamily: 'Share Tech Mono' }}
                  >
                    Select any black node in the canvas to inspect real-time queue, CPU & OpenFlow interfaces.
                  </div>
                )}
                {selectedNodeData && (
                  <div>
                    {/* Sleek Obsidian Black Node Header Card */}
                    <div
                      className="p-3 rounded mb-2.5 shadow-md"
                      style={{
                        background: '#141312',
                        border: '1px solid #2B2824',
                        color: '#FCFAF7',
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div style={{ fontFamily: 'Rajdhani', fontSize: 18, fontWeight: 800, color: '#FCFAF7' }}>
                          {selectedNodeData.label}
                        </div>
                        <span
                          className="px-2 py-0.5 rounded text-[8px] font-mono-tech font-bold"
                          style={{
                            background: selectedNodeData.type === 'controller' ? '#D97706' : '#27272A',
                            color: '#FFFFFF',
                          }}
                        >
                          {selectedNodeData.type.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ color: '#A1A1AA', fontFamily: 'Share Tech Mono', fontSize: 9 }}>
                        ID: {selectedNodeData.id} • IP: {selectedNodeData.ip ?? 'N/A'}
                      </div>
                    </div>

                    {/* Router Bypass Button if Switch */}
                    {selectedNodeData.type === 'switch' && (
                      <div className="mb-3">
                        <button
                          onClick={() => handleBypassRouter(selectedNodeData.id)}
                          className="w-full py-2 px-3 rounded font-mono-tech text-[10px] font-bold cursor-pointer transition shadow-xs text-white"
                          style={{ background: '#DC2626', border: '1px solid #B91C1C' }}
                        >
                          ⚡ BYPASS THIS ROUTER (Divert All Streams)
                        </button>
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                      {[
                        { label: 'PACKETS FWD', value: selectedNodeData.packetsForwarded.toLocaleString(), color: '#0284C7' },
                        { label: 'QUEUE BUFFER', value: `${selectedNodeData.queueLength} pkts`, color: selectedNodeData.queueLength > 50 ? '#DC2626' : '#D97706' },
                        { label: 'CPU UTILIZATION', value: `${Math.round(selectedNodeData.cpu)}%`, color: selectedNodeData.cpu > 80 ? '#DC2626' : '#059669' },
                      ].map(s => (
                        <div
                          key={s.label}
                          className="flex justify-between items-center p-2 rounded"
                          style={{ background: '#FCFAF7', border: '1px solid #D8CEBD' }}
                        >
                          <span style={{ color: '#5C564C', fontFamily: 'Share Tech Mono', fontSize: 9, fontWeight: 600 }}>{s.label}</span>
                          <span style={{ color: s.color, fontFamily: 'Share Tech Mono', fontSize: 10, fontWeight: 700 }}>{s.value}</span>
                        </div>
                      ))}
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div style={{ color: '#5C564C', fontSize: 9, letterSpacing: 1, fontWeight: 700, marginBottom: 5, fontFamily: 'Share Tech Mono' }}>
                        ATTACHED INTERFACES
                      </div>
                      {selectedNodeLinks.map(link => (
                        <div
                          key={link.id}
                          className="mb-1.5 p-2 rounded flex justify-between items-center"
                          style={{ background: '#FCFAF7', border: '1px solid #D8CEBD' }}
                        >
                          <span style={{ color: '#141312', fontFamily: 'Share Tech Mono', fontSize: 9, fontWeight: 700 }}>{link.id}</span>
                          <span style={{ color: getUtilColor(link.utilization), fontFamily: 'Share Tech Mono', fontSize: 9, fontWeight: 700 }}>
                            {Math.round(link.utilization)}% UTIL
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Real-time Event Log */}
          <div style={{ borderTop: '1px solid #D8CEBD', flexShrink: 0, background: '#EFE7DA' }}>
            <div className="panel-header" style={{ margin: 0, borderRadius: 0 }}>
              <span>SYSTEM EVENT STREAM</span>
            </div>
            <div style={{ height: 140, overflowY: 'auto', padding: '6px 10px', background: '#FCFAF7' }}>
              {alerts.length === 0 && (
                <div style={{ color: '#5C564C', fontSize: 9.5, fontFamily: 'Share Tech Mono', padding: 8 }}>
                  No system events recorded. Start simulation.
                </div>
              )}
              {alerts.map(ev => {
                const colors: Record<string, { fg: string; bg: string }> = {
                  info: { fg: '#0284C7', bg: '#F0F9FF' },
                  warning: { fg: '#D97706', bg: '#FFFBEB' },
                  critical: { fg: '#DC2626', bg: '#FEF2F2' },
                  success: { fg: '#059669', bg: '#ECFDF5' },
                };
                const scheme = colors[ev.type];
                return (
                  <div key={ev.id} className="mb-2 pb-1.5 border-b border-[#E8E1D3]">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className="px-1 py-0.2 rounded font-mono-tech font-bold text-[7.5px]"
                        style={{ background: scheme.bg, color: scheme.fg, border: `1px solid ${scheme.fg}40` }}
                      >
                        {ev.type.toUpperCase()}
                      </span>
                      <span style={{ color: '#141312', fontFamily: 'Share Tech Mono', fontSize: 9, fontWeight: 700 }}>
                        {ev.message}
                      </span>
                      <span style={{ color: '#78716C', fontFamily: 'Share Tech Mono', fontSize: 8, marginLeft: 'auto' }}>
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {ev.detail && (
                      <div style={{ color: '#47433B', fontFamily: 'Share Tech Mono', fontSize: 8, paddingLeft: 4, lineHeight: 1.4 }}>
                        {ev.detail}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
