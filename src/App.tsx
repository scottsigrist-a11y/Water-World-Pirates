import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import L from 'leaflet';
import { GeoPoint, ScoutBoatInfo, AnchorPoint, ViewMode } from './types';
import { WaterWorldMap, WaterWorldMapHandle } from './components/WaterWorldMap';
import { GlassesHUD } from './components/GlassesHUD';
import { ZoomWindow, ZOOM_MILES_OPTIONS } from './components/ZoomWindow';
import {
  getBearing,
  getDestinationPoint,
  getDistanceMeters,
  appendOptimizedPoint,
  buildEnclosedPolygon,
  calculateFloodableAreaSqMeters,
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

const INITIAL_COORDS: GeoPoint = {
  lat: 37.8080,
  lng: -122.4177,
};

const MIN_GPS_STEP_METERS = 4.0;
const SUPPLY_ANIM_INTERVAL_MS = 66; // ~15 FPS: silky smooth on dashboard with 4x lower CPU load
const AREA_CALC_INTERVAL_MS = 400; // 2.5 Hz Turf geometric area updates

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
  return 7;
}

export default function App() {
  // User position & motion state
  const [userPos, setUserPos] = useState<GeoPoint>(INITIAL_COORDS);
  const [userHeading, setUserHeading] = useState<number>(45);
  const [userSpeedMps, setUserSpeedMps] = useState<number>(8.0);
  const [userPath, setUserPath] = useState<GeoPoint[]>([]);
  const [userPathSinceAnchor, setUserPathSinceAnchor] = useState<GeoPoint[]>([]);

  // Device GPS State
  const [hasGps, setHasGps] = useState<boolean>(false);
  const [isSimulating] = useState<boolean>(false);

  // Scout boat & Anchor state
  const [scoutInfo, setScoutInfo] = useState<ScoutBoatInfo | null>(null);
  const [anchor, setAnchor] = useState<AnchorPoint | null>(null);

  // Territory & Flooding state
  const [cumulativeWaterFeature, setCumulativeWaterFeature] =
    useState<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null>(null);
  const [score, setScore] = useState<number>(0);
  const [floodableSqMeters, setFloodableSqMeters] = useState<number>(0);
  const [supplyFloodableSqMeters, setSupplyFloodableSqMeters] = useState<number>(0);
  const [scoutFloodableSqMeters, setScoutFloodableSqMeters] = useState<number>(0);
  const [isFlooding, setIsFlooding] = useState<boolean>(false);

  // Map & Zoom Window state
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [visibleRadiusMiles, setVisibleRadiusMiles] = useState<number>(1.2);
  const [viewMode, setViewMode] = useState<ViewMode>('full_course');
  const [selectedZoomMiles, setSelectedZoomMiles] = useState<number>(20);
  const [isZoomWindowOpen, setIsZoomWindowOpen] = useState<boolean>(false);
  const [zoomWindowFocusedRow, setZoomWindowFocusedRow] = useState<number>(0);

  // Imperative handle to WaterWorldMap for zero-re-render supply ship animation
  const mapComponentRef = useRef<WaterWorldMapHandle | null>(null);

  // Refs for continuous animation & simulation loops
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

  const cumulativeWaterBboxRef = useRef<[number, number, number, number] | null>(null);
  const supplyEnclosedCoordsRef = useRef<GeoPoint[] | null>(null);
  const isFloodingRef = useRef<boolean>(isFlooding);
  isFloodingRef.current = isFlooding;

  const supplyProgressRef = useRef<number>(0);
  const supplyDirectionRef = useRef<1 | -1>(1);

  const userPathSinceAnchorRef = useRef<GeoPoint[]>(userPathSinceAnchor);
  userPathSinceAnchorRef.current = userPathSinceAnchor;

  const lastScoresRef = useRef({ supply: 0, scout: 0, combined: 0 });

  // Handle ship movement with active collinear point pruning
  const moveShip = useCallback((newPos: GeoPoint, heading: number, speedMps: number) => {
    const prevPos = userPosRef.current;
    const distanceMeters = getDistanceMeters(prevPos, newPos);

    userPosRef.current = newPos;
    userHeadingRef.current = heading;
    userSpeedRef.current = speedMps;

    setUserPos(newPos);
    setUserHeading(heading);
    setUserSpeedMps(speedMps);

    // Append to user path with online collinearity & distance pruning
    setUserPath((prev) => {
      const res = appendOptimizedPoint(prev, newPos, {
        minStepMeters: MIN_GPS_STEP_METERS,
        collinearToleranceMeters: 1.8,
        maxSegmentMeters: 250,
        maxPoints: 300,
      });
      if (!res.changed) return prev;
      userPathRef.current = res.points;
      return res.points;
    });

    // If anchor is active, prune anchor segment points as well
    if (anchorRef.current) {
      setUserPathSinceAnchor((prev) => {
        const res = appendOptimizedPoint(prev, newPos, {
          minStepMeters: MIN_GPS_STEP_METERS,
          collinearToleranceMeters: 1.8,
          maxSegmentMeters: 250,
          maxPoints: 200,
        });
        if (!res.changed) return prev;
        userPathSinceAnchorRef.current = res.points;
        return res.points;
      });
    }

    // Move Scout Boat if active (and prune its straight-line path!)
    const currentScout = scoutInfoRef.current;
    if (currentScout && currentScout.state === 'active') {
      const newScoutPos = getDestinationPoint(
        currentScout.position,
        currentScout.heading,
        distanceMeters
      );

      const scoutPathRes = appendOptimizedPoint(currentScout.path, newScoutPos, {
        minStepMeters: MIN_GPS_STEP_METERS,
        collinearToleranceMeters: 1.5,
        maxSegmentMeters: 250,
        maxPoints: 200,
      });

      const updatedScout: ScoutBoatInfo = {
        ...currentScout,
        position: newScoutPos,
        path: scoutPathRes.points,
      };
      scoutInfoRef.current = updatedScout;
      setScoutInfo(updatedScout);
    }
  }, []);

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

        setUserPath((prev) => {
          if (prev.length === 0) {
            userPathRef.current = [devicePoint];
            return [devicePoint];
          }
          return prev;
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

        if (userPathRef.current.length === 0) {
          setUserPos(newPt);
          userPosRef.current = newPt;
          setUserPath([newPt]);
          userPathRef.current = [newPt];
          return;
        }

        const dist = getDistanceMeters(userPosRef.current, newPt);
        if (dist >= MIN_GPS_STEP_METERS) {
          const bearing =
            position.coords.heading !== null && !isNaN(position.coords.heading) && position.coords.speed && position.coords.speed > 1.5
              ? position.coords.heading
              : getBearing(userPosRef.current, newPt);
          const speed = position.coords.speed || dist / 2;
          moveShip(newPt, bearing, speed);
        }
      },
      (error) => {
        console.warn('Geolocation watcher warning:', error.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1500,
        timeout: 20000,
      }
    );

    return watchId;
  }, [moveShip]);

  useEffect(() => {
    const watchId = requestGps();
    return () => {
      if (watchId !== undefined && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [requestGps]);

  // Tesla-Optimized Animation & Area Calculation Loop (0 React re-renders for boat motion)
  useEffect(() => {
    let lastTime = performance.now();
    let lastSupplyRenderTime = 0;
    let lastAreaCalcTime = 0;
    let animationFrameId: number;

    const tick = (time: number) => {
      // Pause animation & geometry work when Tesla screen switches away from browser
      if (typeof document !== 'undefined' && document.hidden) {
        lastTime = time;
        animationFrameId = requestAnimationFrame(tick);
        return;
      }

      const dtSeconds = Math.min((time - lastTime) / 1000, 0.25);
      lastTime = time;

      // 1. Optional simulation (disabled by default until GPS lock)
      if (isSimulating && userPathRef.current.length > 0) {
        const currentPos = userPosRef.current;
        const heading = userHeadingRef.current;
        const speed = userSpeedRef.current;
        const newHeading = (heading + Math.sin(time * 0.0008) * 0.18 + 360) % 360;
        const distanceMeters = speed * dtSeconds;
        const newPos = getDestinationPoint(currentPos, newHeading, distanceMeters);
        moveShip(newPos, newHeading, speed);
      }

      const currentPath = userPathRef.current;
      if (currentPath.length > 0) {
        const RUN_DURATION_SEC = 15.0;
        if (supplyDirectionRef.current === 1) {
          supplyProgressRef.current += dtSeconds / RUN_DURATION_SEC;
          if (supplyProgressRef.current >= 1.0) {
            supplyProgressRef.current = 1.0;
            supplyDirectionRef.current = -1;
          }
        } else {
          supplyProgressRef.current -= dtSeconds / RUN_DURATION_SEC;
          if (supplyProgressRef.current <= 0.0) {
            supplyProgressRef.current = 0.0;
            supplyDirectionRef.current = 1;
          }
        }

        // 2. Pace supply ship DOM/Canvas updates to ~15 FPS with ZERO React re-renders
        if (time - lastSupplyRenderTime >= SUPPLY_ANIM_INTERVAL_MS) {
          lastSupplyRenderTime = time;

          const startPt = currentPath[0] || userPosRef.current;
          const shipPt = userPosRef.current;

          const newSupplyState = calculateSupplyShipState(
            startPt,
            shipPt,
            supplyProgressRef.current,
            supplyDirectionRef.current === 1,
            userHeadingRef.current
          );

          const newSupplyPolygon = buildSupplyPolygon(
            startPt,
            currentPath,
            shipPt,
            newSupplyState.position
          );
          supplyEnclosedCoordsRef.current = newSupplyPolygon;

          mapComponentRef.current?.updateSupplyVisuals(
            newSupplyState,
            shipPt,
            startPt,
            newSupplyPolygon,
            isFloodingRef.current
          );

          // 3. Throttle Turf geometric area calculations to 2.5 Hz (every 400ms)
          if (time - lastAreaCalcTime >= AREA_CALC_INTERVAL_MS) {
            lastAreaCalcTime = time;

            const waterFeature = cumulativeWaterRef.current;
            const waterBbox = cumulativeWaterBboxRef.current;

            const supplyArea = calculateFloodableAreaSqMeters(
              newSupplyPolygon,
              waterFeature,
              waterBbox
            );

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
              scoutArea = calculateFloodableAreaSqMeters(
                activeScoutPoly,
                waterFeature,
                waterBbox
              );
            }

            let combinedTotal = 0;
            try {
              const supplyTurf = toTurfPolygon(newSupplyPolygon, false);
              const scoutTurf = activeScoutPoly ? toTurfPolygon(activeScoutPoly, false) : null;

              if (supplyTurf && scoutTurf) {
                const unionCandidates = turf.union(turf.featureCollection([supplyTurf, scoutTurf]));
                if (unionCandidates) {
                  if (waterFeature) {
                    const diff = turf.difference(
                      turf.featureCollection([unionCandidates, waterFeature])
                    );
                    combinedTotal = diff ? turf.area(diff) : 0;
                  } else {
                    combinedTotal = turf.area(unionCandidates);
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

            combinedTotal = Math.max(0, combinedTotal);

            // Only trigger HUD React state updates when displayed numbers change meaningfully
            if (Math.abs(supplyArea - lastScoresRef.current.supply) >= 0.5) {
              lastScoresRef.current.supply = supplyArea;
              setSupplyFloodableSqMeters(supplyArea);
            }
            if (Math.abs(scoutArea - lastScoresRef.current.scout) >= 0.5) {
              lastScoresRef.current.scout = scoutArea;
              setScoutFloodableSqMeters(scoutArea);
            }
            if (Math.abs(combinedTotal - lastScoresRef.current.combined) >= 0.5) {
              lastScoresRef.current.combined = combinedTotal;
              setFloodableSqMeters(combinedTotal);
            }
          }
        }
      } else if (lastScoresRef.current.combined !== 0 || lastScoresRef.current.supply !== 0) {
        mapComponentRef.current?.clearSupplyVisuals();
        lastScoresRef.current = { supply: 0, scout: 0, combined: 0 };
        setSupplyFloodableSqMeters(0);
        setScoutFloodableSqMeters(0);
        setFloodableSqMeters(0);
      }

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
      mapInstance.setView([userPosRef.current.lat, userPosRef.current.lng], zoom, { animate: false });
    }
  }, [viewMode, selectedZoomMiles, mapInstance]);

  // Trigger Enclose and Flooding action for BOTH supply ship and scout
  const triggerFlooding = useCallback(() => {
    const currentScout = scoutInfoRef.current;
    const currentAnchor = anchorRef.current;
    const currentShipPos = userPosRef.current;
    const currentPath = userPathRef.current;

    const polygonsToFlood: GeoPoint[][] = [];

    let currentSupplyCoords = supplyEnclosedCoordsRef.current;
    if ((!currentSupplyCoords || currentSupplyCoords.length < 3) && currentPath.length > 0) {
      const startPt = currentPath[0] || currentShipPos;
      const supplyState = calculateSupplyShipState(
        startPt,
        currentShipPos,
        supplyProgressRef.current,
        supplyDirectionRef.current === 1,
        userHeadingRef.current
      );
      currentSupplyCoords = buildSupplyPolygon(
        startPt,
        currentPath,
        currentShipPos,
        supplyState.position
      );
    }

    if (currentSupplyCoords && currentSupplyCoords.length >= 3) {
      polygonsToFlood.push(currentSupplyCoords);
    }

    let hasScoutFlooded = false;
    if (currentScout && currentAnchor && currentScout.state === 'active') {
      const scoutEnclosedCoords = buildEnclosedPolygon(
        currentAnchor.position,
        currentScout.path,
        currentScout.position,
        currentShipPos,
        userPathSinceAnchorRef.current
      );
      if (scoutEnclosedCoords && scoutEnclosedCoords.length >= 3) {
        polygonsToFlood.push(scoutEnclosedCoords);
        hasScoutFlooded = true;
      }
    }

    if (polygonsToFlood.length === 0) return;

    playFloodingSound();
    setIsFlooding(true);
    setTimeout(() => {
      setIsFlooding(false);
    }, 1000);

    const { newFeature, totalAreaSqMeters } = unionMultipleWater(
      cumulativeWaterRef.current,
      polygonsToFlood
    );

    cumulativeWaterRef.current = newFeature;
    cumulativeWaterBboxRef.current = newFeature
      ? (turf.bbox(newFeature) as [number, number, number, number])
      : null;
    setCumulativeWaterFeature(newFeature);
    setScore(totalAreaSqMeters);

    if (hasScoutFlooded) {
      setUserPathSinceAnchor([currentShipPos]);
      userPathSinceAnchorRef.current = [currentShipPos];
    }

    lastScoresRef.current = { supply: 0, scout: 0, combined: 0 };
    setFloodableSqMeters(0);
    setSupplyFloodableSqMeters(0);
    setScoutFloodableSqMeters(0);

    if (hasScoutFlooded && currentScout) {
      const returnStartPos = currentScout.position;
      const startTime = performance.now();
      const returnDurationMs = 700;

      const returningScout: ScoutBoatInfo = {
        ...currentScout,
        state: 'returning',
        returnStartPos,
      };
      scoutInfoRef.current = returningScout;
      setScoutInfo(returningScout);

      let lastReturnFrame = 0;
      const animateReturn = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / returnDurationMs, 1);

        if (progress < 1) {
          if (now - lastReturnFrame >= 45) {
            lastReturnFrame = now;
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
                    heading: isNaN(returnHeading) ? prev.heading : returnHeading,
                  }
                : null
            );
          }
          requestAnimationFrame(animateReturn);
        } else {
          scoutInfoRef.current = null;
          anchorRef.current = null;
          setScoutInfo(null);
          setAnchor(null);
          setUserPathSinceAnchor([]);
          userPathSinceAnchorRef.current = [];
        }
      };

      requestAnimationFrame(animateReturn);
    }
  }, []);

  // Main Swiping Action Handler
  const handleSwipe = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (isZoomWindowOpen) {
        if (direction === 'up') {
          if (zoomWindowFocusedRow === 1) {
            setZoomWindowFocusedRow(0);
          } else {
            setIsZoomWindowOpen(false);
          }
          return;
        }

        if (direction === 'down') {
          if (zoomWindowFocusedRow === 0) {
            setZoomWindowFocusedRow(1);
          } else {
            setIsZoomWindowOpen(false);
          }
          return;
        }

        if (direction === 'left' || direction === 'right') {
          if (zoomWindowFocusedRow === 0) {
            setViewMode((prev) => (prev === 'center' ? 'full_course' : 'center'));
          } else {
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

      if (direction === 'up') {
        setIsZoomWindowOpen(true);
        setZoomWindowFocusedRow(0);
        return;
      }

      if (direction === 'down') {
        triggerFlooding();
        return;
      }

      if (direction === 'left' || direction === 'right') {
        const currentPos = userPosRef.current;
        const heading = userHeadingRef.current;

        const newAnchor: AnchorPoint = {
          position: currentPos,
          timestamp: Date.now(),
        };
        setAnchor(newAnchor);
        playAnchorSound();

        setUserPathSinceAnchor([currentPos]);
        userPathSinceAnchorRef.current = [currentPos];

        const scoutDir = direction === 'left' ? 'left' : 'right';
        const angleOffset = scoutDir === 'left' ? -90 : 90;
        const scoutHeading = (heading + angleOffset + 360) % 360;

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

  // Keyboard Arrow Keys emulation
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

  const scoutPreviewCoords = useMemo(() => {
    if (scoutInfo && scoutInfo.state === 'active' && anchor) {
      return buildEnclosedPolygon(
        anchor.position,
        scoutInfo.path,
        scoutInfo.position,
        userPos,
        userPathSinceAnchor
      );
    }
    return null;
  }, [scoutInfo, anchor, userPos, userPathSinceAnchor]);

  // Stable callbacks so memoized children never re-render needlessly
  const handleMapReady = useCallback((map: L.Map) => {
    setMapInstance(map);
  }, []);

  const handleZoomChange = useCallback((_zoom: number, radiusMiles: number) => {
    setVisibleRadiusMiles(radiusMiles);
  }, []);

  const handleOpenZoomWindow = useCallback(() => {
    setIsZoomWindowOpen(true);
    setZoomWindowFocusedRow(0);
  }, []);

  const handleCloseZoomWindow = useCallback(() => {
    setIsZoomWindowOpen(false);
  }, []);

  const handleSelectViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  const handleSelectZoomMiles = useCallback((miles: number) => {
    setSelectedZoomMiles(miles);
    playZoomSound(true);
  }, []);

  const currentSpeedMph = userSpeedMps * 2.23694;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-neutral-950 font-sans">
      {/* Full Screen OpenStreetMap Canvas */}
      <WaterWorldMap
        ref={mapComponentRef}
        userPos={userPos}
        userHeading={userHeading}
        userPath={userPath}
        scoutInfo={scoutInfo}
        anchor={anchor}
        userPathSinceAnchor={userPathSinceAnchor}
        previewEnclosedCoords={scoutPreviewCoords}
        viewMode={viewMode}
        cumulativeWaterFeature={cumulativeWaterFeature}
        isFlooding={isFlooding}
        onSwipe={handleSwipe}
        onMapReady={handleMapReady}
        onZoomChange={handleZoomChange}
        onTapViewport={requestGps}
      />

      {/* Head-Up Display (HUD) */}
      <GlassesHUD
        score={score}
        floodableSqMeters={floodableSqMeters}
        supplyFloodableSqMeters={supplyFloodableSqMeters}
        scoutFloodableSqMeters={scoutFloodableSqMeters}
        isFlooding={isFlooding}
        scoutInfo={scoutInfo}
        anchor={anchor}
        currentHeading={userHeading}
        currentSpeedMph={currentSpeedMph}
        visibleRadiusMiles={visibleRadiusMiles}
        hasGps={hasGps}
        onGrantGps={requestGps}
        onOpenZoomWindow={handleOpenZoomWindow}
        onFlood={triggerFlooding}
      />

      {/* Horizontal Rotational Zoom Scope & View Mode Popup Window */}
      <ZoomWindow
        isOpen={isZoomWindowOpen}
        onClose={handleCloseZoomWindow}
        viewMode={viewMode}
        onSelectViewMode={handleSelectViewMode}
        zoomMiles={selectedZoomMiles}
        onSelectZoomMiles={handleSelectZoomMiles}
        focusedRow={zoomWindowFocusedRow}
        onSetFocusedRow={setZoomWindowFocusedRow}
      />
    </main>
  );
}
