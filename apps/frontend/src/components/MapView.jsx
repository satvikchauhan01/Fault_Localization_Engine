import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap, Polygon, Polyline, Marker } from 'react-leaflet';
import { divIcon } from 'leaflet';
import { Layers, Zap, Hexagon, Network, EyeOff, Wrench } from 'lucide-react';
import { resolveActiveOutagePoles } from '../utils/scheduledOutageOverlay';

// Helper component to center map on selected incident or active feeder
function MapCenterer({ selectedIncidentId, activeFeederId, incidents, poles }) {
  const map = useMap();
  const prevIncidentIdRef = useRef();
  const prevFeederIdRef = useRef();

  useEffect(() => {
    // Fly to incident if selected
    if (selectedIncidentId && selectedIncidentId !== prevIncidentIdRef.current) {
      const incident = incidents?.find(i => i.id === selectedIncidentId);
      if (incident && incident.affected_pole_ids && incident.affected_pole_ids.length > 0) {
        const affected = poles.filter(p => incident.affected_pole_ids.includes(p.id));
        if (affected.length > 0) {
          const lats = affected.map(p => p.lat);
          const lons = affected.map(p => p.lon);
          const bounds = [
            [Math.min(...lats), Math.min(...lons)],
            [Math.max(...lats), Math.max(...lons)]
          ];
          map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 17, duration: 1 });
        }
      }
    } 
    // Otherwise fly to feeder if selected
    else if (activeFeederId && activeFeederId !== prevFeederIdRef.current) {
      const affected = poles.filter(p => p.feeder_id === activeFeederId);
      if (affected.length > 0) {
        const lats = affected.map(p => p.lat);
        const lons = affected.map(p => p.lon);
        const bounds = [
          [Math.min(...lats), Math.min(...lons)],
          [Math.max(...lats), Math.max(...lons)]
        ];
        map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 16, duration: 1 });
      }
    }

    prevIncidentIdRef.current = selectedIncidentId;
    prevFeederIdRef.current = activeFeederId;
  }, [selectedIncidentId, activeFeederId, incidents, poles, map]);

  return null;
}

export default function MapView({ incidents = [], mapData, outages = [], isLoading, selectedIncidentId, onSelectIncident }) {
  // UI toggles
  const [showPoles, setShowPoles] = useState(true);
  const [showAuthEdges, setShowAuthEdges] = useState(true);
  const [showInferredEdges, setShowInferredEdges] = useState(true);
  const [showDTs, setShowDTs] = useState(true);
  const [activeFeederId, setActiveFeederId] = useState(null);

  // Pre-compute map for fast edge lookup
  const poleMap = useMemo(() => {
    const m = new Map();
    mapData.poles.forEach(p => m.set(p.id, p));
    return m;
  }, [mapData.poles]);

  // Compute edges with coordinates
  const mappedEdges = useMemo(() => {
    if (!mapData.topology_edges || poleMap.size === 0) return [];
    
    return mapData.topology_edges.map(edge => {
      const parent = poleMap.get(edge.parent_pole_id);
      const child = poleMap.get(edge.child_pole_id);
      if (!parent || !child) return null;
      
      return {
        id: edge.id,
        positions: [[parent.lat, parent.lon], [child.lat, child.lon]],
        source: edge.source,
        feederId: parent.feeder_id
      };
    }).filter(Boolean);
  }, [mapData.topology_edges, poleMap]);

  // Count edges for stats
  const authCount = mappedEdges.filter(e => e.source === 'AUTHORITATIVE').length;
  const inferredCount = mappedEdges.filter(e => e.source === 'INFERRED').length;

  // Custom icon for Transformers (DTs)
  const dtIcon = useMemo(() => {
    return divIcon({
      className: 'bg-transparent border-0',
      html: `<div style="width: 14px; height: 14px; background-color: #3b82f6; border: 2px solid #ffffff; box-shadow: 0 0 8px #3b82f6; transform: rotate(45deg);"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
  }, []);

  const highlightedDtIcon = useMemo(() => {
    return divIcon({
      className: 'bg-transparent border-0',
      html: `<div style="width: 18px; height: 18px; background-color: #f59e0b; border: 2px solid #ffffff; box-shadow: 0 0 12px #f59e0b; transform: rotate(45deg); z-index: 1000;"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }, []);

  // Compute incident overlay hulls
  const incidentOverlays = useMemo(() => {
    if (!incidents.length || !mapData.poles.length) return [];
    
    return incidents.map(incident => {
      const affected = mapData.poles.filter(p => incident.affected_pole_ids?.includes(p.id));
      if (affected.length === 0) return null;

      const positions = affected.map(p => [p.lat, p.lon]);
      
      return {
        id: incident.id,
        type: incident.type,
        positions,
        isSelected: selectedIncidentId === incident.id
      };
    }).filter(Boolean);
  }, [incidents, mapData.poles, selectedIncidentId]);

  // Poles currently inside an active scheduled-outage window — presentation
  // only, derived client-side; does not touch incidents/tickets/telemetry.
  const outagePoleMap = useMemo(
    () => resolveActiveOutagePoles(outages, mapData.poles, mapData.topology_edges),
    [outages, mapData.poles, mapData.topology_edges]
  );

  // One boundary hull per active outage, so the whole planned-maintenance
  // section reads as a shape even before zooming in on individual poles.
  const maintenanceOverlays = useMemo(() => {
    if (outagePoleMap.size === 0 || !mapData.poles.length) return [];

    const byOutage = new Map();
    for (const [poleId, outage] of outagePoleMap) {
      if (!byOutage.has(outage.id)) byOutage.set(outage.id, { outage, poleIds: [] });
      byOutage.get(outage.id).poleIds.push(poleId);
    }

    return [...byOutage.values()].map(({ outage, poleIds }) => {
      const affected = mapData.poles.filter(p => poleIds.includes(p.id));
      if (affected.length === 0) return null;
      return {
        id: outage.id,
        reason: outage.reason,
        positions: affected.map(p => [p.lat, p.lon]),
      };
    }).filter(Boolean);
  }, [outagePoleMap, mapData.poles]);

  if (isLoading && mapData.poles.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 rounded-xl border border-slate-800">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
        <p className="text-slate-400 font-medium">Loading network topology...</p>
      </div>
    );
  }

  const center = mapData.transformers.length > 0 
    ? [mapData.transformers[0].lat, mapData.transformers[0].lon] 
    : [0, 0];

  return (
    <div className="w-full h-full rounded-xl overflow-hidden border border-slate-800 relative z-0 shadow-2xl">
      <MapContainer 
        center={center} 
        zoom={14} 
        className="w-full h-full bg-slate-900"
        preferCanvas={true} 
      >
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          maxNativeZoom={16}
          className="map-tiles"
        />

        <MapCenterer 
          selectedIncidentId={selectedIncidentId} 
          activeFeederId={activeFeederId}
          incidents={incidents} 
          poles={mapData.poles} 
        />

        {/* 1. Render INFERRED Edges (60% unverified) */}
        {showInferredEdges && mappedEdges.filter(e => e.source === 'INFERRED').map(edge => (
          <Polyline
            key={edge.id}
            positions={edge.positions}
            pathOptions={{
              color: activeFeederId && edge.feederId !== activeFeederId ? '#334155' : '#64748b',
              weight: activeFeederId && edge.feederId === activeFeederId ? 3 : 1.5,
              dashArray: '4, 6',
              opacity: activeFeederId && edge.feederId !== activeFeederId ? 0.2 : 0.6
            }}
          />
        ))}

        {/* 2. Render AUTHORITATIVE Edges (40% known ground truth) */}
        {showAuthEdges && mappedEdges.filter(e => e.source === 'AUTHORITATIVE').map(edge => (
          <Polyline
            key={edge.id}
            positions={edge.positions}
            pathOptions={{
              color: activeFeederId && edge.feederId !== activeFeederId ? '#1e3a8a' : '#3b82f6',
              weight: activeFeederId && edge.feederId === activeFeederId ? 4 : 2,
              opacity: activeFeederId && edge.feederId !== activeFeederId ? 0.3 : 0.9
            }}
          />
        ))}

        {/* 3. Render Poles */}
        {showPoles && mapData.poles.map(pole => {
          let color = '#10b981'; // LIVE (Green)
          let radius = 3;
          let weight = 0;
          let opacity = 0.6;

          const isUnderMaintenance = outagePoleMap.has(pole.id);

          // Dim out if a feeder is selected and this pole doesn't belong to it
          if (activeFeederId && pole.feeder_id !== activeFeederId) {
            color = '#334155';
            opacity = 0.2;
          } else {
            if (pole.state?.status === 'CONFIRMED_DARK') {
              color = '#ef4444'; // Red — a real fault always wins over "planned"
              radius = 5;
              weight = 2;
              opacity = 1;
            } else if (pole.state?.status === 'CANDIDATE_DARK') {
              color = '#f59e0b'; // Orange
              opacity = 0.8;
            } else if (isUnderMaintenance) {
              color = '#a78bfa'; // Violet — planned outage, not a fault
              radius = 4;
              opacity = 0.9;
            }
          }

          const isSelected = selectedIncidentId && incidents.find(i => i.id === selectedIncidentId)?.affected_pole_ids?.includes(pole.id);
          if (isSelected) {
            radius = 6;
            weight = 3;
            color = '#3b82f6'; 
            opacity = 1;
          }

          return (
            <CircleMarker
              key={pole.id}
              center={[pole.lat, pole.lon]}
              radius={radius}
              eventHandlers={{
                click: () => {
                  const incident = incidents.find(i => i.affected_pole_ids?.includes(pole.id));
                  if (incident) onSelectIncident(incident.id);
                }
              }}
              pathOptions={{
                color: color,
                fillColor: color,
                fillOpacity: opacity,
                weight: weight,
                opacity: opacity
              }}
            />
          );
        })}

        {/* 4. Render Transformers (DTs) */}
        {showDTs && mapData.transformers.map(dt => {
          const isHighlighted = activeFeederId === dt.feeder_id;
          const isDimmed = activeFeederId && !isHighlighted;
          
          if (isDimmed) return null; // Hide non-relevant DTs to reduce clutter

          return (
            <Marker
              key={dt.id}
              position={[dt.lat, dt.lon]}
              icon={isHighlighted ? highlightedDtIcon : dtIcon}
            />
          );
        })}

        {/* 5. Render Incident Overlays */}
        {incidentOverlays.map(overlay => (
          <Polygon
            key={`overlay-${overlay.id}`}
            positions={overlay.positions}
            pathOptions={{
              color: overlay.isSelected ? '#3b82f6' : '#ef4444',
              fillColor: overlay.isSelected ? '#3b82f6' : '#ef4444',
              fillOpacity: overlay.isSelected ? 0.3 : 0.1,
              weight: overlay.isSelected ? 3 : 1,
              dashArray: overlay.isSelected ? undefined : '5, 5'
            }}
            eventHandlers={{
              click: () => onSelectIncident(overlay.id)
            }}
          />
        ))}

        {/* 6. Render Scheduled Maintenance boundaries — planned, not a fault */}
        {maintenanceOverlays.map(overlay => (
          <Polygon
            key={`maintenance-${overlay.id}`}
            positions={overlay.positions}
            pathOptions={{
              color: '#a78bfa',
              fillColor: '#a78bfa',
              fillOpacity: 0.12,
              weight: 2,
              dashArray: '3, 7'
            }}
          />
        ))}
      </MapContainer>

      {/* Floating Interactive Control Panel */}
      <div className="absolute top-4 left-4 z-[1000] w-72 max-w-[calc(100%-2rem)] glass-panel rounded-xl shadow-2xl flex flex-col max-h-[calc(100%-2rem)] overflow-hidden">
        
        {/* Header / Stats */}
        <div className="p-4 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-md">
          <div className="flex items-center gap-2 mb-2 text-slate-200">
            <Layers className="w-5 h-5 text-blue-400" />
            <h3 className="font-semibold">Network Topology</h3>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-800/60 p-2 rounded border border-slate-700/50">
              <div className="text-slate-400">Total Poles</div>
              <div className="font-mono text-slate-200">{mapData.poles.length}</div>
            </div>
            <div className="bg-slate-800/60 p-2 rounded border border-slate-700/50">
              <div className="text-slate-400">Transformers</div>
              <div className="font-mono text-slate-200">{mapData.transformers.length}</div>
            </div>
            <div className="bg-blue-900/20 p-2 rounded border border-blue-500/30">
              <div className="text-blue-300">Known Edges</div>
              <div className="font-mono text-blue-400">{authCount} <span className="text-[10px] opacity-70">({Math.round(authCount/(authCount+inferredCount)*100)}%)</span></div>
            </div>
            <div className="bg-slate-800/60 p-2 rounded border border-slate-600/50">
              <div className="text-slate-400">Inferred Edges</div>
              <div className="font-mono text-slate-300">{inferredCount} <span className="text-[10px] opacity-70">({Math.round(inferredCount/(authCount+inferredCount)*100)}%)</span></div>
            </div>
          </div>
        </div>

        {/* Active Scheduled Maintenance — planned, informational only (no ticket/incident) */}
        {maintenanceOverlays.length > 0 && (
          <div className="p-3 bg-violet-500/10 border-b border-violet-500/20 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-violet-300">
              <Wrench className="w-3.5 h-3.5" />
              {maintenanceOverlays.length} Active Maintenance {maintenanceOverlays.length > 1 ? 'Zones' : 'Zone'}
              <span className="ml-auto font-mono text-violet-400">{outagePoleMap.size} poles</span>
            </div>
            {maintenanceOverlays.slice(0, 3).map(o => (
              <div key={o.id} className="text-[11px] text-violet-200/70 truncate pl-5">{o.reason}</div>
            ))}
          </div>
        )}

        {/* View Toggles */}
        <div className="p-3 bg-slate-900/60 border-b border-slate-700/50 space-y-2 text-sm text-slate-300">
          <label className="flex items-center justify-between cursor-pointer hover:text-white">
            <span className="flex items-center gap-2"><Hexagon className="w-4 h-4 text-blue-400"/> Transformers (DTs)</span>
            <input type="checkbox" checked={showDTs} onChange={e => setShowDTs(e.target.checked)} className="accent-blue-500" />
          </label>
          <label className="flex items-center justify-between cursor-pointer hover:text-white">
            <span className="flex items-center gap-2"><Network className="w-4 h-4 text-emerald-400"/> Monitoring Nodes</span>
            <input type="checkbox" checked={showPoles} onChange={e => setShowPoles(e.target.checked)} className="accent-blue-500" />
          </label>
          <label className="flex items-center justify-between cursor-pointer hover:text-white">
            <span className="flex items-center gap-2"><div className="w-4 h-0.5 bg-blue-500 rounded"></div> Known Wiring</span>
            <input type="checkbox" checked={showAuthEdges} onChange={e => setShowAuthEdges(e.target.checked)} className="accent-blue-500" />
          </label>
          <label className="flex items-center justify-between cursor-pointer hover:text-white">
            <span className="flex items-center gap-2"><div className="w-4 border-t-2 border-dashed border-slate-500"></div> AI Inferred Wiring</span>
            <input type="checkbox" checked={showInferredEdges} onChange={e => setShowInferredEdges(e.target.checked)} className="accent-blue-500" />
          </label>
        </div>

        {/* Feeder List */}
        <div className="overflow-y-auto custom-scrollbar p-2 space-y-1">
          <div className="px-2 pt-2 pb-1 text-xs font-bold uppercase tracking-wider text-slate-500">
            Radial Feeders ({mapData.feeders.length})
          </div>
          {mapData.feeders.map(feeder => {
            const isActive = activeFeederId === feeder.id;
            return (
              <button
                key={feeder.id}
                onClick={() => setActiveFeederId(isActive ? null : feeder.id)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-all flex items-center justify-between
                  ${isActive 
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                    : 'hover:bg-slate-800 text-slate-400 border border-transparent'
                  }`}
              >
                <span className="font-medium text-sm flex items-center gap-2">
                  <Zap className={`w-4 h-4 ${isActive ? 'text-amber-400' : 'text-slate-600'}`} />
                  {feeder.id}
                </span>
                {isActive && <EyeOff className="w-4 h-4 text-amber-500/70" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
