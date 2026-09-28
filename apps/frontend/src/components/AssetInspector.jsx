import React, { useMemo } from 'react';
import { X, Zap, Box, Radio, AlertTriangle, Wrench, ChevronRight } from 'lucide-react';
import { isLegacyFirmware } from '@kspdb/domain/thresholds';
import { CONDITION_COLORS, CONDITION_LABELS, poleCondition, summarizePoles } from '../utils/networkModel';
import { getIncidentLabel } from '../utils/incidentLabel';

function formatTime(value) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

function StatusDot({ condition }) {
  const hollow = condition === 'unmonitored';
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
      style={hollow ? { border: `1.5px solid ${CONDITION_COLORS[condition]}` } : { background: CONDITION_COLORS[condition] }}
    />
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-slate-800/70 last:border-0 text-sm">
      <dt className="text-slate-500 flex-shrink-0">{label}</dt>
      <dd className="text-slate-200 text-right min-w-0 break-words">{children}</dd>
    </div>
  );
}

function LinkButton({ onClick, children }) {
  return (
    <button onClick={onClick} className="text-blue-400 hover:text-blue-300 hover:underline font-mono">
      {children}
    </button>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">{title}</h3>
      {children}
    </section>
  );
}

function ConditionSummary({ counts }) {
  const cells = [
    ['live', counts.live],
    ['dark', counts.dark],
    ['pending', counts.pending],
    ['maintenance', counts.maintenance],
    ['unknown', counts.unknown + counts.suspect],
    ['unmonitored', counts.unmonitored],
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {cells.map(([cond, n]) => (
        <div key={cond} className="bg-slate-900 border border-slate-800 rounded-md px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <StatusDot condition={cond} />
            {cond === 'pending' ? 'Debouncing' : cond === 'maintenance' ? 'Planned' : CONDITION_LABELS[cond]}
          </div>
          <div className="text-lg font-semibold text-slate-100 mt-0.5">{n}</div>
        </div>
      ))}
    </div>
  );
}

function IncidentLinks({ incidents, onSelect, poleId }) {
  if (incidents.length === 0) {
    return <p className="text-sm text-slate-500">No active incidents.</p>;
  }
  return (
    <div className="space-y-1.5">
      {incidents.map((inc) => (
        <button
          key={inc.id}
          onClick={() => onSelect({ kind: 'incident', id: inc.id })}
          className="w-full flex items-center gap-3 px-3 py-2 bg-red-950/40 border border-red-900/60 rounded-md hover:bg-red-950/70 text-left"
        >
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-slate-100 truncate">{inc.type} fault: {getIncidentLabel(inc)}</div>
            <div className="text-[11px] text-slate-400">
              {poleId && inc.upstream_live_pole_id === poleId ? 'Live end of the faulted section' : `${inc.affected_count} poles`}, {inc.ticket?.state}
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500" />
        </button>
      ))}
    </div>
  );
}

function PoleView({ pole, index, incidents, outagePoleMap, onSelect }) {
  const cond = poleCondition(pole, outagePoleMap);
  const device = index.deviceByPole.get(pole.id);
  const upstreamEdge = index.parentEdgeOf.get(pole.id);
  const outage = outagePoleMap.get(pole.id);
  const state = pole.state;
  const legacy = device && isLegacyFirmware(device.fw_version);

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-slate-800 bg-slate-900">
        <StatusDot condition={cond} />
        <span className="text-sm font-medium text-slate-100">{CONDITION_LABELS[cond]}</span>
      </div>

      {cond === 'pending' && (
        <p className="text-xs text-amber-300/90 leading-relaxed">
          Power loss reported at {formatTime(state.candidate_dark_since)}. It is confirmed dark after the 90 s debounce.
        </p>
      )}

      <Section title="Network">
        <dl>
          <Row label="Feeder"><LinkButton onClick={() => onSelect({ kind: 'feeder', id: pole.feeder_id })}>{pole.feeder_id}</LinkButton></Row>
          <Row label="Transformer"><LinkButton onClick={() => onSelect({ kind: 'dt', id: pole.dt_id })}>{pole.dt_id}</LinkButton></Row>
          <Row label="Fed from">
            {upstreamEdge ? (
              <span className="inline-flex flex-col items-end">
                <LinkButton onClick={() => onSelect({ kind: 'pole', id: upstreamEdge.parent_pole_id })}>{upstreamEdge.parent_pole_id}</LinkButton>
                <span className="text-[11px] text-slate-500">
                  {upstreamEdge.source === 'INFERRED' ? 'Inferred wiring' : 'Recorded wiring'}
                  {upstreamEdge.ambiguous ? ', ambiguous' : ''}
                </span>
              </span>
            ) : (
              <span className="text-slate-400">Transformer (first pole)</span>
            )}
          </Row>
        </dl>
      </Section>

      <Section title="Sensor">
        <dl>
          <Row label="Device">{device ? <span className="font-mono">{device.id}</span> : <span className="text-slate-400">None fitted</span>}</Row>
          {device && (
            <Row label="Firmware">
              <span className="inline-flex flex-col items-end">
                <span className="font-mono">{device.fw_version}</span>
                {legacy && <span className="text-[11px] text-amber-300/90">Legacy: no power-loss alarm</span>}
              </span>
            </Row>
          )}
          {state && <Row label="Last confirmed">{formatTime(state.last_confirmed_at)}</Row>}
          {state && <Row label="Evidence">{state.evidence_summary}</Row>}
        </dl>
      </Section>

      <Section title="Location">
        <dl>
          <Row label="Coordinates"><span className="font-mono text-xs">{pole.lat.toFixed(6)}, {pole.lon.toFixed(6)}</span></Row>
          <Row label="Ward">{pole.ward || 'N/A'}</Row>
          <Row label="PIN code">{pole.pincode || 'N/A'}</Row>
        </dl>
      </Section>

      {outage && (
        <Section title="Planned maintenance">
          <div className="flex gap-2 text-sm text-violet-200 bg-violet-950/40 border border-violet-900/60 rounded-md px-3 py-2">
            <Wrench className="w-4 h-4 flex-shrink-0 mt-0.5 text-violet-300" />
            <div>
              <div>{outage.reason}</div>
              <div className="text-[11px] text-violet-300/70 mt-0.5">Until {formatTime(outage.end)}</div>
            </div>
          </div>
        </Section>
      )}

      <Section title="Incidents">
        <IncidentLinks incidents={incidents} onSelect={onSelect} poleId={pole.id} />
      </Section>
    </>
  );
}

function DtView({ dt, index, incidents, outagePoleMap, onSelect }) {
  const counts = useMemo(
    () => summarizePoles(index.polesByDt.get(dt.id) || [], outagePoleMap),
    [index, dt.id, outagePoleMap]
  );

  return (
    <>
      <ConditionSummary counts={counts} />
      <Section title="Transformer">
        <dl>
          <Row label="Feeder"><LinkButton onClick={() => onSelect({ kind: 'feeder', id: dt.feeder_id })}>{dt.feeder_id}</LinkButton></Row>
          <Row label="Capacity">{dt.capacity_kva} kVA</Row>
          <Row label="Households served">{dt.households_served}</Row>
          <Row label="Poles">{counts.total} ({counts.monitored} monitored)</Row>
          <Row label="Wiring on file">
            {dt.topology_source === 'RECORDED' ? 'Recorded' : <span className="text-amber-300/90">Missing, inferred from GPS</span>}
          </Row>
          <Row label="Coordinates"><span className="font-mono text-xs">{dt.lat.toFixed(6)}, {dt.lon.toFixed(6)}</span></Row>
        </dl>
      </Section>
      <Section title="Incidents">
        <IncidentLinks incidents={incidents} onSelect={onSelect} />
      </Section>
    </>
  );
}

function FeederView({ feeder, index, incidents, outagePoleMap, onSelect }) {
  const counts = useMemo(
    () => summarizePoles(index.polesByFeeder.get(feeder.id) || [], outagePoleMap),
    [index, feeder.id, outagePoleMap]
  );
  const dts = index.dtsByFeeder.get(feeder.id) || [];

  const routeKm = useMemo(() => {
    const r = feeder.route || [];
    let m = 0;
    for (let k = 1; k < r.length; k++) {
      const dLat = (r[k][0] - r[k - 1][0]) * 111000;
      const dLon = (r[k][1] - r[k - 1][1]) * 111000 * Math.cos((r[k][0] * Math.PI) / 180);
      m += Math.hypot(dLat, dLon);
    }
    return (m / 1000).toFixed(1);
  }, [feeder.route]);

  return (
    <>
      <ConditionSummary counts={counts} />
      <Section title="Feeder">
        <dl>
          <Row label="Source">{feeder.substation || 'N/A'}</Row>
          <Row label="Trunk length">{routeKm} km</Row>
          <Row label="Transformers">{dts.length}</Row>
          <Row label="Poles">{counts.total} ({counts.monitored} monitored)</Row>
        </dl>
      </Section>
      <Section title="Transformers on this feeder">
        <div className="space-y-1">
          {dts.map((dt) => {
            const dtCounts = summarizePoles(index.polesByDt.get(dt.id) || [], outagePoleMap);
            const cond = dtCounts.dark > 0 ? 'dark' : dtCounts.pending > 0 ? 'pending' : dtCounts.maintenance > 0 ? 'maintenance' : 'live';
            return (
              <button
                key={dt.id}
                onClick={() => onSelect({ kind: 'dt', id: dt.id })}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md border border-slate-800 bg-slate-900 hover:bg-slate-800 text-left"
              >
                <StatusDot condition={cond} />
                <span className="font-mono text-sm text-slate-200">{dt.id}</span>
                <span className="text-[11px] text-slate-500 ml-auto">
                  {dtCounts.dark > 0 ? `${dtCounts.dark} dark` : `${dtCounts.live} live`}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-600" />
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Incidents">
        <IncidentLinks incidents={incidents} onSelect={onSelect} />
      </Section>
    </>
  );
}

const KIND_META = {
  pole: { label: 'Pole', icon: Radio },
  dt: { label: 'Transformer', icon: Box },
  feeder: { label: '11 kV feeder', icon: Zap },
};

export default function AssetInspector({ selection, index, incidents, outagePoleMap, onSelect, onClose }) {
  const asset =
    selection.kind === 'pole' ? index.poleById.get(selection.id)
      : selection.kind === 'dt' ? index.dtById.get(selection.id)
        : index.feederById.get(selection.id);

  const related = useMemo(() => {
    if (!asset) return [];
    const belongs = (poleId) => {
      const p = index.poleById.get(poleId);
      if (!p) return false;
      if (selection.kind === 'pole') return poleId === asset.id;
      if (selection.kind === 'dt') return p.dt_id === asset.id;
      return p.feeder_id === asset.id;
    };
    // A pole also relates to a fault it bounds: the crew starts from the live upstream end.
    return incidents.filter((inc) =>
      (selection.kind === 'pole' && inc.upstream_live_pole_id === asset.id) ||
      (inc.affected_pole_ids || []).some(belongs));
  }, [asset, incidents, index, selection.kind]);

  const meta = KIND_META[selection.kind];
  const Icon = meta.icon;

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <div className="w-8 h-8 rounded-md bg-slate-800 flex items-center justify-center">
          <Icon className="w-4 h-4 text-slate-300" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">{meta.label}</div>
          <h2 className="font-semibold text-slate-100 font-mono truncate">{asset?.name && selection.kind === 'feeder' ? asset.name : selection.id}</h2>
        </div>
        <button onClick={onClose} className="ml-auto p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-5">
        {!asset && <p className="text-sm text-slate-500">This asset is no longer in the network data.</p>}
        {asset && selection.kind === 'pole' && <PoleView pole={asset} index={index} incidents={related} outagePoleMap={outagePoleMap} onSelect={onSelect} />}
        {asset && selection.kind === 'dt' && <DtView dt={asset} index={index} incidents={related} outagePoleMap={outagePoleMap} onSelect={onSelect} />}
        {asset && selection.kind === 'feeder' && <FeederView feeder={asset} index={index} incidents={related} outagePoleMap={outagePoleMap} onSelect={onSelect} />}
      </div>
    </div>
  );
}
