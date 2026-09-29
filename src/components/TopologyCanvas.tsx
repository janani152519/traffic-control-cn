import React, { useRef, useEffect, useCallback } from 'react';
import type { NetworkNode, NetworkLink, Packet } from '../simulation';

interface Props {
  nodes: NetworkNode[];
  links: NetworkLink[];
  packets: Packet[];
  selectedNode: string | null;
  onNodeClick: (id: string) => void;
  congestionAlert: string | null;
}

// Logical dimensions of the canvas coordinate space
const LOGICAL_WIDTH = 770;
const LOGICAL_HEIGHT = 560;

// Nodes styled in commanding obsidian black with comfortable proportions
const NODE_SIZE: Record<string, number> = {
  pc: 25,
  server: 28,
  switch: 27,
  controller: 36,
};

const NODE_ACCENTS: Record<string, string> = {
  pc: '#0284C7',        // Azure
  server: '#7C3AED',    // Amethyst
  switch: '#0D9488',    // Teal
  controller: '#D97706',// Amber Gold
};

function getLinkColor(link: NetworkLink): string {
  if (!link.active) return '#BDB3A4';
  if (link.state === 'congested') return '#DC2626';
  if (link.state === 'rerouted') return '#059669';
  if (link.utilization > 80) return '#DC2626';
  if (link.utilization > 60) return '#D97706';
  if (link.utilization > 30) return '#0284C7';
  return '#475569';
}

function getLinkWidth(link: NetworkLink): number {
  if (link.state === 'congested' || link.state === 'rerouted') return 3.5;
  if (link.utilization > 80) return 3;
  if (link.utilization > 50) return 2.5;
  return 2;
}

function getNodeById(nodes: NetworkNode[], id: string) {
  return nodes.find(n => n.id === id);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

export default function TopologyCanvas({ nodes, links, packets, selectedNode, onNodeClick, congestionAlert }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const frameRef = useRef(0);

  // Store latest props in refs to avoid re-spawning animation loops
  const nodesRef = useRef(nodes);
  const linksRef = useRef(links);
  const packetsRef = useRef(packets);
  const selectedNodeRef = useRef(selectedNode);
  const congestionAlertRef = useRef(congestionAlert);

  nodesRef.current = nodes;
  linksRef.current = links;
  packetsRef.current = packets;
  selectedNodeRef.current = selectedNode;
  congestionAlertRef.current = congestionAlert;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    frameRef.current++;
    const t = frameRef.current;

    const currentNodes = nodesRef.current;
    const currentLinks = linksRef.current;
    const currentPackets = packetsRef.current;
    const currentSelected = selectedNodeRef.current;
    const currentAlert = congestionAlertRef.current;

    const W = LOGICAL_WIDTH;
    const H = LOGICAL_HEIGHT;

    // ── HiDPI Crisp Scaling ──
    const scaleX = canvas.width / W;
    const scaleY = canvas.height / H;

    // 1. Reset full canvas and state
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scaleX, scaleY);

    // ── 2. Warm Beige Architectural Background ──
    const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.75);
    bgGrad.addColorStop(0, '#F5F0E6');
    bgGrad.addColorStop(1, '#E9E2D4');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Fine grid
    ctx.strokeStyle = 'rgba(90, 75, 55, 0.08)';
    ctx.lineWidth = 1;
    const gridSize = 36;
    for (let x = 0; x < W; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Grid cross markers
    ctx.fillStyle = 'rgba(80, 65, 45, 0.16)';
    for (let x = gridSize; x < W; x += gridSize * 2) {
      for (let y = gridSize; y < H; y += gridSize * 2) {
        ctx.fillRect(x - 2, y, 5, 1);
        ctx.fillRect(x, y - 2, 1, 5);
      }
    }

    // ── 3. Draw Network Links ──
    for (const link of currentLinks) {
      const fromNode = getNodeById(currentNodes, link.from);
      const toNode = getNodeById(currentNodes, link.to);
      if (!fromNode || !toNode) continue;

      const x1 = fromNode.x, y1 = fromNode.y, x2 = toNode.x, y2 = toNode.y;
      const color = getLinkColor(link);
      const width = getLinkWidth(link);

      // Link glow when congested or rerouted
      if (link.state === 'congested') {
        ctx.shadowBlur = 12 + Math.sin(t * 0.18) * 5;
        ctx.shadowColor = 'rgba(220, 38, 38, 0.6)';
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      } else if (link.state === 'rerouted') {
        ctx.shadowBlur = 12 + Math.sin(t * 0.12) * 5;
        ctx.shadowColor = 'rgba(5, 150, 105, 0.6)';
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      } else {
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';

      if (!link.active) {
        ctx.setLineDash([5, 6]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Reset shadows immediately
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Flow direction arrows
      if (link.active && link.utilization > 5) {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const arrowDist = ((t * 1.2) % 30) - 15;
        const ax = mx + Math.cos(angle) * arrowDist;
        const ay = my + Math.sin(angle) * arrowDist;
        const arrowSize = 6;

        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(-arrowSize, -arrowSize * 0.55);
        ctx.lineTo(0, 0);
        ctx.lineTo(-arrowSize, arrowSize * 0.55);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
      }

      // High-contrast Utilization Pill Badge
      if (link.utilization > 0) {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const hyp = Math.hypot(x2 - x1, y2 - y1) || 1;
        const perpX = (-(y2 - y1) / hyp) * 14;
        const perpY = ((x2 - x1) / hyp) * 14;
        const badgeX = mx + perpX;
        const badgeY = my + perpY;

        const text = `${Math.round(link.utilization)}%`;
        ctx.font = 'bold 9px "Share Tech Mono", monospace';
        const metrics = ctx.measureText(text);
        const badgeW = metrics.width + 10;
        const badgeH = 14;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1;

        ctx.fillStyle = '#FCFAF7';
        ctx.beginPath();
        drawRoundedRect(ctx, badgeX - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH, 4);
        ctx.fill();

        ctx.strokeStyle = link.utilization > 80 ? '#DC2626' : link.utilization > 60 ? '#D97706' : '#C8BFB0';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        // Clear shadow for pill text
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        ctx.fillStyle = link.utilization > 80 ? '#B91C1C' : link.utilization > 60 ? '#B45309' : '#1E293B';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, badgeX, badgeY + 0.5);
      }
    }

    // ── 4. Draw Animated Packets ──
    for (const packet of currentPackets) {
      if (packet.dropped) continue;
      if (packet.pathIndex >= packet.path.length - 1) continue;

      const fromNode = getNodeById(currentNodes, packet.path[packet.pathIndex]);
      const toNode = getNodeById(currentNodes, packet.path[packet.pathIndex + 1]);
      if (!fromNode || !toNode) continue;

      const px = lerp(fromNode.x, toNode.x, packet.progress);
      const py = lerp(fromNode.y, toNode.y, packet.progress);

      ctx.save();
      ctx.shadowBlur = 8;
      ctx.shadowColor = packet.color;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      ctx.beginPath();
      ctx.arc(px, py, packet.size + 1.2, 0, Math.PI * 2);
      ctx.fillStyle = packet.color;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, packet.size * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();

      // Trail
      for (let i = 1; i <= 4; i++) {
        const trailT = Math.max(0, packet.progress - i * 0.035);
        const tx = lerp(fromNode.x, toNode.x, trailT);
        const ty = lerp(fromNode.y, toNode.y, trailT);
        ctx.beginPath();
        ctx.arc(tx, ty, Math.max(1, (packet.size + 0.5) * (1 - i * 0.2)), 0, Math.PI * 2);
        ctx.fillStyle = packet.color;
        ctx.globalAlpha = Math.max(0, 0.7 - i * 0.16);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
    }

    // ── 5. Draw Nodes (SOLID OBSIDIAN BLACK BODIES WITH ULTRA-CRISP LETTERS) ──
    for (const node of currentNodes) {
      const size = NODE_SIZE[node.type];
      const accent = NODE_ACCENTS[node.type];
      const isSelected = currentSelected === node.id;
      const isCtrl = node.type === 'controller';

      // Concentric orbital rings for SDN Controller
      if (isCtrl) {
        ctx.save();
        const ring1 = size + 14 + Math.sin(t * 0.05) * 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, ring1, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(217, 119, 6, ${0.45 + Math.sin(t * 0.05) * 0.2})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.stroke();

        const ring2 = size + 24 + Math.cos(t * 0.04) * 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, ring2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(217, 119, 6, 0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.restore();
      }

      // Selection halo when clicked
      if (isSelected) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, size + 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#0284C7';
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 12;
        ctx.shadowColor = 'rgba(2, 132, 199, 0.7)';
        ctx.stroke();
        ctx.restore();
      }

      // Obsidian Black Node Body (Drop shadow isolated in save/restore)
      ctx.save();
      ctx.shadowColor = 'rgba(15, 12, 8, 0.4)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 3;

      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, Math.PI * 2);
      const nodeGrad = ctx.createRadialGradient(
        node.x - size * 0.35,
        node.y - size * 0.35,
        1,
        node.x,
        node.y,
        size
      );
      nodeGrad.addColorStop(0, '#26262B');
      nodeGrad.addColorStop(0.65, '#131316');
      nodeGrad.addColorStop(1, '#09090B');
      ctx.fillStyle = nodeGrad;
      ctx.fill();

      // Node border
      ctx.strokeStyle = isSelected ? '#0284C7' : isCtrl ? '#F59E0B' : '#3F3F46';
      ctx.lineWidth = isCtrl || isSelected ? 2 : 1.5;
      ctx.stroke();
      ctx.restore();

      // Subtle inner bezel ring inside node
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, size - 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = isCtrl ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // Micro status LED dot (Isolated with save/restore so shadow never bleeds!)
      ctx.save();
      const dotAngle = -Math.PI / 4;
      const dotDist = size - 6;
      const dotX = node.x + Math.cos(dotAngle) * dotDist;
      const dotY = node.y + Math.sin(dotAngle) * dotDist;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = node.cpu > 80 ? '#DC2626' : accent;
      ctx.shadowBlur = 4;
      ctx.shadowColor = accent;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fill();
      ctx.restore();

      // ── ULTRA-CRISP, HIGH-CONTRAST LETTERS INSIDE THE NODE ──
      // Guarantee NO shadow, NO blur, and zero offset
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (node.type === 'switch') {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 13px "Plus Jakarta Sans", "Rajdhani", sans-serif';
        ctx.fillText('OF', Math.round(node.x), Math.round(node.y));
      } else if (node.type === 'controller') {
        // SDN in radiant gold
        ctx.fillStyle = '#FBBF24';
        ctx.font = '800 11px "Plus Jakarta Sans", "Rajdhani", sans-serif';
        ctx.fillText('SDN', Math.round(node.x), Math.round(node.y - 6));

        // CTRL in pure white
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 9px "Plus Jakarta Sans", "Rajdhani", sans-serif';
        ctx.fillText('CTRL', Math.round(node.x), Math.round(node.y + 7));
      } else if (node.type === 'pc') {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 13px "Plus Jakarta Sans", "Rajdhani", sans-serif';
        ctx.fillText('PC', Math.round(node.x), Math.round(node.y));
      } else {
        // Server
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 12px "Plus Jakarta Sans", "Rajdhani", sans-serif';
        ctx.fillText('SRV', Math.round(node.x), Math.round(node.y));
      }
      ctx.restore();

      // ── Node Label (Card pill below node) ──
      const labelText = node.label;
      ctx.font = 'bold 11px "Rajdhani", sans-serif';
      const labelMetrics = ctx.measureText(labelText);
      const labelW = labelMetrics.width + 14;
      const labelH = 18;
      const labelY = node.y + size + 7;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = '#FCFAF7';
      ctx.beginPath();
      drawRoundedRect(ctx, node.x - labelW / 2, labelY, labelW, labelH, 4);
      ctx.fill();

      ctx.strokeStyle = isSelected ? '#0284C7' : '#D1C7B7';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // Clear shadows for label text
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = isSelected ? '#0284C7' : '#141312';
      ctx.font = 'bold 11px "Rajdhani", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, node.x, labelY + labelH / 2);
      ctx.restore();

      // Queue indicator badge if queued
      if (node.queueLength > 0 && node.type === 'switch') {
        const qText = `Q:${node.queueLength}`;
        ctx.font = 'bold 9px "Share Tech Mono", monospace';
        const qMetrics = ctx.measureText(qText);
        const qW = qMetrics.width + 8;
        const qH = 15;
        const qX = node.x + size + 4;
        const qY = node.y - size + 2;

        const isHigh = node.queueLength > 50;
        const isMed = node.queueLength > 25;

        ctx.save();
        ctx.fillStyle = '#141312';
        ctx.beginPath();
        drawRoundedRect(ctx, qX, qY, qW, qH, 3);
        ctx.fill();

        ctx.strokeStyle = isHigh ? '#DC2626' : isMed ? '#D97706' : '#0284C7';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        ctx.fillStyle = isHigh ? '#EF4444' : isMed ? '#F59E0B' : '#38BDF8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(qText, qX + qW / 2, qY + qH / 2);
        ctx.restore();
      }
    }

    // ── 6. Congestion Alert Vignette Overlay ──
    if (currentAlert) {
      const flash = Math.floor(t / 18) % 2 === 0;
      if (flash) {
        ctx.save();
        ctx.fillStyle = 'rgba(220, 38, 38, 0.08)';
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(220, 38, 38, 0.45)';
        ctx.lineWidth = 3;
        ctx.strokeRect(2, 2, W - 4, H - 4);
        ctx.restore();
      }
    }

    ctx.restore();
    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
      }
    };
  }, [draw]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = LOGICAL_WIDTH / rect.width;
    const scaleY = LOGICAL_HEIGHT / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    for (const node of nodesRef.current) {
      const size = NODE_SIZE[node.type];
      const dx = cx - node.x, dy = cy - node.y;
      if (Math.hypot(dx, dy) <= size + 8) {
        onNodeClick(node.id);
        return;
      }
    }
    onNodeClick('');
  }, [onNodeClick]);

  return (
    <canvas
      ref={canvasRef}
      width={1540}
      height={1120}
      onClick={handleClick}
      className="canvas-bg"
      style={{
        width: '100%',
        height: '100%',
        cursor: 'pointer',
        display: 'block',
      }}
    />
  );
}
