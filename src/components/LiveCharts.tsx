import React from 'react';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

interface ChartPoint {
  t: number;
  throughput: number;
  latency: number;
  r1r2: number;
  r1r3: number;
  r2r5: number;
  r3r5: number;
  dropped: number;
}

interface Props {
  history: ChartPoint[];
}

const TT = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="p-2.5 text-xs font-mono-tech rounded shadow-lg"
      style={{
        background: '#141312',
        border: '1px solid #2B2824',
        boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
      }}
    >
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center justify-between gap-3 text-[11px] leading-tight">
          <span style={{ color: p.color, fontWeight: 600 }}>{p.name}:</span>
          <span className="text-[#FCFAF7] font-bold">
            {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function LiveCharts({ history }: Props) {
  const recent = history.slice(-60);

  return (
    <div className="grid grid-cols-1 gap-2.5">
      {/* ── Throughput & Drops ── */}
      <div className="panel overflow-hidden">
        <div className="panel-header flex items-center justify-between">
          <span>THROUGHPUT & DROPS (Mbps)</span>
          <div className="flex items-center gap-2 text-[9px] font-mono-tech normal-case">
            <span className="flex items-center gap-1 text-[#0284C7]">
              <span className="w-2 h-2 rounded-full bg-[#0284C7] inline-block" /> TP
            </span>
            <span className="flex items-center gap-1 text-[#DC2626]">
              <span className="w-2 h-2 rounded-full bg-[#DC2626] inline-block" /> Drops
            </span>
          </div>
        </div>
        <div style={{ height: 105 }} className="p-2 pt-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={recent} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="tpGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0284C7" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#0284C7" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="dropGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#DC2626" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#DC2626" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2DDD2" vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis tick={{ fontSize: 8, fill: '#5C564C', fontWeight: 600 }} />
              <Tooltip content={<TT />} />
              <Area
                type="monotone"
                dataKey="throughput"
                name="Throughput"
                stroke="#0284C7"
                fill="url(#tpGrad)"
                strokeWidth={2}
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="dropped"
                name="Drops"
                stroke="#DC2626"
                fill="url(#dropGrad)"
                strokeWidth={1.8}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Latency ── */}
      <div className="panel overflow-hidden">
        <div className="panel-header flex items-center justify-between">
          <span>LATENCY (ms)</span>
          <span className="text-[9px] font-mono-tech text-[#D97706] font-bold">RTT</span>
        </div>
        <div style={{ height: 95 }} className="p-2 pt-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={recent} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2DDD2" vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis tick={{ fontSize: 8, fill: '#5C564C', fontWeight: 600 }} />
              <Tooltip content={<TT />} />
              <Line
                type="monotone"
                dataKey="latency"
                name="Latency"
                stroke="#D97706"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Link Utilization ── */}
      <div className="panel overflow-hidden">
        <div className="panel-header flex items-center justify-between">
          <span>LINK UTILIZATION (%)</span>
          <div className="flex items-center gap-1.5 text-[8px] font-mono-tech normal-case">
            <span className="text-[#DC2626]">R1-2</span>
            <span className="text-[#059669]">R1-3</span>
            <span className="text-[#0284C7]">R2-5</span>
            <span className="text-[#D97706]">R3-5</span>
          </div>
        </div>
        <div style={{ height: 105 }} className="p-2 pt-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={recent} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2DDD2" vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: '#5C564C', fontWeight: 600 }} />
              <Tooltip content={<TT />} />
              <Line type="monotone" dataKey="r1r2" name="R1-R2" stroke="#DC2626" strokeWidth={1.8} dot={false} />
              <Line type="monotone" dataKey="r1r3" name="R1-R3" stroke="#059669" strokeWidth={1.8} dot={false} />
              <Line type="monotone" dataKey="r2r5" name="R2-R5" stroke="#0284C7" strokeWidth={1.8} dot={false} />
              <Line type="monotone" dataKey="r3r5" name="R3-R5" stroke="#D97706" strokeWidth={1.8} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
