import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { GeoPoint, ScoutBoatInfo, AnchorPoint, SupplyShipInfo, ViewMode } from '../types';
import { 
  createPirateShipIcon, 
  createScoutBoatIcon, 
  createAnchorIcon, 
  createSupplyShipIcon 
} from './MapIcons';

interface WaterWorldMapProps {
  userPos: GeoPoint;
  userHeading: number;
  userPath: GeoPoint[];
  scoutInfo: ScoutBoatInfo | null;
  anchor: AnchorPoint | null;
  userPathSinceAnchor: GeoPoint[];
  previewEnclosedCoords: GeoPoint[] | null;
  supplyShipInfo: SupplyShipInfo | null;
  supplyEnclosedCoords: GeoPoint[] | null;
  viewMode: ViewMode;
  floodedPolygons: GeoPoint[][];
  cumulativeWaterFeature?: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  isFlooding: boolean;
  onSwipe: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onMapReady?: (map: L.Map) => void;
  onZoomChange?: (zoom: number, visibleRadiusMiles: number) => void;
  onTapViewport?: () => void;
}

export const WaterWorldMap: React.FC<WaterWorldMapProps> = ({
  userPos,
  userHeading,
  userPath,
  scoutInfo,
  anchor,
  previewEnclosedCoords,
  supplyShipInfo,
  supplyEnclosedCoords,
  viewMode,
  floodedPolygons,
  cumulativeWaterFeature,
  isFlooding,
  onSwipe,
  onMapReady,
  onZoomChange,
  onTapViewport,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Markers
  const shipMarkerRef = useRef<L.Marker | null>(null);
  const scoutMarkerRef = useRef<L.Marker | null>(null);
  const anchorMarkerRef = useRef<L.Marker | null>(null);
  const supplyShipMarkerRef = useRef<L.Marker | null>(null);

  // User Yellow Trail with Black Outline
  const trailOutlineRef = useRef<L.Polyline | null>(null);
  const trailInnerRef = useRef<L.Polyline | null>(null);

  // White / Blue connecting lines: Scout Stern -> Pirate Ship, and Scout Bow -> Anchor
  const sternToShipLineRef = useRef<L.Polyline | null>(null);
  const bowToAnchorLineRef = useRef<L.Polyline | null>(null);

  // High-contrast Amber Dotted Lines for Supply Ship (optimized for dark street map contrast)
  // 1. Bow to Pirate Ship
  // 2. Stern to Start of Path
  const supplyBowToShipLineRef = useRef<L.Polyline | null>(null);
  const supplySternToStartLineRef = useRef<L.Polyline | null>(null);

  // Active floodable preview polygons
  const scoutPreviewPolyRef = useRef<L.Polygon | null>(null);
  const supplyPreviewPolyRef = useRef<L.Polygon | null>(null);

  // Single unified GeoJSON layer for all permanent flooded water bodies (avoids DOM overload)
  const floodedGeoJsonRef = useRef<L.GeoJSON | null>(null);

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
      minZoom: 6, // ~200 miles radius max
      maxZoom: 18,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      touchZoom: false,
    });

    // Standard OpenStreetMap Tiles (Completely free, open license)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
    }).addTo(map);

    // Single unified GeoJSON layer for permanent flooded water
    const floodedGeo = L.geoJSON(null, {
      style: {
        color: '#0284c7',
        weight: 2,
        fillColor: '#0ea5e9',
        fillOpacity: 0.62,
        className: 'water-flooded-path',
      },
    }).addTo(map);
    floodedGeoJsonRef.current = floodedGeo;

    // Preview polygons for active floodable zones
    const supplyPreview = L.polygon([], {
      color: '#0284c7',
      fillColor: '#38bdf8',
      fillOpacity: 0.28,
      weight: 1.5,
      dashArray: '4, 4',
    }).addTo(map);
    supplyPreviewPolyRef.current = supplyPreview;

    const scoutPreview = L.polygon([], {
      color: '#38bdf8',
      fillColor: '#0284c7',
      fillOpacity: 0.35,
      weight: 2.5,
      dashArray: '6, 6',
    }).addTo(map);
    scoutPreviewPolyRef.current = scoutPreview;

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

    // Supply Ship Black Dotted Lines:
    // Bow to Pirate Ship
    const bowLineSupply = L.polyline([], {
      color: '#000000',
      weight: 3.5,
      opacity: 0.95,
      dashArray: '6, 6',
    }).addTo(map);
    supplyBowToShipLineRef.current = bowLineSupply;

    // Stern to Start of Path
    const sternLineSupply = L.polyline([], {
      color: '#000000',
      weight: 3.5,
      opacity: 0.95,
      dashArray: '6, 6',
    }).addTo(map);
    supplySternToStartLineRef.current = sternLineSupply;

    // Scout connection lines: stern -> pirate ship, bow -> anchor
    const sternLineScout = L.polyline([], {
      color: '#ffffff',
      weight: 4,
      opacity: 0.95,
      dashArray: '8, 6',
    }).addTo(map);
    sternToShipLineRef.current = sternLineScout;

    const bowLineScout = L.polyline([], {
      color: '#ffffff',
      weight: 4,
      opacity: 0.95,
      dashArray: '8, 6',
    }).addTo(map);
    bowToAnchorLineRef.current = bowLineScout;

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

  // Update camera based on viewMode ('full_course' vs 'center')
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (viewMode === 'full_course') {
      // Auto-fit entire course/path on screen
      const pts: [number, number][] = userPath.map((p) => [p.lat, p.lng]);
      if (supplyShipInfo) {
        pts.push([supplyShipInfo.position.lat, supplyShipInfo.position.lng]);
      }
      if (scoutInfo) {
        pts.push([scoutInfo.position.lat, scoutInfo.position.lng]);
      }
      if (anchor) {
        pts.push([anchor.position.lat, anchor.position.lng]);
      }

      if (pts.length >= 2) {
        const bounds = L.latLngBounds(pts);
        if (bounds.isValid()) {
          map.fitBounds(bounds, {
            padding: [65, 65],
            maxZoom: 17,
            animate: false,
          });
        }
      } else {
        map.panTo([userPos.lat, userPos.lng], { animate: false });
      }
    } else {
      // 'center' mode: keep pirate ship centered
      map.panTo([userPos.lat, userPos.lng], { animate: false });
    }

    if (shipMarkerRef.current) {
      shipMarkerRef.current.setLatLng([userPos.lat, userPos.lng]);
      shipMarkerRef.current.setIcon(createPirateShipIcon(userHeading));
    }
  }, [userPos.lat, userPos.lng, userHeading, userPath, viewMode, supplyShipInfo, scoutInfo, anchor]);

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

  // Update Supply Ship marker and Black Dotted connecting lines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (supplyShipInfo && userPath.length > 0) {
      const startPt = userPath[0];
      const shipPt = userPos;
      const supplyPt = supplyShipInfo.position;

      // Marker
      if (!supplyShipMarkerRef.current) {
        supplyShipMarkerRef.current = L.marker([supplyPt.lat, supplyPt.lng], {
          icon: createSupplyShipIcon(supplyShipInfo.heading),
          zIndexOffset: 920,
        }).addTo(map);
      } else {
        supplyShipMarkerRef.current.setLatLng([supplyPt.lat, supplyPt.lng]);
        supplyShipMarkerRef.current.setIcon(createSupplyShipIcon(supplyShipInfo.heading));
      }

      // 1. Black dotted line from Bow of Supply Ship to Pirate Ship
      if (supplyBowToShipLineRef.current) {
        supplyBowToShipLineRef.current.setLatLngs([
          [supplyPt.lat, supplyPt.lng],
          [shipPt.lat, shipPt.lng],
        ]);
      }

      // 2. Black dotted line from Stern of Supply Ship to Start of Path
      if (supplySternToStartLineRef.current) {
        supplySternToStartLineRef.current.setLatLngs([
          [supplyPt.lat, supplyPt.lng],
          [startPt.lat, startPt.lng],
        ]);
      }

      // Preview polygon within the two lines and path
      if (supplyPreviewPolyRef.current && supplyEnclosedCoords && supplyEnclosedCoords.length >= 3 && !isFlooding) {
        const polyLatLngs = supplyEnclosedCoords.map((pt) => [pt.lat, pt.lng] as [number, number]);
        supplyPreviewPolyRef.current.setLatLngs([polyLatLngs]);
        supplyPreviewPolyRef.current.setStyle({ opacity: 0.7, fillOpacity: 0.25 });
      } else if (supplyPreviewPolyRef.current) {
        supplyPreviewPolyRef.current.setLatLngs([]);
      }
    } else {
      if (supplyShipMarkerRef.current) {
        map.removeLayer(supplyShipMarkerRef.current);
        supplyShipMarkerRef.current = null;
      }
      if (supplyBowToShipLineRef.current) {
        supplyBowToShipLineRef.current.setLatLngs([]);
      }
      if (supplySternToStartLineRef.current) {
        supplySternToStartLineRef.current.setLatLngs([]);
      }
      if (supplyPreviewPolyRef.current) {
        supplyPreviewPolyRef.current.setLatLngs([]);
      }
    }
  }, [supplyShipInfo, supplyEnclosedCoords, userPos, userPath, isFlooding]);

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

  // Update active floodable area scout preview polygon
  useEffect(() => {
    if (!scoutPreviewPolyRef.current) return;

    if (previewEnclosedCoords && previewEnclosedCoords.length >= 3 && !isFlooding) {
      const latlngs = previewEnclosedCoords.map((pt) => [pt.lat, pt.lng] as [number, number]);
      scoutPreviewPolyRef.current.setLatLngs([latlngs]);
      scoutPreviewPolyRef.current.setStyle({ opacity: 0.8, fillOpacity: 0.35 });
    } else {
      scoutPreviewPolyRef.current.setLatLngs([]);
    }
  }, [previewEnclosedCoords, isFlooding]);

  // Render permanently flooded water: use single unified GeoJSON layer for peak GPU/CPU efficiency
  useEffect(() => {
    const geoLayer = floodedGeoJsonRef.current;
    if (!geoLayer) return;

    geoLayer.clearLayers();

    if (cumulativeWaterFeature) {
      geoLayer.addData(cumulativeWaterFeature as any);
    } else if (floodedPolygons && floodedPolygons.length > 0) {
      // Fallback if cumulativeWaterFeature not provided
      for (const polygon of floodedPolygons) {
        if (polygon.length < 3) continue;
        const latlngs = polygon.map((pt) => [pt.lat, pt.lng] as [number, number]);
        const waterPoly = L.polygon([latlngs], {
          color: '#0284c7',
          weight: 2,
          fillColor: '#0ea5e9',
          fillOpacity: 0.62,
          className: 'water-flooded-path',
        });
        geoLayer.addLayer(waterPoly);
      }
    }
  }, [cumulativeWaterFeature, floodedPolygons]);

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
    touchStartRef.current = null;

    // Minimum swipe displacement threshold
    const minDistance = 25;
    if (Math.abs(dx) < minDistance && Math.abs(dy) < minDistance) {
      if (onTapViewport) onTapViewport();
      return;
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
      className="relative w-full h-full overflow-hidden select-none touch-none bg-black"
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
