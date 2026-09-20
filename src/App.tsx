import React, { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { GeoPoint, ScoutBoatInfo, AnchorPoint } from './types';
import { WaterWorldMap } from './components/WaterWorldMap';
import { GlassesHUD } from './components/GlassesHUD';
import {
  getBearing,
  getDestinationPoint,
  getDistanceMeters,
  buildEnclosedPolygon,
  calculateFloodableAreaSqMiles,
  unionWater,
} from './utils/geo';
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

export default function App() {
  // User position & motion state
  const [userPos, setUserPos] = useState<GeoPoint>(INITIAL_COORDS);
  const [userHeading, setUserHeading] = useState<number>(45); // degrees
  const [userSpeedMps, setUserSpeedMps] = useState<number>(8.0); // ~18 mph cruising speed
  const [userPath, setUserPath] = useState<GeoPoint[]>([INITIAL_COORDS]);
  const [userPathSinceAnchor, setUserPathSinceAnchor] = useState<GeoPoint[]>([]);

  // Scout boat state
  const [scoutInfo, setScoutInfo] = useState<ScoutBoatInfo | null>(null);

  // Anchor state
  const [anchor, setAnchor] = useState<AnchorPoint | null>(null);

  // Territory & Flooding state
  const [floodedPolygons, setFloodedPolygons] = useState<GeoPoint[][]>([]);
  const [cumulativeWaterFeature, setCumulativeWaterFeature] =
    useState<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null>(null);
  const [score, setScore] = useState<number>(0);
  const [floodableSqMiles, setFloodableSqMiles] = useState<number>(0);
  const [isFlooding, setIsFlooding] = useState<boolean>(false);

  // Map & HUD state
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(14);
  const [visibleRadiusMiles, setVisibleRadiusMiles] = useState<number>(1.2);

  // Simulation & GPS state
  const [isSimulating, setIsSimulating] = useState<boolean>(true); // Start sailing immediately for instant immersion
  const [isGpsActive, setIsGpsActive] = useState<boolean>(false);

  // References for continuous animation & simulation loops
  const userPosRef = useRef<GeoPoint>(userPos);
  userPosRef.current = userPos;

  const userHeadingRef = useRef<number>(userHeading);
  userHeadingRef.current = userHeading;

  const userSpeedRef = useRef<number>(userSpeedMps);
  userSpeedRef.current = userSpeedMps;

  const scoutInfoRef = useRef<ScoutBoatInfo | null>(scoutInfo);
  scoutInfoRef.current = scoutInfo;

  const anchorRef = useRef<AnchorPoint | null>(anchor);
  anchorRef.current = anchor;

  const cumulativeWaterRef = useRef(cumulativeWaterFeature);
  cumulativeWaterRef.current = cumulativeWaterFeature;

  const userPathSinceAnchorRef = useRef<GeoPoint[]>(userPathSinceAnchor);
  userPathSinceAnchorRef.current = userPathSinceAnchor;

  // Real GPS Geolocation Watcher
  useEffect(() => {
    if (!isGpsActive || typeof navigator === 'undefined' || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const newPt: GeoPoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        const dist = getDistanceMeters(userPosRef.current, newPt);
        if (dist > 2) {
          const bearing = getBearing(userPosRef.current, newPt);
          const speed = position.coords.speed || dist;
          moveShip(newPt, bearing, speed);
        }
      },
      (error) => {
        console.warn('Geolocation error:', error.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [isGpsActive]);

  // Handle ship movement (updating user trail, scout position, and floodable area)
  const moveShip = useCallback((newPos: GeoPoint, heading: number, speedMps: number) => {
    const prevPos = userPosRef.current;
    const distanceMeters = getDistanceMeters(prevPos, newPos);

    setUserPos(newPos);
    setUserHeading(heading);
    setUserSpeedMps(speedMps);

    // Append to general user path (for bold yellow with black outline trail)
    setUserPath((prev) => {
      const last = prev[prev.length - 1];
      if (!last || getDistanceMeters(last, newPos) >= 3) {
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
      // Scout moves at the same speed and distance as the user!
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

      // Recompute real-time Floodable Area
      if (anchorRef.current) {
        const enclosedCoords = buildEnclosedPolygon(
          anchorRef.current.position,
          updatedScout.path,
          newScoutPos,
          newPos,
          userPathSinceAnchorRef.current
        );

        const areaSqMiles = calculateFloodableAreaSqMiles(
          enclosedCoords,
          cumulativeWaterRef.current
        );
        setFloodableSqMiles(areaSqMiles);
      }
    }
  }, []);

  // Voyage Simulation Engine (cruising navigation loop)
  useEffect(() => {
    if (!isSimulating || isGpsActive) return;

    let lastTime = performance.now();
    let animationFrameId: number;

    const tick = (time: number) => {
      const dtSeconds = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      const currentPos = userPosRef.current;
      const heading = userHeadingRef.current;
      const speed = userSpeedRef.current;

      // Gentle natural sea curve
      const newHeading = (heading + Math.sin(time * 0.0008) * 0.18 + 360) % 360;

      const distanceMeters = speed * dtSeconds;
      const newPos = getDestinationPoint(currentPos, newHeading, distanceMeters);

      moveShip(newPos, newHeading, speed);

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isSimulating, isGpsActive, moveShip]);

  // Trigger Enclose and Flooding action
  const triggerFlooding = useCallback(() => {
    const currentScout = scoutInfoRef.current;
    const currentAnchor = anchorRef.current;

    if (!currentScout || !currentAnchor) return;

    // 1. Build the final enclosed polygon
    const enclosedCoords = buildEnclosedPolygon(
      currentAnchor.position,
      currentScout.path,
      currentScout.position,
      userPosRef.current,
      userPathSinceAnchorRef.current
    );

    // 2. Play flooding sound and show FLOODING banner in center for 1.0 second
    playFloodingSound();
    setIsFlooding(true);

    setTimeout(() => {
      setIsFlooding(false);
    }, 1000);

    // 3. Compute score & water union (ensuring area only contributes once)
    const { newFeature, totalAreaSqMiles } = unionWater(
      cumulativeWaterRef.current,
      enclosedCoords
    );

    setCumulativeWaterFeature(newFeature);
    setScore(totalAreaSqMiles);
    setFloodedPolygons((prev) => [...prev, enclosedCoords]);
    setFloodableSqMiles(0);

    // 4. Scout returns to the pirate ship in less than 1 second (<1s animation)
    const returnStartPos = currentScout.position;
    const startTime = performance.now();
    const returnDurationMs = 700; // less than a second (700ms)

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
        // Interpolate between returnStartPos and current user position
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
        // Scout arrived at pirate ship: scout returns to idle, anchor goes away!
        setScoutInfo(null);
        setAnchor(null);
        setUserPathSinceAnchor([]);
      }
    };

    requestAnimationFrame(animateReturn);
  }, []);

  // Meta Ray-Ban Glasses Swiping Action Handler
  const handleSwipe = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      // SWIPE UP: Zoom in
      if (direction === 'up') {
        if (mapInstance) {
          mapInstance.zoomIn();
          playZoomSound(true);
        }
        return;
      }

      // SWIPE DOWN: Zoom out, maximum 200 miles
      if (direction === 'down') {
        if (mapInstance) {
          // Check if current visible radius is already at or near 200 miles
          if (visibleRadiusMiles < 200) {
            mapInstance.zoomOut();
            playZoomSound(false);
          }
        }
        return;
      }

      // SWIPE LEFT OR RIGHT:
      // If scout is currently active, swipe encloses the area and floods!
      if (scoutInfoRef.current && scoutInfoRef.current.state === 'active') {
        triggerFlooding();
        return;
      }

      // If scout is NOT active, drop anchor and deploy scout boat!
      // "When the user swipes left, an anchor drops to mark that location and a small scout boat
      // drops away from the main ship and will take a 90 degree angle to the left and move at
      // the same speed the user is moving until the user swipes again to enclose the area...
      // If they swipe right, the ship goes 90 degrees in the opposite direction."
      const currentPos = userPosRef.current;
      const heading = userHeadingRef.current;

      // Drop anchor at current location
      const newAnchor: AnchorPoint = {
        position: currentPos,
        timestamp: Date.now(),
      };
      setAnchor(newAnchor);
      playAnchorSound();

      // Reset user path since anchor
      setUserPathSinceAnchor([currentPos]);

      // Calculate scout direction & heading
      const scoutDir = direction === 'left' ? 'left' : 'right';
      const angleOffset = scoutDir === 'left' ? -90 : 90;
      const scoutHeading = (heading + angleOffset + 360) % 360;

      // Initial scout position slightly separated from main ship
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
    },
    [mapInstance, visibleRadiusMiles, triggerFlooding]
  );

  // Keyboard Arrow Keys as Ray-Ban temple swipe shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in an input
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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleSwipe]);

  // Compute active preview enclosed polygon coords
  const previewEnclosedCoords =
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
      {/* Full Screen OpenStreetMap with Pirate Ship in Center */}
      <WaterWorldMap
        userPos={userPos}
        userHeading={userHeading}
        userPath={userPath}
        scoutInfo={scoutInfo}
        anchor={anchor}
        userPathSinceAnchor={userPathSinceAnchor}
        previewEnclosedCoords={previewEnclosedCoords}
        floodedPolygons={floodedPolygons}
        isFlooding={isFlooding}
        onSwipe={handleSwipe}
        onMapReady={(map) => setMapInstance(map)}
        onZoomChange={(zoom, radiusMiles) => {
          setZoomLevel(zoom);
          setVisibleRadiusMiles(radiusMiles);
        }}
      />

      {/* Head-Up Display (HUD) with Water World Movie Logo */}
      <GlassesHUD
        score={score}
        floodableSqMiles={floodableSqMiles}
        isFlooding={isFlooding}
        scoutInfo={scoutInfo}
        anchor={anchor}
        currentHeading={userHeading}
        currentSpeedMph={currentSpeedMph}
        visibleRadiusMiles={visibleRadiusMiles}
      />
    </main>
  );
}
