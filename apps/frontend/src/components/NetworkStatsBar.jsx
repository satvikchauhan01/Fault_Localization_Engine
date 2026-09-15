import React, { useMemo } from 'react';
import { AlertTriangle, Zap, HeartPulse, Layers, Wrench } from 'lucide-react';
import { resolveActiveOutagePoles } from '../utils/scheduledOutageOverlay';

/**
 * Slim, always-visible KPI strip summarizing live network health.
 * Derived entirely from data App.jsx already polls (incidents + mapData +
 * outages) — no extra network requests.
 */
export default function NetworkStatsBar({ incidents, mapData, outages = [], isLoading }) {
  const stats = useMemo(() => {
    const list = incidents || [];
    const byConf = list.reduce((acc, i) => {
      acc[i.confidence] = (acc[i.confidence] || 0) + 1;
      return acc;
    }, {});

    const poles = mapData?.poles || [];
    const monitored = poles.filter((p) => p.device_id);
    const realDark = monitored.filter((p) => p.state?.status === 'CONFIRMED_DARK');

    // Scheduled outages never touch real telemetry (see 02-DECISIONS.md #6) —
    // this is a purely client-side "which poles are in an active planned
    // outage's scope right now" overlay, same one MapView uses for coloring
    // (and the same total-pole count MapView's zone banner shows, so the two
    // views never disagree on "how big is this outage").
    const outagePoleMap = resolveActiveOutagePoles(outages, poles, mapData?.topology_edges);
    const maintenanceMonitored = monitored.filter((p) => outagePoleMap.has(p.id));

    // A pole under planned maintenance is off just as much as one that's
    // really faulted — it counts as dark either way. "Planned" vs
    // "unplanned" is tracked only for the sub-label, so operators can still
    // tell them apart without the headline number pretending maintenance
    // poles are still live.
    const darkIds = new Set(realDark.map((p) => p.id));
    for (const p of maintenanceMonitored) darkIds.add(p.id);
    const totalDarkCount = darkIds.size;
    const unplannedDarkCount = realDark.filter((p) => !outagePoleMap.has(p.id)).length;
    const plannedDarkCount = totalDarkCount - unplannedDarkCount;

    const healthPct = monitored.length > 0
      ? Math.round(((monitored.length - totalDarkCount) / monitored.length) * 1000) / 10
      : 100;

    const activeOutageCount = new Set([...outagePoleMap.values()].map((o) => o.id)).size;

    return {
      totalIncidents: list.length,
      high: byConf.HIGH || 0,
      medium: byConf.MEDIUM || 0,
      low: byConf.LOW || 0,
      totalPoles: poles.length,
      monitoredCount: monitored.length,
      darkCount: totalDarkCount,
      unplannedDarkCount,
      plannedDarkCount,
      maintenanceCount: outagePoleMap.size,
      activeOutageCount,
      healthPct,
    };
  }, [incidents, mapData, outages]);

  const healthColor = stats.healthPct >= 99 ? 'text-emerald-400'
    : stats.healthPct >= 95 ? 'text-amber-400'
      : 'text-red-400';

  const tiles = [
    {
      icon: AlertTriangle,
      color: 'text-amber-400',
      label: 'Active Incidents',
      value: stats.totalIncidents,
      sub: `${stats.high} high · ${stats.medium} med · ${stats.low} low`,
    },
    {
      icon: HeartPulse,
      color: healthColor,
      label: 'Network Health',
      value: `${stats.healthPct}%`,
      sub: `${stats.monitoredCount - stats.darkCount} / ${stats.monitoredCount} poles live`,
    },
    {
      icon: Zap,
      color: 'text-red-400',
      label: 'Poles Dark',
      value: stats.darkCount,
      sub: stats.plannedDarkCount > 0
        ? `${stats.unplannedDarkCount} unplanned · ${stats.plannedDarkCount} planned`
        : `of ${stats.monitoredCount} monitored`,
    },
    {
      icon: Wrench,
      color: 'text-violet-400',
      label: 'Under Maintenance',
      value: stats.maintenanceCount,
      sub: stats.activeOutageCount > 0 ? `${stats.activeOutageCount} active outage${stats.activeOutageCount > 1 ? 's' : ''}` : 'no active outages',
    },
    {
      icon: Layers,
      color: 'text-blue-400',
      label: 'Grid Size',
      value: stats.totalPoles,
      sub: `${mapData?.transformers?.length || 0} transformers`,
    },
  ];

  return (
    <div className="flex-shrink-0 px-6 py-3 border-b border-slate-800/80 bg-slate-900/40 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="flex items-center gap-3 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 min-w-0">
          <t.icon className={`w-5 h-5 flex-shrink-0 ${t.color}`} />
          <div className="min-w-0">
            <div className={`text-lg font-bold leading-none ${isLoading ? 'text-slate-600 animate-pulse' : 'text-white'}`}>
              {isLoading ? '—' : t.value}
            </div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide truncate">{t.label}</div>
            <div className="text-[10px] text-slate-600 truncate mt-0.5">{t.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
