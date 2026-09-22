import React, { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { GeoPoint, ScoutBoatInfo, AnchorPoint, SupplyShipInfo, ViewMode } from './types';
import { WaterWorldMap } from './components/WaterWorldMap';
import { GlassesHUD } from './components/GlassesHUD';
import { ZoomWindow, ZOOM_MILES_OPTIONS } from './components/ZoomWindow';
import {
  getBearing,
  getDestinationPoint,
  getDistanceMeters,
  buildEnclosedPolygon,
  calculateFloodableAreaSqMiles,
  calculateSupplyShipState,
  buildSupplyPolygon,
  unionMultipleWater,
  toTurfPolygon,
} from './utils/geo';
import * as turf from '@turf/turf';
import {
  playAnchorSound,
  playScoutLaunchSound,
  playFloodingSound,
  playZoomSound,
} from './utils/audio';

// Default starting point (San Francisco Bay / Waterfront maritime view)
const INITIAL_COORDS: GeoPoint = {
  lat: 37.8080,
  lng: -122.4177,
};

// Convert miles to Leaflet zoom level for 'center' mode
function milesToZoomLevel(miles: number): number {
  if (miles <= 0.5) return 17;
  if (miles <= 20) return 12;
  if (miles <= 40) return 11;
  if (miles <= 60) return 10;
  if (miles <= 80) return 10;
  if (miles <= 100) return 9;
  if (miles <= 120) return 9;
  if (miles <= 140) return 8;
  if (miles <= 160) return 8;
  if (miles <= 180) return 7;
  return 7; // 200 miles
}

export default function App() {
  // User position & motion state
  const [userPos, setUserPos] = useState<GeoPoint>(INITIAL_COORDS);
  const [userHeading, setUserHeading] = useState<number>(45); // degrees
  const [userSpeedMps, setUserSpeedMps] = useState<number>(8.0); // ~18 mph default speed
  const [userPath, setUserPath] = useState<GeoPoint[]>([INITIAL_COORDS]);
  const [userPathSinceAnchor, setUserPathSinceAnchor] = useState<GeoPoint[]>([]);

  // Device GPS State
  const [hasGps, setHasGps] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(true); // Gentle motion until GPS moves

  // Scout boat state
  const [scoutInfo, setScoutInfo] = useState<ScoutBoatInfo | null>(null);

  // Anchor state
  const [anchor, setAnchor] = useState<AnchorPoint | null>(null);

  // Supply ship state
  const [supplyShipInfo, setSupplyShipInfo] = useState<SupplyShipInfo | null>(null);
  const [supplyEnclosedCoords, setSupplyEnclosedCoords] = useState<GeoPoint[] | null>(null);

  // Territory & Flooding state
  const [floodedPolygons, setFloodedPolygons] = useState<GeoPoint[][]>([]);
  const [cumulativeWaterFeature, setCumulativeWaterFeature] =
    useState<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null>(null);
  const [score, setScore] = useState<number>(0);
  const [floodableSqMiles, setFloodableSqMiles] = useState<number>(0);
  const [supplyFloodableSqMiles, setSupplyFloodableSqMiles] = useState<number>(0);
  const [scoutFloodableSqMiles, setScoutFloodableSqMiles] = useState<number>(0);
  const [isFlooding, setIsFlooding] = useState<boolean>(false);

  // Map & Zoom Window state
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(14);
  const [visibleRadiusMiles, setVisibleRadiusMiles] = useState<number>(1.2);
  const [viewMode, setViewMode] = useState<ViewMode>('full_course'); // Auto-fit path by default
  const [selectedZoomMiles, setSelectedZoomMiles] = useState<number>(20);
  const [isZoomWindowOpen, setIsZoomWindowOpen] = useState<boolean>(false);
  const [zoomWindowFocusedRow, setZoomWindowFocusedRow] = useState<number>(0); // 0 = View Mode, 1 = Zoom Amount

  // References for continuous animation & simulation loops
  const userPosRef = useRef<GeoPoint>(userPos);
  userPosRef.current = userPos;

  const userHeadingRef = useRef<number>(userHeading);
  userHeadingRef.current = userHeading;

  const userSpeedRef = useRef<number>(userSpeedMps);
  userSpeedRef.current = userSpeedMps;

  const userPathRef = useRef<GeoPoint[]>(userPath);
  userPathRef.current = userPath;

  const scoutInfoRef = useRef<ScoutBoatInfo | null>(scoutInfo);
  scoutInfoRef.current = scoutInfo;

  const anchorRef = useRef<AnchorPoint | null>(anchor);
  anchorRef.current = anchor;

  const cumulativeWaterRef = useRef(cumulativeWaterFeature);
  cumulativeWaterRef.current = cumulativeWaterFeature;

  const userPathSinceAnchorRef = useRef<GeoPoint[]>(userPathSinceAnchor);
  userPathSinceAnchorRef.current = userPathSinceAnchor;

  const hasGpsRef = useRef<boolean>(hasGps);
  hasGpsRef.current = hasGps;

  const viewModeRef = useRef<ViewMode>(viewMode);
  viewModeRef.current = viewMode;

  const selectedZoomMilesRef = useRef<number>(selectedZoomMiles);
  selectedZoomMilesRef.current = selectedZoomMiles;

  // Real GPS Geolocation Request & Watcher
  const requestGps = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      console.warn('Geolocation not supported on this device/browser');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHasGps(true);
        const devicePoint: GeoPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setUserPos(devicePoint);
        userPosRef.current = devicePoint;

        // If path only contains the initial SF placeholder, replace it with real device location
        setUserPath((prev) => {
          if (
            prev.length === 1 &&
            Math.abs(prev[0].lat - INITIAL_COORDS.lat) < 0.001 &&
            Math.abs(prev[0].lng - INITIAL_COORDS.lng) < 0.001
          ) {
            return [devicePoint];
          }
          return [...prev, devicePoint];
        });

        if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) {
          setUserHeading(pos.coords.heading);
        }
        if (pos.coords.speed !== null && pos.coords.speed > 0.5) {
          setUserSpeedMps(pos.coords.speed);
        }
      },
      (err) => {
        console.warn('Geolocation initial lock warning:', err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setHasGps(true);
        const newPt: GeoPoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        const dist = getDistanceMeters(userPosRef.current, newPt);
        if (dist >= 1.5) {
          const bearing = getBearing(userPosRef.current, newPt);
          const speed = position.coords.speed || dist / 2;
          moveShip(newPt, bearing, speed);
        }
      },
      (error) => {
        console.warn('Geolocation watcher warning:', error.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 20000,
      }
    );

    return watchId;
  }, []);

  // Request GPS immediately on mount
  useEffect(() => {
    const watchId = requestGps();
    return () => {
      if (watchId !== undefined && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [requestGps]);

  // Handle ship movement (updating user trail, scout position, and floodable areas)
  const moveShip = useCallback((newPos: GeoPoint, heading: number, speedMps: number) => {
    const prevPos = userPosRef.current;
    const distanceMeters = getDistanceMeters(prevPos, newPos);

    setUserPos(newPos);
    setUserHeading(heading);
    setUserSpeedMps(speedMps);

    // Append to user path
    setUserPath((prev) => {
      const last = prev[prev.length - 1];
      if (!last || getDistanceMeters(last, newPos) >= 2) {
        return [...prev, newPos];
      }
      return prev;
    });

    // If anchor is active, also record user path segment since anchor dropped
    if (anchorRef.current) {
      setUserPathSinceAnchor((prev) => [...prev, newPos]);
    }

    // Move Scout Boat if active
    const currentScout = scoutInfoRef.current;
    if (currentScout && currentScout.state === 'active') {
      const newScoutPos = getDestinationPoint(
        currentScout.position,
        currentScout.heading,
        distanceMeters
      );

      const updatedScout: ScoutBoatInfo = {
        ...currentScout,
        position: newScoutPos,
        path: [...currentScout.path, newScoutPos],
      };
      setScoutInfo(updatedScout);
    }
  }, []);

  // Continuous Voyage Simulation / Animation Loop for Ship & Supply Ship
  useEffect(() => {
    let lastTime = performance.now();
    let animationFrameId: number;

    const tick = (time: number) => {
      const dtSeconds = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      // 1. Simulate voyage movement if no active walking GPS detected
      if (isSimulating) {
        const currentPos = userPosRef.current;
        const heading = userHeadingRef.current;
        const speed = userSpeedRef.current;

        // Gentle natural ocean curve
        const newHeading = (heading + Math.sin(time * 0.0008) * 0.18 + 360) % 360;
        const distanceMeters = speed * dtSeconds;
        const newPos = getDestinationPoint(currentPos, newHeading, distanceMeters);

        moveShip(newPos, newHeading, speed);
      }

      // 2. Continuous Supply Ship Movement (15s forward, 15s back = 30s cycle)
      const currentPath = userPathRef.current;
      const startPt = currentPath[0] || userPosRef.current;
      const shipPt = userPosRef.current;

      const newSupplyState = calculateSupplyShipState(startPt, shipPt, Date.now());
      setSupplyShipInfo(newSupplyState);

      const newSupplyPolygon = buildSupplyPolygon(
        startPt,
        currentPath,
        shipPt,
        newSupplyState.position
      );
      setSupplyEnclosedCoords(newSupplyPolygon);

      // 3. Compute Real-Time Floodable Areas & Breakout:
      // A) Supply Ship floodable
      const supplyArea = calculateFloodableAreaSqMiles(
        newSupplyPolygon,
        cumulativeWaterRef.current
      );
      setSupplyFloodableSqMiles(supplyArea);

      // B) Scout boat floodable
      let scoutArea = 0;
      let activeScoutPoly: GeoPoint[] | null = null;
      if (
        scoutInfoRef.current &&
        scoutInfoRef.current.state === 'active' &&
        anchorRef.current
      ) {
        activeScoutPoly = buildEnclosedPolygon(
          anchorRef.current.position,
          scoutInfoRef.current.path,
          scoutInfoRef.current.position,
          shipPt,
          userPathSinceAnchorRef.current
        );
        scoutArea = calculateFloodableAreaSqMiles(
          activeScoutPoly,
          cumulativeWaterRef.current
        );
      }
      setScoutFloodableSqMiles(scoutArea);

      // C) Total Combined Floodable (avoid double counting if overlap occurs)
      let combinedTotal = 0;
      try {
        const supplyTurf = toTurfPolygon(newSupplyPolygon);
        const scoutTurf = activeScoutPoly ? toTurfPolygon(activeScoutPoly) : null;

        if (supplyTurf && scoutTurf) {
          const unionCandidates = turf.union(turf.featureCollection([supplyTurf, scoutTurf]));
          if (unionCandidates) {
            if (cumulativeWaterRef.current) {
              const diff = turf.difference(
                turf.featureCollection([unionCandidates, cumulativeWaterRef.current])
              );
              combinedTotal = diff ? turf.area(diff) * 3.8610215854245e-7 : 0;
            } else {
              combinedTotal = turf.area(unionCandidates) * 3.8610215854245e-7;
            }
          } else {
            combinedTotal = supplyArea + scoutArea;
          }
        } else if (supplyTurf) {
          combinedTotal = supplyArea;
        } else if (scoutTurf) {
          combinedTotal = scoutArea;
        }
      } catch {
        combinedTotal = supplyArea + scoutArea;
      }
      setFloodableSqMiles(Math.max(0, combinedTotal));

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isSimulating, moveShip]);

  // Handle map view mode updates
  useEffect(() => {
    if (!mapInstance) return;

    if (viewMode === 'center') {
      const zoom = milesToZoomLevel(selectedZoomMiles);
      mapInstance.setView([userPos.lat, userPos.lng], zoom, { animate: false });
    }
  }, [viewMode, selectedZoomMiles, mapInstance]);

  // Trigger Enclose and Flooding action for BOTH supply ship and scout
  const triggerFlooding = useCallback(() => {
    const currentScout = scoutInfoRef.current;
    const currentAnchor = anchorRef.current;
    const currentSupplyCoords = supplyEnclosedCoords;

    const polygonsToFlood: GeoPoint[][] = [];

    // 1. Supply ship enclosed polygon
    if (currentSupplyCoords && currentSupplyCoords.length >= 3) {
      polygonsToFlood.push(currentSupplyCoords);
    }

    // 2. Scout enclosed polygon if active
    let hasScoutFlooded = false;
    if (currentScout && currentAnchor && currentScout.state === 'active') {
      const scoutEnclosedCoords = buildEnclosedPolygon(
        currentAnchor.position,
        currentScout.path,
        currentScout.position,
        userPosRef.current,
        userPathSinceAnchorRef.current
      );
      if (scoutEnclosedCoords.length >= 3) {
        polygonsToFlood.push(scoutEnclosedCoords);
        hasScoutFlooded = true;
      }
    }

    if (polygonsToFlood.length === 0) return;

    // 3. Play flooding sound and show FLOODING banner in center for 1.0 second
    playFloodingSound();
    setIsFlooding(true);

    setTimeout(() => {
      setIsFlooding(false);
    }, 1000);

    // 4. Compute score & water union (ensuring each area only contributes once)
    const { newFeature, totalAreaSqMiles } = unionMultipleWater(
      cumulativeWaterRef.current,
      polygonsToFlood
    );

    setCumulativeWaterFeature(newFeature);
    setScore(totalAreaSqMiles);
    setFloodedPolygons((prev) => [...prev, ...polygonsToFlood]);
    setFloodableSqMiles(0);
    setSupplyFloodableSqMiles(0);
    setScoutFloodableSqMiles(0);

    // 5. Scout returns to pirate ship in less than 1 second (<1s animation)
    if (hasScoutFlooded && currentScout) {
      const returnStartPos = currentScout.position;
      const startTime = performance.now();
      const returnDurationMs = 700;

      setScoutInfo((prev) =>
        prev
          ? {
              ...prev,
              state: 'returning',
              returnStartPos,
            }
          : null
      );

      const animateReturn = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / returnDurationMs, 1);

        if (progress < 1) {
          const targetPos = userPosRef.current;
          const currentLat =
            returnStartPos.lat + (targetPos.lat - returnStartPos.lat) * progress;
          const currentLng =
            returnStartPos.lng + (targetPos.lng - returnStartPos.lng) * progress;
          const returnHeading = getBearing(
            { lat: currentLat, lng: currentLng },
            targetPos
          );

          setScoutInfo((prev) =>
            prev
              ? {
                  ...prev,
                  position: { lat: currentLat, lng: currentLng },
                  heading: returnHeading,
                  returnProgress: progress,
                }
              : null
          );

          requestAnimationFrame(animateReturn);
        } else {
          // Scout arrived at ship: reset scout and anchor
          setScoutInfo(null);
          setAnchor(null);
          setUserPathSinceAnchor([]);
        }
      };

      requestAnimationFrame(animateReturn);
    }
  }, [supplyEnclosedCoords]);

  // Main Swiping Action Handler
  const handleSwipe = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      // ----------------------------------------------------
      // IF ZOOM WINDOW IS OPEN:
      // "On the zoom window, moving selection all the way up for all the way down
      // goes back to the main screen. swiping up and down moves up and down
      // the different options, left and right to select setting."
      // ----------------------------------------------------
      if (isZoomWindowOpen) {
        if (direction === 'up') {
          if (zoomWindowFocusedRow === 1) {
            setZoomWindowFocusedRow(0); // Move selection up
          } else {
            // "moving selection all the way up goes back to the main screen"
            setIsZoomWindowOpen(false);
          }
          return;
        }

        if (direction === 'down') {
          if (zoomWindowFocusedRow === 0) {
            setZoomWindowFocusedRow(1); // Move selection down
          } else {
            // "or all the way down goes back to the main screen"
            setIsZoomWindowOpen(false);
          }
          return;
        }

        if (direction === 'left' || direction === 'right') {
          if (zoomWindowFocusedRow === 0) {
            // Toggle view mode between 'center' and 'full_course'
            setViewMode((prev) => (prev === 'center' ? 'full_course' : 'center'));
          } else {
            // Rotate zoom amount
            setSelectedZoomMiles((prev) => {
              const curIdx = ZOOM_MILES_OPTIONS.indexOf(prev) !== -1
                ? ZOOM_MILES_OPTIONS.indexOf(prev)
                : 0;
              const step = direction === 'right' ? 1 : -1;
              const nextIdx =
                (curIdx + step + ZOOM_MILES_OPTIONS.length) % ZOOM_MILES_OPTIONS.length;
              return ZOOM_MILES_OPTIONS[nextIdx];
            });
            playZoomSound(direction === 'right');
          }
          return;
        }
        return;
      }

      // ----------------------------------------------------
      // MAIN SCREEN SWIPES:
      // ----------------------------------------------------
      // SWIPE UP: Brings up zoom window options
      if (direction === 'up') {
        setIsZoomWindowOpen(true);
        setZoomWindowFocusedRow(0);
        return;
      }

      // SWIPE DOWN: Floods the area for both supply ship and Scout and adjusts score
      if (direction === 'down') {
        triggerFlooding();
        return;
      }

      // SWIPE LEFT: Scout runs off to the left (90° left)
      // SWIPE RIGHT: Scout runs off to the right (90° right)
      if (direction === 'left' || direction === 'right') {
        const currentPos = userPosRef.current;
        const heading = userHeadingRef.current;

        // Drop anchor at current location if not already dropped
        const newAnchor: AnchorPoint = {
          position: currentPos,
          timestamp: Date.now(),
        };
        setAnchor(newAnchor);
        playAnchorSound();

        // Reset path segment since anchor
        setUserPathSinceAnchor([currentPos]);

        // Calculate scout direction & heading
        const scoutDir = direction === 'left' ? 'left' : 'right';
        const angleOffset = scoutDir === 'left' ? -90 : 90;
        const scoutHeading = (heading + angleOffset + 360) % 360;

        // Initial scout position slightly offset from main ship
        const initialScoutPos = getDestinationPoint(currentPos, scoutHeading, 15);

        const newScout: ScoutBoatInfo = {
          state: 'active',
          direction: scoutDir,
          position: initialScoutPos,
          heading: scoutHeading,
          speedMps: userSpeedRef.current,
          path: [currentPos, initialScoutPos],
        };
        setScoutInfo(newScout);
        playScoutLaunchSound();
      }
    },
    [isZoomWindowOpen, zoomWindowFocusedRow, triggerFlooding]
  );

  // Keyboard Arrow Keys emulation for Ray-Ban temple swipe gestures
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleSwipe('up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleSwipe('down');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleSwipe('left');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleSwipe('right');
      } else if (e.key === 'Escape') {
        setIsZoomWindowOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleSwipe]);

  // Compute active preview enclosed polygon coords for scout
  const scoutPreviewCoords =
    scoutInfo && scoutInfo.state === 'active' && anchor
      ? buildEnclosedPolygon(
          anchor.position,
          scoutInfo.path,
          scoutInfo.position,
          userPos,
          userPathSinceAnchor
        )
      : null;

  const currentSpeedMph = userSpeedMps * 2.23694;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-neutral-950 font-sans">
      {/* Full Screen OpenStreetMap */}
      <WaterWorldMap
        userPos={userPos}
        userHeading={userHeading}
        userPath={userPath}
        scoutInfo={scoutInfo}
        anchor={anchor}
        userPathSinceAnchor={userPathSinceAnchor}
        previewEnclosedCoords={scoutPreviewCoords}
        supplyShipInfo={supplyShipInfo}
        supplyEnclosedCoords={supplyEnclosedCoords}
        viewMode={viewMode}
        floodedPolygons={floodedPolygons}
        isFlooding={isFlooding}
        onSwipe={handleSwipe}
        onMapReady={(map) => setMapInstance(map)}
        onZoomChange={(zoom, radiusMiles) => {
          setZoomLevel(zoom);
          setVisibleRadiusMiles(radiusMiles);
        }}
        onTapViewport={requestGps}
      />

      {/* Head-Up Display (HUD) with Water World Movie Logo and Breakout Scores */}
      <GlassesHUD
        score={score}
        floodableSqMiles={floodableSqMiles}
        supplyFloodableSqMiles={supplyFloodableSqMiles}
        scoutFloodableSqMiles={scoutFloodableSqMiles}
        isFlooding={isFlooding}
        scoutInfo={scoutInfo}
        anchor={anchor}
        currentHeading={userHeading}
        currentSpeedMph={currentSpeedMph}
        visibleRadiusMiles={visibleRadiusMiles}
        hasGps={hasGps}
        onGrantGps={requestGps}
        onOpenZoomWindow={() => {
          setIsZoomWindowOpen(true);
          setZoomWindowFocusedRow(0);
        }}
      />

      {/* Horizontal Rotational Zoom Scope & View Mode Popup Window */}
      <ZoomWindow
        isOpen={isZoomWindowOpen}
        onClose={() => setIsZoomWindowOpen(false)}
        viewMode={viewMode}
        onSelectViewMode={(mode) => setViewMode(mode)}
        zoomMiles={selectedZoomMiles}
        onSelectZoomMiles={(miles) => {
          setSelectedZoomMiles(miles);
          playZoomSound(true);
        }}
        focusedRow={zoomWindowFocusedRow}
        onSetFocusedRow={(row) => setZoomWindowFocusedRow(row)}
      />
    </main>
  );
}
