import * as turf from '@turf/turf';
import { GeoPoint } from '../types';

const SQ_METERS_TO_SQ_MILES = 3.8610215854245e-7;

/**
 * Calculates initial bearing from point A to point B in degrees (0..360)
 */
export function getBearing(start: GeoPoint, end: GeoPoint): number {
  const startLat = (start.lat * Math.PI) / 180;
  const startLng = (start.lng * Math.PI) / 180;
  const endLat = (end.lat * Math.PI) / 180;
  const endLng = (end.lng * Math.PI) / 180;

  const dLng = endLng - startLng;
  const y = Math.sin(dLng) * Math.cos(endLat);
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);

  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

/**
 * Calculates destination point given starting point, bearing (degrees), and distance (meters)
 */
export function getDestinationPoint(
  start: GeoPoint,
  bearingDeg: number,
  distanceMeters: number
): GeoPoint {
  const R = 6371e3; // Earth radius in meters
  const delta = distanceMeters / R;
  const theta = (bearingDeg * Math.PI) / 180;

  const lat1 = (start.lat * Math.PI) / 180;
  const lng1 = (start.lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) +
      Math.cos(lat1) * Math.sin(delta) * Math.cos(theta)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lng2 * 180) / Math.PI,
  };
}

/**
 * Calculates great-circle distance between two points in meters
 */
export function getDistanceMeters(p1: GeoPoint, p2: GeoPoint): number {
  const from = turf.point([p1.lng, p1.lat]);
  const to = turf.point([p2.lng, p2.lat]);
  return turf.distance(from, to, { units: 'meters' });
}

/**
 * Construct an enclosed polygon from:
 * - Anchor
 * - Scout path / bow
 * - Scout current position
 * - Pirate ship current position
 * - Pirate ship path backwards to anchor
 */
export function buildEnclosedPolygon(
  anchor: GeoPoint,
  scoutPath: GeoPoint[],
  scoutCurrent: GeoPoint,
  userCurrent: GeoPoint,
  userPathSinceAnchor: GeoPoint[]
): GeoPoint[] {
  const ring: GeoPoint[] = [anchor];

  // Scout traversed path from anchor
  for (const pt of scoutPath) {
    ring.push(pt);
  }
  ring.push(scoutCurrent);

  // Line from scout to user pirate ship
  ring.push(userCurrent);

  // User path back to anchor (reverse)
  for (let i = userPathSinceAnchor.length - 1; i >= 0; i--) {
    ring.push(userPathSinceAnchor[i]);
  }

  // Close the ring
  ring.push(anchor);
  return ring;
}

/**
 * Clean a sequence of GeoPoints into a valid GeoJSON LinearRing:
 * - Drops invalid coordinates
 * - Filters out consecutive duplicate vertices (< 0.1m)
 * - Ensures ring is properly closed
 * - Requires at least 3 distinct vertices
 */
export function cleanRing(points: GeoPoint[]): number[][] | null {
  if (!points || points.length < 3) return null;

  const ring: number[][] = [];
  for (const pt of points) {
    const lng = Number(pt.lng);
    const lat = Number(pt.lat);
    if (isNaN(lng) || isNaN(lat)) continue;

    if (ring.length === 0) {
      ring.push([lng, lat]);
    } else {
      const prev = ring[ring.length - 1];
      if (Math.abs(prev[0] - lng) > 1e-6 || Math.abs(prev[1] - lat) > 1e-6) {
        ring.push([lng, lat]);
      }
    }
  }

  // Remove trailing duplicate if it matches the first
  if (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) {
      ring.pop();
    }
  }

  if (ring.length < 3) return null;

  // Close the ring
  ring.push([...ring[0]]);
  return ring;
}

/**
 * Convert GeoPoint array to turf Polygon feature with robust self-intersection handling
 */
export function toTurfPolygon(
  coords: GeoPoint[]
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  const ring = cleanRing(coords);
  if (!ring) return null;

  try {
    const rawPoly = turf.polygon([ring]);

    // Try unkinkPolygon to resolve self-intersecting loops
    try {
      const unkinked = turf.unkinkPolygon(rawPoly);
      if (unkinked.features.length === 1) return unkinked.features[0];
      if (unkinked.features.length > 1) {
        let combined: any = unkinked.features[0];
        for (let i = 1; i < unkinked.features.length; i++) {
          try {
            const unionRes = turf.union(turf.featureCollection([combined, unkinked.features[i]]));
            if (unionRes) combined = unionRes;
          } catch {
            // Keep existing combined
          }
        }
        return combined;
      }
    } catch {
      // unkink failed (e.g. duplicate non-adjacent vertex), rawPoly is still valid geometry
    }

    return rawPoly;
  } catch {
    return null;
  }
}

/**
 * Calculates the floodable area in square meters, subtracting any existing flooded water
 */
export function calculateFloodableAreaSqMeters(
  enclosedCoords: GeoPoint[],
  existingWaterFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
): number {
  const poly = toTurfPolygon(enclosedCoords);
  if (!poly) return 0;

  try {
    const polySqMeters = turf.area(poly);
    if (!existingWaterFeature) {
      return Math.max(0, polySqMeters);
    }

    // Subtract existing water from candidate polygon
    try {
      const diff = turf.difference(turf.featureCollection([poly, existingWaterFeature]));
      if (diff) {
        return Math.max(0, turf.area(diff));
      }
      // If diff is null, poly is completely covered by existingWaterFeature
      return 0;
    } catch {
      // If difference threw a topology exception, fallback to estimated difference
      try {
        const existingArea = turf.area(existingWaterFeature);
        const unionCandidate = turf.union(turf.featureCollection([existingWaterFeature, poly]));
        if (unionCandidate) {
          const unionArea = turf.area(unionCandidate);
          return Math.max(0, unionArea - existingArea);
        }
      } catch {}
      return 0;
    }
  } catch {
    return 0;
  }
}

/**
 * Backward-compatible alias for square miles
 */
export function calculateFloodableAreaSqMiles(
  enclosedCoords: GeoPoint[],
  existingWaterFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
): number {
  return calculateFloodableAreaSqMeters(enclosedCoords, existingWaterFeature) * SQ_METERS_TO_SQ_MILES;
}

/**
 * Computes union of new flooded area with existing water feature
 */
export function unionWater(
  existingWaterFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null,
  newCoords: GeoPoint[]
): {
  newFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  totalAreaSqMeters: number;
  totalAreaSqMiles: number;
} {
  const newPoly = toTurfPolygon(newCoords);
  if (!newPoly) {
    const existingArea = existingWaterFeature ? turf.area(existingWaterFeature) : 0;
    return {
      newFeature: existingWaterFeature,
      totalAreaSqMeters: existingArea,
      totalAreaSqMiles: existingArea * SQ_METERS_TO_SQ_MILES,
    };
  }

  if (!existingWaterFeature) {
    const area = turf.area(newPoly);
    return {
      newFeature: newPoly,
      totalAreaSqMeters: area,
      totalAreaSqMiles: area * SQ_METERS_TO_SQ_MILES,
    };
  }

  try {
    const unionRes = turf.union(turf.featureCollection([existingWaterFeature, newPoly]));
    if (unionRes) {
      const area = turf.area(unionRes);
      return {
        newFeature: unionRes as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
        totalAreaSqMeters: area,
        totalAreaSqMiles: area * SQ_METERS_TO_SQ_MILES,
      };
    }
  } catch {
    // If union fails due to precision/topology, combine into MultiPolygon or sum areas
    try {
      const combinedArea = turf.area(existingWaterFeature) + turf.area(newPoly);
      return {
        newFeature: existingWaterFeature,
        totalAreaSqMeters: combinedArea,
        totalAreaSqMiles: combinedArea * SQ_METERS_TO_SQ_MILES,
      };
    } catch {
      // Fallback to existing
    }
  }

  const fallbackArea = turf.area(existingWaterFeature);
  return {
    newFeature: existingWaterFeature,
    totalAreaSqMeters: fallbackArea,
    totalAreaSqMiles: fallbackArea * SQ_METERS_TO_SQ_MILES,
  };
}

/**
 * Calculates supply ship position along perimeter arc between start of path and current user position.
 * Supports direct progress (0 to 1) and isForward direction for smooth uninterrupted continuation after flooding.
 */
export function calculateSupplyShipState(
  startPt: GeoPoint,
  currentPt: GeoPoint,
  progressOrTime: number,
  isForwardOpt?: boolean,
  shipHeadingDeg: number = 45
): {
  position: GeoPoint;
  heading: number;
  progress: number;
  isForward: boolean;
} {
  let progress: number;
  let isForward: boolean;

  if (isForwardOpt !== undefined) {
    progress = Math.max(0, Math.min(1, progressOrTime));
    isForward = isForwardOpt;
  } else {
    const cycleMs = 30000; // 15s forward, 15s backward = 30s loop
    const elapsedInCycle = progressOrTime % cycleMs;
    isForward = elapsedInCycle < 15000;
    progress = isForward
      ? elapsedInCycle / 15000
      : (30000 - elapsedInCycle) / 15000;
  }

  const chordDist = getDistanceMeters(startPt, currentPt);

  // Compute bearing and outward apex point
  const bearing = chordDist >= 10 ? getBearing(startPt, currentPt) : shipHeadingDeg;
  const perpBearing = (bearing + 90) % 360;

  // Ensure an outward perimeter arc even if user is stationary or just starting
  const offset = Math.max(90, chordDist * 0.38);

  const mid: GeoPoint = {
    lat: (startPt.lat + currentPt.lat) / 2,
    lng: (startPt.lng + currentPt.lng) / 2,
  };
  const apex = getDestinationPoint(mid, perpBearing, offset);

  // Bezier curve point at t = progress
  const t = Math.max(0, Math.min(1, progress));
  const t1 = 1 - t;
  const curLat = t1 * t1 * startPt.lat + 2 * t1 * t * apex.lat + t * t * currentPt.lat;
  const curLng = t1 * t1 * startPt.lng + 2 * t1 * t * apex.lng + t * t * currentPt.lng;

  // Tangent for heading facing direction of travel
  const dt = 0.02;
  const tNext = isForward ? Math.min(1, t + dt) : Math.max(0, t - dt);
  const tNext1 = 1 - tNext;
  const nextLat = tNext1 * tNext1 * startPt.lat + 2 * tNext1 * tNext * apex.lat + tNext * tNext * currentPt.lat;
  const nextLng = tNext1 * tNext1 * startPt.lng + 2 * tNext1 * tNext * apex.lng + tNext * tNext * currentPt.lng;

  let heading = getBearing({ lat: curLat, lng: curLng }, { lat: nextLat, lng: nextLng });
  if (isNaN(heading)) heading = isForward ? bearing : (bearing + 180) % 360;

  return {
    position: { lat: curLat, lng: curLng },
    heading,
    progress,
    isForward,
  };
}

/**
 * Builds the polygon enclosed by the supply ship's 2 dotted lines and the user's path:
 * - Start of path -> along user path to pirate ship
 * - Bow dotted line to supply ship
 * - Stern dotted line back to start of path
 * Includes intelligent subsampling for long paths to ensure high performance on smart glasses.
 */
export function buildSupplyPolygon(
  startPt: GeoPoint,
  userPath: GeoPoint[],
  currentPt: GeoPoint,
  supplyPt: GeoPoint
): GeoPoint[] {
  const ring: GeoPoint[] = [];

  // 1. Path from start to pirate ship
  if (userPath && userPath.length > 0) {
    if (userPath.length <= 60) {
      for (const pt of userPath) {
        ring.push(pt);
      }
    } else {
      // Subsample interior points to max ~50 key vertices for ultra-fast Turf geometry processing
      ring.push(userPath[0]);
      const step = Math.ceil(userPath.length / 45);
      for (let i = step; i < userPath.length - 1; i += step) {
        ring.push(userPath[i]);
      }
      ring.push(userPath[userPath.length - 1]);
    }
  } else {
    ring.push(startPt);
  }

  // Ensure current pirate ship position is at the end of the user path
  const last = ring[ring.length - 1];
  if (!last || Math.abs(last.lat - currentPt.lat) > 1e-6 || Math.abs(last.lng - currentPt.lng) > 1e-6) {
    ring.push(currentPt);
  }

  // 2. Dotted line: Pirate ship to Supply ship bow
  ring.push(supplyPt);

  // 3. Dotted line: Supply ship stern to start of path
  ring.push(startPt);

  return ring;
}

/**
 * Union multiple polygons into existing water feature and compute accurate total score.
 * Applies lightweight polygon simplification to prevent vertex explosion and eliminate lag.
 */
export function unionMultipleWater(
  existingWaterFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null,
  polygonCoordsList: GeoPoint[][]
): {
  newFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  totalAreaSqMeters: number;
  totalAreaSqMiles: number;
} {
  let currentFeature = existingWaterFeature;
  for (const coords of polygonCoordsList) {
    if (coords && coords.length >= 3) {
      const res = unionWater(currentFeature, coords);
      currentFeature = res.newFeature;
    }
  }

  // Simplify cumulative feature to remove collinear/micro-redundant vertices for silky smooth rendering
  if (currentFeature) {
    try {
      const simplified = turf.simplify(currentFeature, {
        tolerance: 0.00002, // ~2.2m tolerance preserves full outline fidelity while pruning 70%+ vertices
        highQuality: false,
        mutate: false,
      });
      if (simplified && (simplified.geometry.type === 'Polygon' || simplified.geometry.type === 'MultiPolygon')) {
        currentFeature = simplified as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
      }
    } catch {
      // Keep unsimplified if simplification fails
    }
  }

  const totalAreaMeters = currentFeature
    ? turf.area(currentFeature)
    : 0;

  return {
    newFeature: currentFeature,
    totalAreaSqMeters: Math.max(0, totalAreaMeters),
    totalAreaSqMiles: Math.max(0, totalAreaMeters * SQ_METERS_TO_SQ_MILES),
  };
}
