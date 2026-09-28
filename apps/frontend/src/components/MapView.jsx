import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polyline, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { divIcon, latLngBounds } from 'leaflet';
import { ChevronDown, ChevronUp, Layers, X } from 'lucide-react';
import { resolveActiveOutagePoles } from '../utils/scheduledOutageOverlay';
import { CONDITION_COLORS, CONDITION_LABELS, locateFault, poleCondition } from '../utils/networkModel';

const HT_COLOR = '#3b82f6';
const LT_LIVE_COLOR = '#64748b';
const POLES_MIN_ZOOM = 15;

const LEGEND_CONDITIONS = ['live', 'pending', 'dark', 'maintenance', 'unknown', 'unmonitored'];
const LEGEND_STORAGE_KEY = 'kspdb.mapLegendOpen';

function loadLegendOpen() {
  try {
    return localStorage.getItem(LEGEND_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function ZoomWatcher({ onZoom }) {
  useMapEvents({ zoomend: (e) => onZoom(e.target.getZoom()) });
  return null;
}

function ClearOnMapClick({ onClear }) {
  useMapEvents({ click: onClear });
  return null;
}

/**
 * Fits the whole network once, then flies to each new target (by key; data
 * refreshes don't re-trigger it). Leaflet computes views from the container's
 * size, which is 0 while the map tab is hidden on small screens, so every move
 * waits until the container actually has a size.
 */
function ViewController({ fitPoints, target }) {
  const map = useMap();
  const fitRef = useRef(fitPoints);
  fitRef.current = fitPoints;
  const view = useRef({ fitted: false, lastKey: null, pending: null });

  const apply = useCallback(() => {
    map.invalidateSize({ pan: false });
    const size = map.getSize();
    if (size.x === 0 || size.y === 0) return;
    const v = view.current;
    if (v.pending) {
      const { points, maxZoom } = v.pending;
      v.pending = null;
      v.fitted = true;
      if (points.length === 1) map.flyTo(points[0], Math.max(map.getZoom(), maxZoom), { duration: 0.8 });
      else map.flyToBounds(latLngBounds(points), { padding: [48, 48], maxZoom, duration: 0.8 });
    } else if (!v.fitted && fitRef.current.length > 0) {
      v.fitted = true;
      map.fitBounds(latLngBounds(fitRef.current), { padding: [24, 24] });
    }
  }, [map]);

  useEffect(() => {
    const observer = new ResizeObserver(apply);
    observer.observe(map.getContainer());
    apply();
    return () => observer.disconnect();
  }, [map, apply]);

  useEffect(() => {
    if (!target?.points?.length || target.key === view.current.lastKey) return;
    view.current.lastKey = target.key;
    view.current.pending = target;
    apply();
  }, [target, apply]);

  useEffect(() => { apply(); }, [fitPoints.length, apply]);
  return null;
}

const stop = (handler) => (e) => {
  e.originalEvent?.stopPropagation();
  handler(e);
};

function squareIcon({ size, fill, border, label = '', ring = false }) {
  return divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;background:${fill};border:2px solid ${border};border-radius:2px;display:flex;align-items:center;justify-content:center;font:600 9px Inter,sans-serif;color:#0b1120;${ring ? 'box-shadow:0 0 0 3px rgba(255,255,255,.85);' : ''}">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function faultIcon(selected) {
  const size = selected ? 30 : 22;
  return divIcon({
    className: '',
    html: `<div class="fault-pin${selected ? ' fault-pin--selected' : ''}" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 24 24" width="${size * 0.55}" height="${size * 0.55}" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M13 3 6 13h5l-1 8 7-10h-5l1-8z" fill="#fff" stroke="none"/></svg>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function MapView({ mapData, index, incidents = [], outages = [], isLoading, selection, onSelect }) {
  const [zoom, setZoom] = useState(13);
  const [layersOpen, setLayersOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(loadLegendOpen);
  const toggleLegend = () => {
    const next = !legendOpen;
    setLegendOpen(next);
    try {
      localStorage.setItem(LEGEND_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Storage unavailable: the choice just won't persist.
    }
  };
  const [layers, setLayers] = useState({ ht: true, lt: true, poles: true, inferredDashed: true });
  const toggleLayer = (key) => setLayers((l) => ({ ...l, [key]: !l[key] }));

  const outagePoleMap = useMemo(
    () => resolveActiveOutagePoles(outages, mapData.poles, mapData.topology_edges),
    [outages, mapData.poles, mapData.topology_edges]
  );

  const conditionById = useMemo(() => {
    const m = new Map();
    for (const p of mapData.poles) m.set(p.id, poleCondition(p, outagePoleMap));
    return m;
  }, [mapData.poles, outagePoleMap]);

  const incidentByPole = useMemo(() => {
    const m = new Map();
    for (const inc of incidents) for (const id of inc.affected_pole_ids || []) m.set(id, inc);
    return m;
  }, [incidents]);

  const faults = useMemo(
    () => incidents.map((inc) => ({ incident: inc, loc: locateFault(inc, index) })).filter((f) => f.loc),
    [incidents, index]
  );

  const outFeeders = useMemo(
    () => new Set(faults.filter((f) => f.incident.type === 'FEEDER').map((f) => index.poleById.get(f.incident.affected_pole_ids[0])?.feeder_id)),
    [faults, index]
  );

  const edges = useMemo(() => mapData.topology_edges
    .map((e) => {
      const parent = index.poleById.get(e.parent_pole_id);
      const child = index.poleById.get(e.child_pole_id);
      if (!parent || !child) return null;
      return { id: e.id, childId: child.id, inferred: e.source === 'INFERRED', positions: [[parent.lat, parent.lon], [child.lat, child.lon]] };
    })
    .filter(Boolean), [mapData.topology_edges, index]);

  const dtCondition = useMemo(() => {
    const m = new Map();
    for (const dt of mapData.transformers) {
      const conds = (index.polesByDt.get(dt.id) || []).map((p) => conditionById.get(p.id));
      m.set(dt.id,
        conds.includes('dark') ? 'dark'
          : conds.includes('pending') ? 'pending'
            : conds.includes('maintenance') ? 'maintenance'
              : 'live');
    }
    return m;
  }, [mapData.transformers, index, conditionById]);

  const substation = mapData.feeders.find((f) => f.route?.length)?.route[0];

  const selectedIncident = selection?.kind === 'incident' ? incidents.find((i) => i.id === selection.id) : null;
  const selectedFault = selectedIncident ? faults.find((f) => f.incident.id === selectedIncident.id) : null;

  const fly = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'incident' && selectedFault) {
      return { points: selectedFault.loc.boundsPoints, maxZoom: selectedFault.loc.kind === 'SPAN' ? 18 : 17 };
    }
    if (selection.kind === 'pole') {
      const p = index.poleById.get(selection.id);
      return p ? { points: [[p.lat, p.lon]], maxZoom: 17 } : null;
    }
    if (selection.kind === 'dt') {
      const pts = (index.polesByDt.get(selection.id) || []).map((p) => [p.lat, p.lon]);
      return pts.length ? { points: pts, maxZoom: 17 } : null;
    }
    if (selection.kind === 'feeder') {
      const f = index.feederById.get(selection.id);
      return f?.route ? { points: f.route, maxZoom: 15 } : null;
    }
    return null;
    // Recompute only for a new selection (or an explicit Locate), not for every state poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.kind, selection?.id, selection?.nonce, Boolean(selectedFault)]);

  const allRoutePoints = useMemo(() => mapData.feeders.flatMap((f) => f.route || []), [mapData.feeders]);

  if (isLoading && mapData.poles.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 rounded-lg border border-slate-800">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mb-3"></div>
        <p className="text-slate-400 text-sm">Loading network topology...</p>
      </div>
    );
  }

  const showAllPoles = layers.poles && zoom >= POLES_MIN_ZOOM;
  const poleRadius = zoom >= 17 ? 5 : zoom >= 16 ? 4 : zoom >= 15 ? 3 : 2.5;
  const selectedPole = selection?.kind === 'pole' ? index.poleById.get(selection.id) : null;

  return (
    <div className="w-full h-full rounded-lg overflow-hidden border border-slate-800 relative">
      <MapContainer center={substation || [12.9716, 77.5946]} zoom={13} className="w-full h-full bg-slate-950" preferCanvas zoomControl={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, FAO, NOAA, USGS'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          maxNativeZoom={16}
          maxZoom={19}
        />
        <ZoomWatcher onZoom={setZoom} />
        <ClearOnMapClick onClear={() => onSelect(null)} />
        <ViewController
          fitPoints={allRoutePoints}
          target={fly ? { key: `${selection.kind}:${selection.id}:${selection.nonce ?? ''}`, points: fly.points, maxZoom: fly.maxZoom } : null}
        />

        {/* LT lines, coloured by whether the pole they feed has supply */}
        {layers.lt && edges.map((e) => {
          const cond = conditionById.get(e.childId);
          const color = cond === 'dark' ? CONDITION_COLORS.dark
            : cond === 'pending' ? CONDITION_COLORS.pending
              : cond === 'maintenance' ? CONDITION_COLORS.maintenance
                : LT_LIVE_COLOR;
          return (
            <Polyline
              key={e.id}
              positions={e.positions}
              interactive={false}
              pathOptions={{
                color,
                weight: color === LT_LIVE_COLOR ? 1.2 : 2,
                opacity: color === LT_LIVE_COLOR ? 0.7 : 0.95,
                dashArray: layers.inferredDashed && e.inferred ? '3 4' : undefined,
              }}
            />
          );
        })}

        {/* 11 kV feeder trunks */}
        {layers.ht && mapData.feeders.map((f) => {
          if (!f.route?.length) return null;
          const selected = selection?.kind === 'feeder' && selection.id === f.id;
          const out = outFeeders.has(f.id);
          return (
            <React.Fragment key={f.id}>
              <Polyline positions={f.route} interactive={false} pathOptions={{ color: '#020617', weight: selected ? 10 : 8, opacity: 0.85 }} />
              <Polyline
                positions={f.route}
                interactive={false}
                pathOptions={{
                  color: out ? CONDITION_COLORS.dark : selected ? '#93c5fd' : HT_COLOR,
                  weight: selected ? 6 : 4,
                  opacity: 1,
                }}
              />
              {/* Transparent hit line: canvas hit-testing only covers half the stroke width */}
              <Polyline
                positions={f.route}
                pathOptions={{ color: '#000', weight: 18, opacity: 0, bubblingMouseEvents: false }}
                eventHandlers={{ click: stop(() => onSelect({ kind: 'feeder', id: f.id })) }}
              >
                <Tooltip sticky>{f.name || f.id}</Tooltip>
              </Polyline>
            </React.Fragment>
          );
        })}

        {/* Poles: all of them once zoomed in; only the ones without supply further out */}
        {layers.poles && mapData.poles.map((p) => {
          const cond = conditionById.get(p.id);
          const notable = cond === 'dark' || cond === 'pending' || cond === 'maintenance' || cond === 'suspect';
          if (!showAllPoles && !notable) return null;
          const inIncident = incidentByPole.has(p.id);
          const hollow = cond === 'unmonitored';
          const color = hollow && inIncident ? CONDITION_COLORS.dark : CONDITION_COLORS[cond];
          return (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lon]}
              radius={showAllPoles ? poleRadius : 2}
              pathOptions={{
                color,
                weight: hollow ? 1.5 : 1,
                fillColor: color,
                fillOpacity: hollow ? 0 : 0.95,
                opacity: 1,
                bubblingMouseEvents: false,
              }}
              eventHandlers={{ click: stop(() => onSelect({ kind: 'pole', id: p.id })) }}
            />
          );
        })}

        {selectedPole && (
          <CircleMarker center={[selectedPole.lat, selectedPole.lon]} radius={poleRadius + 5} interactive={false} pathOptions={{ color: '#f8fafc', weight: 2, fill: false }} />
        )}

        {/* Transformers */}
        {mapData.transformers.map((dt) => {
          const cond = dtCondition.get(dt.id);
          const selected = selection?.kind === 'dt' && selection.id === dt.id;
          return (
            <Marker
              key={dt.id}
              position={[dt.lat, dt.lon]}
              zIndexOffset={500}
              icon={squareIcon({
                size: selected ? 16 : 12,
                fill: cond === 'live' ? '#1e293b' : CONDITION_COLORS[cond],
                border: cond === 'live' ? HT_COLOR : '#f8fafc',
                ring: selected,
              })}
              eventHandlers={{ click: stop(() => onSelect({ kind: 'dt', id: dt.id })) }}
            >
              <Tooltip direction="top" offset={[0, -8]}>{dt.id}</Tooltip>
            </Marker>
          );
        })}

        {substation && (
          <Marker position={substation} zIndexOffset={600} icon={squareIcon({ size: 20, fill: '#e2e8f0', border: HT_COLOR, label: 'SS' })}>
            <Tooltip direction="top" offset={[0, -10]}>{mapData.feeders[0]?.substation || 'Substation'}</Tooltip>
          </Marker>
        )}

        {/* Faulted span or search corridor for the selected incident */}
        {selectedFault?.loc.kind !== 'FEEDER' && selectedFault?.loc.paths.map((path, i) => (
          <Polyline key={i} positions={path} interactive={false} pathOptions={{ color: '#fecaca', weight: 5, opacity: 0.95, dashArray: selectedFault.loc.kind === 'RANGE' ? '6 6' : undefined }} />
        ))}

        {faults.map(({ incident, loc }) => {
          const selected = selectedIncident?.id === incident.id;
          return (
            <Marker
              key={incident.id}
              position={loc.pin}
              zIndexOffset={selected ? 1000 : 800}
              icon={faultIcon(selected)}
              eventHandlers={{ click: stop(() => onSelect({ kind: 'incident', id: incident.id })) }}
            >
              <Tooltip direction="top" offset={[0, -14]}>{`${incident.type} fault: ${loc.title}`}</Tooltip>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Layer control */}
      <div className="absolute top-3 right-3 z-[1000]">
        {layersOpen ? (
          <div className="w-56 bg-slate-900/95 border border-slate-700 rounded-md shadow-xl text-sm">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
              <span className="font-medium text-slate-200">Map layers</span>
              <button onClick={() => setLayersOpen(false)} className="text-slate-500 hover:text-slate-200" aria-label="Close layers">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 space-y-2 text-slate-300">
              {[
                ['ht', '11 kV feeders'],
                ['lt', 'LT lines'],
                ['poles', 'Poles'],
                ['inferredDashed', 'Dash inferred wiring'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center justify-between cursor-pointer">
                  <span>{label}</span>
                  <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} className="accent-blue-500" />
                </label>
              ))}
              <p className="text-[11px] text-slate-500 pt-1">Healthy poles appear from zoom {POLES_MIN_ZOOM}. Poles without supply always show.</p>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setLayersOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-slate-900/95 border border-slate-700 rounded-md text-sm text-slate-200 hover:bg-slate-800 shadow-lg"
          >
            <Layers className="w-4 h-4" /> Layers
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="absolute bottom-6 left-3 z-[1000] bg-slate-900/95 border border-slate-700 rounded-md shadow-lg text-[11px] text-slate-300">
        <button
          onClick={toggleLegend}
          aria-expanded={legendOpen}
          className="w-full flex items-center justify-between gap-4 px-3 py-1.5 text-slate-400 hover:text-slate-200"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider">Legend</span>
          {legendOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
        {legendOpen && (
          <div className="px-3 pt-1.5 pb-2 space-y-1 border-t border-slate-800">
            {LEGEND_CONDITIONS.map((c) => (
              <div key={c} className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={c === 'unmonitored' ? { border: `1.5px solid ${CONDITION_COLORS[c]}` } : { background: CONDITION_COLORS[c] }}
                />
                {CONDITION_LABELS[c]}
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1 border-t border-slate-800">
              <span className="inline-block w-4 h-1 rounded-sm" style={{ background: HT_COLOR }} /> 11 kV feeder
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 border-t border-dashed border-slate-400" /> Inferred LT wiring
            </div>
            <div className="flex items-center gap-2">
              <span className="fault-pin inline-flex" style={{ width: 14, height: 14 }} /> Fault location
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
