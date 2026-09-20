import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { GeoPoint, ScoutBoatInfo, AnchorPoint } from '../types';
import { createPirateShipIcon, createScoutBoatIcon, createAnchorIcon } from './MapIcons';

interface WaterWorldMapProps {
  userPos: GeoPoint;
  userHeading: number;
  userPath: GeoPoint[];
  scoutInfo: ScoutBoatInfo | null;
  anchor: AnchorPoint | null;
  userPathSinceAnchor: GeoPoint[];
  previewEnclosedCoords: GeoPoint[] | null;
  floodedPolygons: GeoPoint[][];
  isFlooding: boolean;
  onSwipe: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onMapReady?: (map: L.Map) => void;
  onZoomChange?: (zoom: number, visibleRadiusMiles: number) => void;
}

export const WaterWorldMap: React.FC<WaterWorldMapProps> = ({
  userPos,
  userHeading,
  userPath,
  scoutInfo,
  anchor,
  previewEnclosedCoords,
  floodedPolygons,
  isFlooding,
  onSwipe,
  onMapReady,
  onZoomChange,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Markers
  const shipMarkerRef = useRef<L.Marker | null>(null);
  const scoutMarkerRef = useRef<L.Marker | null>(null);
  const anchorMarkerRef = useRef<L.Marker | null>(null);

  // User Yellow Trail with Black Outline
  const trailOutlineRef = useRef<L.Polyline | null>(null);
  const trailInnerRef = useRef<L.Polyline | null>(null);

  // White / Blue connecting lines: Scout Stern -> Pirate Ship, and Scout Bow -> Anchor
  const sternToShipLineRef = useRef<L.Polyline | null>(null);
  const bowToAnchorLineRef = useRef<L.Polyline | null>(null);

  // Active floodable preview polygon
  const previewPolyRef = useRef<L.Polygon | null>(null);

  // Layer group for permanent flooded water bodies
  const floodedLayerGroupRef = useRef<L.LayerGroup | null>(null);

  // Touch & Swipe gesture tracking
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // Helper to calculate visible radius in miles
  const updateVisibleRadius = (map: L.Map) => {
    if (!onZoomChange) return;
    const center = map.getCenter();
    const bounds = map.getBounds();
    const east = L.latLng(center.lat, bounds.getEast());
    const meters = center.distanceTo(east);
    const miles = meters * 0.000621371;
    onZoomChange(map.getZoom(), miles);
  };

  // Initialize Leaflet Map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Minimum zoom clamped to prevent exceeding ~200 miles visible span
    const map = L.map(mapContainerRef.current, {
      center: [userPos.lat, userPos.lng],
      zoom: 14,
      minZoom: 7, // ~200 miles radius max
      maxZoom: 18,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false, // Gestures use swipes as per Ray-Ban glasses specs
      doubleClickZoom: false,
      boxZoom: false,
      touchZoom: false, // Custom touch swipe handler used instead
    });

    // Standard OpenStreetMap Tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
    }).addTo(map);

    // Layer for flooded territories
    const floodedGroup = L.layerGroup().addTo(map);
    floodedLayerGroupRef.current = floodedGroup;

    // User path polylines: bold yellow with black outline
    const outline = L.polyline([], {
      color: '#000000',
      weight: 12,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);
    trailOutlineRef.current = outline;

    const inner = L.polyline([], {
      color: '#ffea00',
      weight: 6.5,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);
    trailInnerRef.current = inner;

    // Scout connection lines: stern -> pirate ship, bow -> anchor
    const sternLine = L.polyline([], {
      color: '#ffffff',
      weight: 4,
      opacity: 0.95,
      dashArray: '8, 6',
    }).addTo(map);
    sternToShipLineRef.current = sternLine;

    const bowLine = L.polyline([], {
      color: '#ffffff',
      weight: 4,
      opacity: 0.95,
      dashArray: '8, 6',
    }).addTo(map);
    bowToAnchorLineRef.current = bowLine;

    // Preview polygon
    const preview = L.polygon([], {
      color: '#38bdf8',
      fillColor: '#0284c7',
      fillOpacity: 0.35,
      weight: 2.5,
      dashArray: '6, 6',
    }).addTo(map);
    previewPolyRef.current = preview;

    // Pirate ship marker in center
    const shipMarker = L.marker([userPos.lat, userPos.lng], {
      icon: createPirateShipIcon(userHeading),
      zIndexOffset: 1000,
    }).addTo(map);
    shipMarkerRef.current = shipMarker;

    mapRef.current = map;
    if (onMapReady) onMapReady(map);

    map.on('zoomend', () => {
      updateVisibleRadius(map);
    });
    updateVisibleRadius(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync pirate ship position & heading, keeping user centered
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.panTo([userPos.lat, userPos.lng], { animate: false });

    if (shipMarkerRef.current) {
      shipMarkerRef.current.setLatLng([userPos.lat, userPos.lng]);
      shipMarkerRef.current.setIcon(createPirateShipIcon(userHeading));
    }
  }, [userPos.lat, userPos.lng, userHeading]);

  // Update user trail path (bold yellow with black outline)
  useEffect(() => {
    const latlngs = userPath.map((pt) => [pt.lat, pt.lng] as [number, number]);
    if (trailOutlineRef.current) {
      trailOutlineRef.current.setLatLngs(latlngs);
    }
    if (trailInnerRef.current) {
      trailInnerRef.current.setLatLngs(latlngs);
    }
  }, [userPath]);

  // Update Anchor marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (anchor) {
      if (!anchorMarkerRef.current) {
        anchorMarkerRef.current = L.marker([anchor.position.lat, anchor.position.lng], {
          icon: createAnchorIcon(),
          zIndexOffset: 900,
        }).addTo(map);
      } else {
        anchorMarkerRef.current.setLatLng([anchor.position.lat, anchor.position.lng]);
      }
    } else if (anchorMarkerRef.current) {
      map.removeLayer(anchorMarkerRef.current);
      anchorMarkerRef.current = null;
    }
  }, [anchor]);

  // Update Scout Boat marker and Stern / Bow connecting lines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (scoutInfo && scoutInfo.state !== 'idle') {
      // Scout Marker
      if (!scoutMarkerRef.current) {
        scoutMarkerRef.current = L.marker([scoutInfo.position.lat, scoutInfo.position.lng], {
          icon: createScoutBoatIcon(scoutInfo.heading),
          zIndexOffset: 950,
        }).addTo(map);
      } else {
        scoutMarkerRef.current.setLatLng([scoutInfo.position.lat, scoutInfo.position.lng]);
        scoutMarkerRef.current.setIcon(createScoutBoatIcon(scoutInfo.heading));
      }

      // Connecting lines:
      // White line from stern to user's location (Pirate ship)
      // White line from bow to anchor
      // When flooding, the white line becomes blue!
      const lineColor = isFlooding ? '#0284c7' : '#ffffff';
      const lineWeight = isFlooding ? 7 : 4;
      const dashStyle = isFlooding ? '' : '8, 6';

      if (sternToShipLineRef.current) {
        sternToShipLineRef.current.setLatLngs([
          [scoutInfo.position.lat, scoutInfo.position.lng],
          [userPos.lat, userPos.lng],
        ]);
        sternToShipLineRef.current.setStyle({
          color: lineColor,
          weight: lineWeight,
          dashArray: dashStyle,
        });
      }

      if (bowToAnchorLineRef.current && anchor) {
        bowToAnchorLineRef.current.setLatLngs([
          [scoutInfo.position.lat, scoutInfo.position.lng],
          [anchor.position.lat, anchor.position.lng],
        ]);
        bowToAnchorLineRef.current.setStyle({
          color: lineColor,
          weight: lineWeight,
          dashArray: dashStyle,
        });
      }
    } else {
      // Remove scout marker and clear lines
      if (scoutMarkerRef.current) {
        map.removeLayer(scoutMarkerRef.current);
        scoutMarkerRef.current = null;
      }
      if (sternToShipLineRef.current) {
        sternToShipLineRef.current.setLatLngs([]);
      }
      if (bowToAnchorLineRef.current) {
        bowToAnchorLineRef.current.setLatLngs([]);
      }
    }
  }, [scoutInfo, anchor, userPos, isFlooding]);

  // Update active floodable area preview polygon
  useEffect(() => {
    if (!previewPolyRef.current) return;

    if (previewEnclosedCoords && previewEnclosedCoords.length >= 3 && !isFlooding) {
      const latlngs = previewEnclosedCoords.map((pt) => [pt.lat, pt.lng] as [number, number]);
      previewPolyRef.current.setLatLngs([latlngs]);
      previewPolyRef.current.setStyle({ opacity: 0.8, fillOpacity: 0.35 });
    } else {
      previewPolyRef.current.setLatLngs([]);
    }
  }, [previewEnclosedCoords, isFlooding]);

  // Render permanently flooded water polygons
  useEffect(() => {
    const group = floodedLayerGroupRef.current;
    if (!group) return;

    group.clearLayers();

    for (const polygon of floodedPolygons) {
      if (polygon.length < 3) continue;
      const latlngs = polygon.map((pt) => [pt.lat, pt.lng] as [number, number]);
      const waterPoly = L.polygon([latlngs], {
        color: '#0284c7',
        weight: 3,
        fillColor: '#0ea5e9',
        fillOpacity: 0.65,
        className: 'water-flooded-path',
      });
      group.addLayer(waterPoly);
    }
  }, [floodedPolygons]);

  // Touch and pointer swipe handlers
  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    touchStartRef.current = {
      x: clientX,
      y: clientY,
      time: Date.now(),
    };
  };

  const handleTouchEnd = (e: React.TouchEvent | React.MouseEvent) => {
    if (!touchStartRef.current) return;
    const clientX = 'changedTouches' in e ? e.changedTouches[0].clientX : e.clientX;
    const clientY = 'changedTouches' in e ? e.changedTouches[0].clientY : e.clientY;

    const dx = clientX - touchStartRef.current.x;
    const dy = clientY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.time;

    touchStartRef.current = null;

    // Minimum swipe displacement threshold
    const minDistance = 25;
    if (Math.abs(dx) < minDistance && Math.abs(dy) < minDistance) {
      return; // Regular tap or click
    }

    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) {
        onSwipe('right');
      } else {
        onSwipe('left');
      }
    } else {
      if (dy < 0) {
        onSwipe('up');
      } else {
        onSwipe('down');
      }
    }
  };

  return (
    <div
      id="water-world-viewport"
      className="relative w-full h-full overflow-hidden select-none touch-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleTouchStart}
      onMouseUp={handleTouchEnd}
    >
      {/* Full screen OpenStreetMap container */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Meta Ray-Ban display glasses optics tint / vignette */}
      <div className="glasses-hud-overlay absolute inset-0 z-10 pointer-events-none" />
    </div>
  );
};
