import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import L from 'leaflet';
import { GeoPoint, ScoutBoatInfo, AnchorPoint, SupplyShipInfo, ViewMode } from '../types';
import {
  createPirateShipIcon,
  createScoutBoatIcon,
  createAnchorIcon,
  createSupplyShipIcon,
  rotateMarkerIcon,
} from './MapIcons';

// Guard Leaflet 1.9.x Canvas._redraw against React StrictMode / HMR unmount races
// where _destroyContainer() deletes _ctx while a rAF redraw callback is firing.
const canvasProto = L.Canvas.prototype as unknown as {
  _redraw?: () => void;
  _ctx?: CanvasRenderingContext2D;
  _map?: L.Map;
  _container?: HTMLCanvasElement;
  _redrawRequest?: number | null;
  _waterWorldPatched?: boolean;
};
if (!canvasProto._waterWorldPatched && typeof canvasProto._redraw === 'function') {
  const origRedraw = canvasProto._redraw;
  canvasProto._redraw = function () {
    if (!this._ctx || !this._map || !this._container) {
      this._redrawRequest = null;
      return;
    }
    return origRedraw.call(this);
  };
  canvasProto._waterWorldPatched = true;
}

export interface WaterWorldMapHandle {
  updateSupplyVisuals: (
    supplyState: SupplyShipInfo,
    shipPos: GeoPoint,
    startPt: GeoPoint,
    supplyEnclosedCoords: GeoPoint[] | null,
    isFlooding: boolean
  ) => void;
  clearSupplyVisuals: () => void;
}

interface WaterWorldMapProps {
  userPos: GeoPoint;
  userHeading: number;
  userPath: GeoPoint[];
  scoutInfo: ScoutBoatInfo | null;
  anchor: AnchorPoint | null;
  userPathSinceAnchor: GeoPoint[];
  previewEnclosedCoords: GeoPoint[] | null;
  viewMode: ViewMode;
  cumulativeWaterFeature?: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  isFlooding: boolean;
  onSwipe: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onMapReady?: (map: L.Map) => void;
  onZoomChange?: (zoom: number, visibleRadiusMiles: number) => void;
  onTapViewport?: () => void;
}

const WaterWorldMapInner = forwardRef<WaterWorldMapHandle, WaterWorldMapProps>(({
  userPos,
  userHeading,
  userPath,
  scoutInfo,
  anchor,
  previewEnclosedCoords,
  viewMode,
  cumulativeWaterFeature,
  isFlooding,
  onSwipe,
  onMapReady,
  onZoomChange,
  onTapViewport,
}, ref) => {
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

  // Black Dotted Lines for Supply Ship:
  // 1. Bow to Pirate Ship
  // 2. Stern to Start of Path
  const supplyBowToShipLineRef = useRef<L.Polyline | null>(null);
  const supplySternToStartLineRef = useRef<L.Polyline | null>(null);

  // Active floodable preview polygons
  const scoutPreviewPolyRef = useRef<L.Polygon | null>(null);
  const supplyPreviewPolyRef = useRef<L.Polygon | null>(null);

  // Single unified GeoJSON layer for all permanent flooded water bodies
  const floodedGeoJsonRef = useRef<L.GeoJSON | null>(null);

  // Track last supply state for full_course bounds without triggering React re-renders
  const lastSupplyPosRef = useRef<GeoPoint | null>(null);
  const lastFitBoundsTimeRef = useRef<number>(0);

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

  // Expose imperative high-frequency supply ship updater (0 React re-renders)
  useImperativeHandle(ref, () => ({
    updateSupplyVisuals: (
      supplyState: SupplyShipInfo,
      shipPos: GeoPoint,
      startPt: GeoPoint,
      supplyEnclosedCoords: GeoPoint[] | null,
      floodingNow: boolean
    ) => {
      const map = mapRef.current;
      if (!map) return;

      const supplyPt = supplyState.position;
      lastSupplyPosRef.current = supplyPt;

      if (!supplyShipMarkerRef.current) {
        supplyShipMarkerRef.current = L.marker([supplyPt.lat, supplyPt.lng], {
          icon: createSupplyShipIcon(supplyState.heading),
          zIndexOffset: 920,
          interactive: false,
        }).addTo(map);
      } else {
        supplyShipMarkerRef.current.setLatLng([supplyPt.lat, supplyPt.lng]);
        rotateMarkerIcon(supplyShipMarkerRef.current, supplyState.heading);
      }

      if (supplyBowToShipLineRef.current) {
        supplyBowToShipLineRef.current.setLatLngs([
          [supplyPt.lat, supplyPt.lng],
          [shipPos.lat, shipPos.lng],
        ]);
      }

      if (supplySternToStartLineRef.current) {
        supplySternToStartLineRef.current.setLatLngs([
          [supplyPt.lat, supplyPt.lng],
          [startPt.lat, startPt.lng],
        ]);
      }

      if (supplyPreviewPolyRef.current) {
        if (supplyEnclosedCoords && supplyEnclosedCoords.length >= 3 && !floodingNow) {
          const polyLatLngs = supplyEnclosedCoords.map((pt) => [pt.lat, pt.lng] as [number, number]);
          supplyPreviewPolyRef.current.setLatLngs([polyLatLngs]);
        } else {
          supplyPreviewPolyRef.current.setLatLngs([]);
        }
      }
    },
    clearSupplyVisuals: () => {
      const map = mapRef.current;
      lastSupplyPosRef.current = null;
      if (map && supplyShipMarkerRef.current) {
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
    },
  }), []);

  // Initialize Leaflet Map once with Tesla-optimized Canvas & Tile settings
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [userPos.lat, userPos.lng],
      zoom: 14,
      minZoom: 6,
      maxZoom: 18,
      preferCanvas: true,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      touchZoom: false,
      keyboard: false,
    });

    // Free OpenStreetMap Tiles tuned for low-memory embedded browsers (Tesla MCU)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
      keepBuffer: 1, // Minimize offscreen tile RAM usage
      updateWhenIdle: true, // Fetch tiles when pan/zoom settles
      updateWhenZooming: false,
      detectRetina: false, // Standard 1x tiles cut bandwidth & RAM by 75%
    }).addTo(map);

    // Single unified GeoJSON layer rendered onto Canvas (inherited from map preferCanvas)
    const floodedGeo = L.geoJSON(null, {
      style: {
        color: '#0284c7',
        weight: 2,
        fillColor: '#0ea5e9',
        fillOpacity: 0.62,
        interactive: false,
      },
    }).addTo(map);
    floodedGeoJsonRef.current = floodedGeo;

    // Preview polygons for active floodable zones
    const supplyPreview = L.polygon([], {
      color: '#0284c7',
      fillColor: '#38bdf8',
      fillOpacity: 0.25,
      weight: 1.5,
      dashArray: '4, 4',
      interactive: false,
    }).addTo(map);
    supplyPreviewPolyRef.current = supplyPreview;

    const scoutPreview = L.polygon([], {
      color: '#38bdf8',
      fillColor: '#0284c7',
      fillOpacity: 0.35,
      weight: 2.5,
      dashArray: '6, 6',
      interactive: false,
    }).addTo(map);
    scoutPreviewPolyRef.current = scoutPreview;

    // User path polylines: bold yellow with black outline
    const outline = L.polyline([], {
      color: '#000000',
      weight: 12,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(map);
    trailOutlineRef.current = outline;

    const inner = L.polyline([], {
      color: '#ffea00',
      weight: 6.5,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(map);
    trailInnerRef.current = inner;

    // Supply Ship Black Dotted Lines
    const bowLineSupply = L.polyline([], {
      color: '#000000',
      weight: 3.5,
      opacity: 0.95,
      dashArray: '6, 6',
      interactive: false,
    }).addTo(map);
    supplyBowToShipLineRef.current = bowLineSupply;

    const sternLineSupply = L.polyline([], {
      color: '#000000',
      weight: 3.5,
      opacity: 0.95,
      dashArray: '6, 6',
      interactive: false,
    }).addTo(map);
    supplySternToStartLineRef.current = sternLineSupply;

    // Scout connection lines: stern -> pirate ship, bow -> anchor
    const sternLineScout = L.polyline([], {
      color: '#ffffff',
      weight: 4,
      opacity: 0.95,
      dashArray: '8, 6',
      interactive: false,
    }).addTo(map);
    sternToShipLineRef.current = sternLineScout;

    const bowLineScout = L.polyline([], {
      color: '#ffffff',
      weight: 4,
      opacity: 0.95,
      dashArray: '8, 6',
      interactive: false,
    }).addTo(map);
    bowToAnchorLineRef.current = bowLineScout;

    // Pirate ship marker (created once, rotated in-place)
    const shipMarker = L.marker([userPos.lat, userPos.lng], {
      icon: createPirateShipIcon(userHeading),
      zIndexOffset: 1000,
      interactive: false,
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
      shipMarkerRef.current = null;
      scoutMarkerRef.current = null;
      anchorMarkerRef.current = null;
      supplyShipMarkerRef.current = null;
      trailOutlineRef.current = null;
      trailInnerRef.current = null;
      sternToShipLineRef.current = null;
      bowToAnchorLineRef.current = null;
      supplyBowToShipLineRef.current = null;
      supplySternToStartLineRef.current = null;
      scoutPreviewPolyRef.current = null;
      supplyPreviewPolyRef.current = null;
      floodedGeoJsonRef.current = null;
    };
  }, []);

  // Update Pirate Ship position/rotation and throttled camera tracking
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (shipMarkerRef.current) {
      shipMarkerRef.current.setLatLng([userPos.lat, userPos.lng]);
      rotateMarkerIcon(shipMarkerRef.current, userHeading);
    }

    if (viewMode === 'full_course') {
      const now = performance.now();
      // Throttle expensive fitBounds recalculations to avoid tile thrashing
      if (now - lastFitBoundsTimeRef.current >= 900 || userPath.length <= 2) {
        lastFitBoundsTimeRef.current = now;
        const pts: [number, number][] = userPath.map((p) => [p.lat, p.lng]);
        if (lastSupplyPosRef.current) {
          pts.push([lastSupplyPosRef.current.lat, lastSupplyPosRef.current.lng]);
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
      }
    } else {
      map.panTo([userPos.lat, userPos.lng], { animate: false });
    }
  }, [userPos.lat, userPos.lng, userHeading, userPath, viewMode, scoutInfo, anchor]);

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
          interactive: false,
        }).addTo(map);
      } else {
        anchorMarkerRef.current.setLatLng([anchor.position.lat, anchor.position.lng]);
      }
    } else if (anchorMarkerRef.current) {
      map.removeLayer(anchorMarkerRef.current);
      anchorMarkerRef.current = null;
    }
  }, [anchor]);

  // Update Scout Boat marker (in-place rotation) and Stern / Bow connecting lines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (scoutInfo && scoutInfo.state !== 'idle') {
      if (!scoutMarkerRef.current) {
        scoutMarkerRef.current = L.marker([scoutInfo.position.lat, scoutInfo.position.lng], {
          icon: createScoutBoatIcon(scoutInfo.heading),
          zIndexOffset: 950,
          interactive: false,
        }).addTo(map);
      } else {
        scoutMarkerRef.current.setLatLng([scoutInfo.position.lat, scoutInfo.position.lng]);
        rotateMarkerIcon(scoutMarkerRef.current, scoutInfo.heading);
      }

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
    } else {
      scoutPreviewPolyRef.current.setLatLngs([]);
    }
  }, [previewEnclosedCoords, isFlooding]);

  // Render permanently flooded water via single unified Canvas GeoJSON layer
  useEffect(() => {
    const geoLayer = floodedGeoJsonRef.current;
    if (!geoLayer) return;

    geoLayer.clearLayers();
    if (cumulativeWaterFeature) {
      geoLayer.addData(cumulativeWaterFeature as any);
    }
  }, [cumulativeWaterFeature]);

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

    const minDistance = 25;
    if (Math.abs(dx) < minDistance && Math.abs(dy) < minDistance) {
      if (onTapViewport) onTapViewport();
      return;
    }

    if (Math.abs(dx) > Math.abs(dy)) {
      onSwipe(dx > 0 ? 'right' : 'left');
    } else {
      onSwipe(dy < 0 ? 'up' : 'down');
    }
  };

  return (
    <div
      id="water-world-viewport"
      className="relative w-full h-full overflow-hidden select-none touch-none bg-neutral-950"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleTouchStart}
      onMouseUp={handleTouchEnd}
    >
      {/* Full screen OpenStreetMap container */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Lightweight HUD vignette */}
      <div className="glasses-hud-overlay absolute inset-0 z-10 pointer-events-none" />
    </div>
  );
});

WaterWorldMapInner.displayName = 'WaterWorldMap';
export const WaterWorldMap = React.memo(WaterWorldMapInner);
