export const CONDITION_COLORS = {
  live: '#34d399',
  pending: '#f59e0b',
  dark: '#ef4444',
  maintenance: '#a78bfa',
  suspect: '#fb923c',
  unknown: '#64748b',
  unmonitored: '#94a3b8',
};

export const CONDITION_LABELS = {
  live: 'Live',
  pending: 'Losing power (debouncing)',
  dark: 'Dark',
  maintenance: 'Planned maintenance',
  suspect: 'Sensor suspect',
  unknown: 'No recent data',
  unmonitored: 'Unmonitored',
};

/** Lookup tables over one topology snapshot, shared by map, inspector and incident views. */
export function buildNetworkIndex(mapData) {
  const poleById = new Map(mapData.poles.map((p) => [p.id, p]));
  const dtById = new Map(mapData.transformers.map((d) => [d.id, d]));
  const feederById = new Map(mapData.feeders.map((f) => [f.id, f]));
  const deviceByPole = new Map((mapData.devices || []).map((d) => [d.pole_id, d]));

  const parentEdgeOf = new Map();
  const childrenOf = new Map();
  for (const e of mapData.topology_edges) {
    parentEdgeOf.set(e.child_pole_id, e);
    if (!childrenOf.has(e.parent_pole_id)) childrenOf.set(e.parent_pole_id, []);
    childrenOf.get(e.parent_pole_id).push(e.child_pole_id);
  }

  const polesByDt = new Map();
  const polesByFeeder = new Map();
  for (const p of mapData.poles) {
    if (!polesByDt.has(p.dt_id)) polesByDt.set(p.dt_id, []);
    polesByDt.get(p.dt_id).push(p);
    if (!polesByFeeder.has(p.feeder_id)) polesByFeeder.set(p.feeder_id, []);
    polesByFeeder.get(p.feeder_id).push(p);
  }

  const dtsByFeeder = new Map();
  for (const dt of mapData.transformers) {
    if (!dtsByFeeder.has(dt.feeder_id)) dtsByFeeder.set(dt.feeder_id, []);
    dtsByFeeder.get(dt.feeder_id).push(dt);
  }
  // Order each feeder's DTs outward from the substation, the way a lineman walks it.
  for (const [feederId, dts] of dtsByFeeder) {
    const source = feederById.get(feederId)?.route?.[0];
    if (!source) continue;
    const dist = (dt) => (dt.lat - source[0]) ** 2 + (dt.lon - source[1]) ** 2;
    dts.sort((a, b) => dist(a) - dist(b));
  }

  return { poleById, dtById, feederById, deviceByPole, parentEdgeOf, childrenOf, polesByDt, polesByFeeder, dtsByFeeder };
}

/** What the map should show for a pole right now. */
export function poleCondition(pole, outagePoleMap) {
  if (!pole.device_id) return outagePoleMap?.has(pole.id) ? 'maintenance' : 'unmonitored';
  const status = pole.state?.status;
  if (status === 'CONFIRMED_DARK') return 'dark';
  if (status === 'SENSOR_SUSPECT') return 'suspect';
  if (status === 'LIVE') {
    if (pole.state.candidate_dark_since) return 'pending';
    return outagePoleMap?.has(pole.id) ? 'maintenance' : 'live';
  }
  return 'unknown';
}

/** Counts of pole conditions for a set of poles. */
export function summarizePoles(poles, outagePoleMap) {
  const counts = { total: poles.length, monitored: 0, live: 0, pending: 0, dark: 0, maintenance: 0, suspect: 0, unknown: 0, unmonitored: 0 };
  for (const p of poles) {
    if (p.device_id) counts.monitored++;
    counts[poleCondition(p, outagePoleMap)]++;
  }
  return counts;
}

const point = (p) => [p.lat, p.lon];
const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const centroid = (pts) => [
  pts.reduce((s, p) => s + p[0], 0) / pts.length,
  pts.reduce((s, p) => s + p[1], 0) / pts.length,
];

/** Poles from `fromId` up the tree to (and including) `untilId`, or to the root. */
function pathUp(fromId, untilId, index) {
  const path = [];
  const seen = new Set();
  let current = fromId;
  while (current && !seen.has(current)) {
    seen.add(current);
    path.push(current);
    if (current === untilId) break;
    current = index.parentEdgeOf.get(current)?.parent_pole_id;
  }
  return path;
}

/**
 * Where to look for this incident's fault, derived from the boundary the
 * engine localized:
 *   SPAN   the exact span between the last live pole and the first dark pole
 *   RANGE  the unmonitored corridor between those bounds (crew must patrol it)
 *   DT     the transformer itself
 *   FEEDER the source end of the feeder (breaker or HT trunk before its first DT)
 *
 * @returns {{ kind, pin: [number, number], paths: [number, number][][], title: string, detail: string, boundsPoints: [number, number][] } | null}
 */
export function locateFault(incident, index) {
  const affected = (incident.affected_pole_ids || []).map((id) => index.poleById.get(id)).filter(Boolean);
  const boundsPoints = affected.map(point);
  const upstream = incident.upstream_live_pole_id ? index.poleById.get(incident.upstream_live_pole_id) : null;
  const downstream = (incident.downstream_dark_pole_ids || []).map((id) => index.poleById.get(id)).filter(Boolean);

  if (incident.type === 'FEEDER') {
    const feederId = affected[0]?.feeder_id;
    const feeder = index.feederById.get(feederId);
    if (!feeder?.route || feeder.route.length < 2) return null;
    const firstDt = (index.dtsByFeeder.get(feederId) || [])[0];
    return {
      kind: 'FEEDER',
      pin: midpoint(feeder.route[0], feeder.route[1]),
      paths: [feeder.route],
      title: `${feeder.name || feeder.id} out of supply`,
      detail: `Check the feeder breaker at ${feeder.substation || 'the substation'} and the HT trunk up to ${firstDt?.id || 'the first transformer'}.`,
      boundsPoints: [...feeder.route, ...boundsPoints],
    };
  }

  if (incident.type === 'DT') {
    const dt = index.dtById.get(affected[0]?.dt_id);
    if (!dt) return null;
    return {
      kind: 'DT',
      pin: point(dt),
      paths: [],
      title: `Transformer ${dt.id} out of supply`,
      detail: `Every monitored pole downstream of ${dt.id} is dark. Check the transformer and its LT fuses.`,
      boundsPoints: [point(dt), ...boundsPoints],
    };
  }

  if (incident.type === 'SPAN' && upstream && downstream.length > 0) {
    const paths = downstream.map((d) => [point(upstream), point(d)]);
    const single = downstream.length === 1;
    return {
      kind: 'SPAN',
      pin: single ? midpoint(point(upstream), point(downstream[0])) : point(upstream),
      paths,
      title: single ? `Span ${upstream.id} to ${downstream[0].id}` : `Junction at ${upstream.id}`,
      detail: single
        ? `${upstream.id} is live and ${downstream[0].id} is dark: the break is on the span between them.`
        : `${upstream.id} is live but ${downstream.length} branches leaving it are dark.`,
      boundsPoints: [point(upstream), ...boundsPoints],
    };
  }

  if (incident.type === 'RANGE' && downstream.length > 0) {
    const corridorIds = new Set();
    const paths = [];
    for (const d of downstream) {
      const ids = pathUp(d.id, upstream?.id, index);
      ids.forEach((id) => corridorIds.add(id));
      paths.push(ids.map((id) => point(index.poleById.get(id))));
    }
    const gap = [...corridorIds]
      .filter((id) => id !== upstream?.id && !incident.downstream_dark_pole_ids.includes(id))
      .map((id) => index.poleById.get(id));
    const pinFrom = gap.length > 0 ? gap.map(point) : [...corridorIds].map((id) => point(index.poleById.get(id)));
    return {
      kind: 'RANGE',
      pin: centroid(pinFrom),
      paths,
      title: upstream ? `Between ${upstream.id} and ${downstream.map((d) => d.id).join(', ')}` : `Above ${downstream.map((d) => d.id).join(', ')}`,
      detail: `The break is somewhere in ${gap.length} unmonitored pole${gap.length === 1 ? '' : 's'} on this stretch. The crew needs to patrol it.`,
      boundsPoints: [...pinFrom, ...boundsPoints],
    };
  }

  if (boundsPoints.length === 0) return null;
  return {
    kind: incident.type,
    pin: centroid(boundsPoints),
    paths: [],
    title: 'Affected area',
    detail: `${affected.length} poles affected.`,
    boundsPoints,
  };
}
