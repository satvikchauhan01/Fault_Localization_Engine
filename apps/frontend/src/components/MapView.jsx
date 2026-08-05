import React, { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap, Polygon } from 'react-leaflet';

// Helper component to center map on selected incident
function MapCenterer({ selectedIncidentId, incidents, poles }) {
  const map = useMap();
  const prevIncidentIdRef = useRef();

  useEffect(() => {
    if (selectedIncidentId && selectedIncidentId !== prevIncidentIdRef.current) {
      const incident = incidents?.find(i => i.id === selectedIncidentId);
      if (incident && incident.affected_pole_ids && incident.affected_pole_ids.length > 0) {
        // Find all affected poles to calculate bounds
        const affected = poles.filter(p => incident.affected_pole_ids.includes(p.id));
        
        if (affected.length > 0) {
          const lats = affected.map(p => p.lat);
          const lons = affected.map(p => p.lon);
          const bounds = [
            [Math.min(...lats), Math.min(...lons)],
            [Math.max(...lats), Math.max(...lons)]
          ];
          // Pad the bounds slightly so markers aren't exactly on the edge
          map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 17, duration: 1 });
        }
      }
    }
    prevIncidentIdRef.current = selectedIncidentId;
  }, [selectedIncidentId, incidents, poles, map]);

  return null;
}

export default function MapView({ incidents = [], mapData, isLoading, selectedIncidentId, onSelectIncident }) {
  // Compute incident overlay hulls (bounding boxes/polygons)
  const incidentOverlays = useMemo(() => {
    if (!incidents.length || !mapData.poles.length) return [];
    
    return incidents.map(incident => {
      const affected = mapData.poles.filter(p => incident.affected_pole_ids?.includes(p.id));
      if (affected.length === 0) return null;

      // Simplest representation for an overlay is to draw a polygon or bounding box around affected nodes.
      // For a line of poles, drawing a polygon from their coordinates might cross itself, 
      // but Leaflet handles self-intersecting polygons gracefully.
      const positions = affected.map(p => [p.lat, p.lon]);
      
      return {
        id: incident.id,
        type: incident.type,
        positions,
        isSelected: selectedIncidentId === incident.id
      };
    }).filter(Boolean);
  }, [incidents, mapData.poles, selectedIncidentId]);

  if (isLoading && mapData.poles.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 rounded-xl border border-slate-800">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
        <p className="text-slate-400 font-medium">Loading network topology...</p>
      </div>
    );
  }

  // Determine initial center based on the first transformer or a fallback coordinate
  const center = mapData.transformers.length > 0 
    ? [mapData.transformers[0].lat, mapData.transformers[0].lon] 
    : [0, 0];

  return (
    <div className="w-full h-full rounded-xl overflow-hidden border border-slate-800 relative z-0 shadow-2xl">
      <MapContainer 
        center={center} 
        zoom={14} 
        className="w-full h-full bg-slate-900"
        preferCanvas={true} // Essential for performance with ~4000 poles
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="map-tiles"
        />

        {/* Sync Map Center with selected incident */}
        <MapCenterer 
          selectedIncidentId={selectedIncidentId} 
          incidents={incidents} 
          poles={mapData.poles} 
        />

        {/* Render Transformers */}
        {mapData.transformers.map(dt => (
          <CircleMarker
            key={dt.id}
            center={[dt.lat, dt.lon]}
            radius={8}
            pathOptions={{
              color: '#3b82f6', // Blue
              fillColor: '#1e3a8a',
              fillOpacity: 0.8,
              weight: 2
            }}
          />
        ))}

        {/* Render Poles */}
        {mapData.poles.map(pole => {
          let color = '#10b981'; // Default: LIVE (Green)
          let radius = 4;
          let weight = 1;

          if (pole.state?.status === 'CONFIRMED_DARK') {
            color = '#ef4444'; // Red
            radius = 5;
            weight = 2;
          } else if (pole.state?.status === 'CANDIDATE_DARK') {
            color = '#f59e0b'; // Orange
          }

          // Check if pole is part of the selected incident
          const isSelected = selectedIncidentId && incidents.find(i => i.id === selectedIncidentId)?.affected_pole_ids?.includes(pole.id);
          if (isSelected) {
            radius = 6;
            weight = 3;
            color = '#3b82f6'; // Highlight selected poles in blue
          }

          return (
            <CircleMarker
              key={pole.id}
              center={[pole.lat, pole.lon]}
              radius={radius}
              eventHandlers={{
                click: () => {
                  // Find if this pole belongs to any active incident
                  const incident = incidents.find(i => i.affected_pole_ids?.includes(pole.id));
                  if (incident) {
                    onSelectIncident(incident.id);
                  }
                }
              }}
              pathOptions={{
                color: color,
                fillColor: color,
                fillOpacity: isSelected ? 1 : 0.6,
                weight: weight
              }}
            />
          );
        })}

        {/* Render Incident Overlays */}
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
      </MapContainer>

      {/* Stats Overlay */}
      <div className="absolute bottom-4 left-4 z-[1000] glass-panel px-4 py-2 rounded-lg text-xs font-mono text-slate-300">
        Nodes: {mapData.poles.length} | DTs: {mapData.transformers.length}
      </div>
    </div>
  );
}
