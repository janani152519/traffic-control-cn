# Intelligent SDN Traffic Management Dashboard

[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.0-646CFF.svg)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38B2AC.svg)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An interactive, high-performance **Software-Defined Networking (SDN) Traffic Management Dashboard** featuring dynamic router steering, OpenFlow protocol simulation, real-time telemetry, and automated bottleneck resolution.

Designed with an elegant **Warm Architectural Beige** theme, **Obsidian Black** network nodes, and connected to an embedded/standalone **Node.js SDN Controller Backend**.

---

## 📸 Key Features

- **SDN Controller Core & OpenFlow Simulation**:
  - Live flow table rule installation, match/action processing, and flow rule priorities.
  - Centralized SDN Controller with dynamic Dijkstra-based least-cost path optimization.
- **Dynamic Router Steering & 1-Click Bypass**:
  - **Manual Router Controller**: Interactively switch transit routers (`SW-R1` through `SW-R6`) on any active traffic stream in real-time.
  - **1-Click Congestion Bypass**: Instant diversion actions in the alert banner and node inspector to route around congested switches.
- **Visual Network Operations Center (NOC)**:
  - 2X Retina HiDPI Canvas rendering 13 network nodes in satin obsidian black with crisp labels.
  - Animated packet flows with luminous particle trails (Sapphire Data, Amber Control, Emerald ACK).
  - Real-time link utilization indicators with animated directional flow arrows.
- **Live Telemetry & Recharts Analytics**:
  - Real-time Throughput (Mbps) and Packet Drops area chart.
  - End-to-end Round Trip Time (RTT) Latency line chart.
  - Multi-link utilization comparison across key core trunks.
- **Connected SDN Backend Server**:
  - Pure Node.js REST API server with zero external dependencies.
  - Integrated into Vite development server as an API middleware and executable as a standalone server on port `3001`.

---

## 🌐 Network Topology

```
 [ PC-1 ] ──┐
 [ PC-2 ] ──┼──> [ SW-R1 ] ──┬──> [ SW-R2 ] ──┬──> [ SW-R5 ] ──┬──> [ Server-1 ]
 [ PC-3 ] ──┘          │       │       │         │        │       └──> [ Server-2 ]
                       │       │    [SDN CTRL]   │        │
                       └──> [ SW-R4 ] ─┴─> [ SW-R3 ] ─┴─> [ SW-R6 ] ───> [ Server-3 ]
```

- **Hosts**: 3 PCs (`PC-1`, `PC-2`, `PC-3`), 3 Enterprise Servers (`Server-1`, `Server-2`, `Server-3`).
- **Transit Routers / Switches**: 6 OpenFlow switches (`SW-R1` through `SW-R6`).
- **SDN Controller**: Centralized controller monitoring real-time queue depths, link costs, and link health.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm` or `pnpm`

### Installation

```bash
# Clone the repository
git clone https://github.com/janani152519/traffic-control-cn.git
cd traffic-control-cn

# Install dependencies
npm install
```

### Running the Application

#### Option 1: Frontend + Integrated Backend (Recommended)
```bash
npm run dev
```
The application will launch on `http://localhost:8443` (or the configured Vite port). The SDN backend API endpoints (`/api/*`) are automatically handled by the integrated Vite plugin.

#### Option 2: Running Standalone Backend
```bash
npm run backend
# or
node backend/server.js
```
The backend server runs on `http://localhost:3001` and exposes REST endpoints for external controllers and testing.

---

## 📡 Backend REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check and uptime heartbeat |
| `GET` | `/api/status` | Returns active routes, flow tables, and telemetry |
| `GET` | `/api/routes` | Returns available multi-path candidate routes |
| `POST` | `/api/reroute` | Manually switch router or path for a traffic flow (`{ routeKey, pathIndex, targetRouter }`) |
| `POST` | `/api/router/bypass` | Diverts all streams traversing a specific router (`{ routerId }`) |
| `POST` | `/api/traffic` | Updates traffic profile level (`low`, `normal`, `high`, `extreme`) |
| `POST` | `/api/auto-routing` | Toggles automatic SDN rerouting vs. manual override |

### Example Reroute Request
```bash
curl -X POST http://localhost:3001/api/reroute \
  -H "Content-Type: application/json" \
  -d '{"routeKey":"PC1-SRV1","targetRouter":"SW-R3"}'
```

---

## 🛠 Tech Stack

- **Frontend**: React 19, TypeScript 5.7, Vite 8
- **Styling**: Tailwind CSS v4, Vanilla CSS Custom Properties
- **Visuals & Charts**: HTML5 Canvas 2D (Retina HiDPI), Recharts 3
- **Backend**: Node.js HTTP Server (`http` module, zero third-party runtime dependencies)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
