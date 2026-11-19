import * as turf from '@turf/turf';
import { GeoPoint } from '../types';

const SQ_METERS_TO_SQ_MILES = 3.8610215854245e-7;
const EARTH_RADIUS_M = 6371e3;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Calculates initial bearing from point A to point B in degrees (0..360)
 */
export function getBearing(start: GeoPoint, end: GeoPoint): number {
  const startLat = start.lat * DEG_TO_RAD;
  const startLng = start.lng * DEG_TO_RAD;
  const endLat = end.lat * DEG_TO_RAD;
  const endLng = end.lng * DEG_TO_RAD;

  const dLng = endLng - startLng;
  const y = Math.sin(dLng) * Math.cos(endLat);
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);

  const brng = (Math.atan2(y, x) * 180) / Math.PI;
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
  const delta = distanceMeters / EARTH_RADIUS_M;
  const theta = bearingDeg * DEG_TO_RAD;

  const lat1 = start.lat * DEG_TO_RAD;
  const lng1 = start.lng * DEG_TO_RAD;

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
 * Zero-allocation fast Haversine distance in meters (replaces turf.point allocation churn)
 */
export function getDistanceMeters(p1: GeoPoint, p2: GeoPoint): number {
  const dLat = (p2.lat - p1.lat) * DEG_TO_RAD;
  const dLng = (p2.lng - p1.lng) * DEG_TO_RAD;
  const lat1 = p1.lat * DEG_TO_RAD;
  const lat2 = p2.lat * DEG_TO_RAD;

  const sinDLat = Math.sin(dLat * 0.5);
  const sinDLng = Math.sin(dLng * 0.5);
  const a = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/**
 * Fast perpendicular distance in meters from point `p` to line segment `a -> b`.
 * Uses local equirectangular projection for minimal CPU overhead.
 */
export function pointToSegmentDistanceMeters(
  p: GeoPoint,
  a: GeoPoint,
  b: GeoPoint
): number {
  const cosLat = Math.cos(a.lat * DEG_TO_RAD);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * cosLat;

  const ax = 0;
  const ay = 0;
  const bx = (b.lng - a.lng) * metersPerDegLng;
  const by = (b.lat - a.lat) * metersPerDegLat;
  const px = (p.lng - a.lng) * metersPerDegLng;
  const py = (p.lat - a.lat) * metersPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-6) {
    return Math.hypot(px, py);
  }

  let t = (px * dx + py * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  const projX = t * dx;
  const projY = t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Iterative Ramer-Douglas-Peucker path simplification in meters.
 * Preserves exact endpoints and sharp turns while eliminating collinear straight-line points.
 */
export function simplifyPathRDP(
  points: GeoPoint[],
  toleranceMeters: number = 2.5
): GeoPoint[] {
  if (points.length <= 2) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [startIdx, endIdx] = stack.pop()!;
    if (endIdx - startIdx <= 1) continue;

    let maxDist = 0;
    let maxIdx = -1;
    const startPt = points[startIdx];
    const endPt = points[endIdx];

    for (let i = startIdx + 1; i < endIdx; i++) {
      const dist = pointToSegmentDistanceMeters(points[i], startPt, endPt);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > toleranceMeters && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([startIdx, maxIdx]);
      stack.push([maxIdx, endIdx]);
    }
  }

  const result: GeoPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/**
 * Actively prevents creation and buildup of unneeded track points:
 * 1. Ignores GPS jitter smaller than `minStepMeters` (default 4m).
 * 2. Online collinearity pruning: if the previous point lies within `collinearToleranceMeters`
 *    of the straight line between the point before it and `newPt`, replaces the previous point
 *    in-place instead of growing the array (turns miles of straight driving into 2 points).
 * 3. Hard ceiling compression: if path exceeds `maxPoints`, compresses with RDP.
 */
export function appendOptimizedPoint(
  prev: GeoPoint[],
  newPt: GeoPoint,
  options?: {
    minStepMeters?: number;
    collinearToleranceMeters?: number;
    maxSegmentMeters?: number;
    maxPoints?: number;
  }
): { points: GeoPoint[]; changed: boolean } {
  const minStep = options?.minStepMeters ?? 4.0;
  const collinearTol = options?.collinearToleranceMeters ?? 1.8;
  const maxSegment = options?.maxSegmentMeters ?? 250;
  const maxPoints = options?.maxPoints ?? 300;

  if (prev.length === 0) {
    return { points: [newPt], changed: true };
  }

  const last = prev[prev.length - 1];
  if (getDistanceMeters(last, newPt) < minStep) {
    return { points: prev, changed: false };
  }

  // Online collinearity replacement: replace middle point B if A -> B -> C is essentially straight
  if (prev.length >= 2) {
    const secondToLast = prev[prev.length - 2];
    const dev = pointToSegmentDistanceMeters(last, secondToLast, newPt);
    const segLen = getDistanceMeters(secondToLast, newPt);
    if (dev <= collinearTol && segLen <= maxSegment) {
      const next = prev.slice(0, -1);
      next.push(newPt);
      return { points: next, changed: true };
    }
  }

  let next = [...prev, newPt];
  if (next.length > maxPoints) {
    next = simplifyPathRDP(next, 3.0);
    // Guarantee bounded array even on extreme zig-zags
    if (next.length > maxPoints) {
      next = simplifyPathRDP(next, 6.0);
    }
  }

  return { points: next, changed: true };
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

  for (const pt of scoutPath) {
    ring.push(pt);
  }
  ring.push(scoutCurrent);
  ring.push(userCurrent);

  for (let i = userPathSinceAnchor.length - 1; i >= 0; i--) {
    ring.push(userPathSinceAnchor[i]);
  }

  ring.push(anchor);
  return ring;
}

/**
 * Clean a sequence of GeoPoints into a valid GeoJSON LinearRing:
 * - Drops invalid coordinates
 * - Filters out consecutive duplicate vertices
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

  if (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) {
      ring.pop();
    }
  }

  if (ring.length < 3) return null;

  ring.push([...ring[0]]);
  return ring;
}

/**
 * Convert GeoPoint array to turf Polygon feature.
 * Pass `resolveKinks = false` for fast real-time HUD previews; `true` for exact flood unions.
 */
export function toTurfPolygon(
  coords: GeoPoint[],
  resolveKinks: boolean = true
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  const ring = cleanRing(coords);
  if (!ring) return null;

  try {
    const rawPoly = turf.polygon([ring]);

    if (!resolveKinks) {
      return rawPoly;
    }

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
      // unkink failed, rawPoly is still usable
    }

    return rawPoly;
  } catch {
    return null;
  }
}

/**
 * Fast AABB overlap check between two bounding boxes [minLng, minLat, maxLng, maxLat]
 */
function bboxesOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * Calculates the floodable area in square meters, subtracting any existing flooded water.
 * Skips expensive boolean difference when bounding boxes do not overlap.
 */
export function calculateFloodableAreaSqMeters(
  enclosedCoords: GeoPoint[],
  existingWaterFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null,
  existingWaterBbox?: [number, number, number, number] | null
): number {
  // Use fast path (skip unkinkPolygon) for real-time area estimate
  const poly = toTurfPolygon(enclosedCoords, false);
  if (!poly) return 0;

  try {
    const polySqMeters = turf.area(poly);
    if (!existingWaterFeature) {
      return Math.max(0, polySqMeters);
    }

    // Fast bounding-box rejection: if polygons can't overlap, skip expensive turf.difference
    const waterBox = existingWaterBbox ?? (turf.bbox(existingWaterFeature) as [number, number, number, number]);
    const polyBox = turf.bbox(poly) as [number, number, number, number];
    if (!bboxesOverlap(polyBox, waterBox)) {
      return Math.max(0, polySqMeters);
    }

    try {
      const diff = turf.difference(turf.featureCollection([poly, existingWaterFeature]));
      if (diff) {
        return Math.max(0, turf.area(diff));
      }
      return 0;
    } catch {
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
  const newPoly = toTurfPolygon(newCoords, true);
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
    try {
      const combinedArea = turf.area(existingWaterFeature) + turf.area(newPoly);
      return {
        newFeature: existingWaterFeature,
        totalAreaSqMeters: combinedArea,
        totalAreaSqMiles: combinedArea * SQ_METERS_TO_SQ_MILES,
      };
    } catch {
      // Fallback
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
    const cycleMs = 30000;
    const elapsedInCycle = progressOrTime % cycleMs;
    isForward = elapsedInCycle < 15000;
    progress = isForward
      ? elapsedInCycle / 15000
      : (30000 - elapsedInCycle) / 15000;
  }

  const chordDist = getDistanceMeters(startPt, currentPt);
  const bearing = chordDist >= 10 ? getBearing(startPt, currentPt) : shipHeadingDeg;
  const perpBearing = (bearing + 90) % 360;
  const offset = Math.max(90, chordDist * 0.38);

  const mid: GeoPoint = {
    lat: (startPt.lat + currentPt.lat) / 2,
    lng: (startPt.lng + currentPt.lng) / 2,
  };
  const apex = getDestinationPoint(mid, perpBearing, offset);

  const t = Math.max(0, Math.min(1, progress));
  const t1 = 1 - t;
  const curLat = t1 * t1 * startPt.lat + 2 * t1 * t * apex.lat + t * t * currentPt.lat;
  const curLng = t1 * t1 * startPt.lng + 2 * t1 * t * apex.lng + t * t * currentPt.lng;

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
 * Builds the polygon enclosed by the supply ship's 2 dotted lines and the user's path.
 * Caps interior ring vertices to <= 42 points for minimal memory and fast Turf processing.
 */
export function buildSupplyPolygon(
  startPt: GeoPoint,
  userPath: GeoPoint[],
  currentPt: GeoPoint,
  supplyPt: GeoPoint
): GeoPoint[] {
  const ring: GeoPoint[] = [];

  if (userPath && userPath.length > 0) {
    if (userPath.length <= 42) {
      for (let i = 0; i < userPath.length; i++) {
        ring.push(userPath[i]);
      }
    } else {
      ring.push(userPath[0]);
      const step = Math.ceil(userPath.length / 38);
      for (let i = step; i < userPath.length - 1; i += step) {
        ring.push(userPath[i]);
      }
      ring.push(userPath[userPath.length - 1]);
    }
  } else {
    ring.push(startPt);
  }

  const last = ring[ring.length - 1];
  if (!last || Math.abs(last.lat - currentPt.lat) > 1e-6 || Math.abs(last.lng - currentPt.lng) > 1e-6) {
    ring.push(currentPt);
  }

  ring.push(supplyPt);
  ring.push(startPt);

  return ring;
}

/**
 * Union multiple polygons into existing water feature and compute accurate total score.
 * Applies polygon simplification to prevent vertex explosion across long sessions.
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

  if (currentFeature) {
    try {
      const simplified = turf.simplify(currentFeature, {
        tolerance: 0.000025, // ~2.8m tolerance prunes 75%+ redundant vertices cleanly
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

  const totalAreaMeters = currentFeature ? turf.area(currentFeature) : 0;

  return {
    newFeature: currentFeature,
    totalAreaSqMeters: Math.max(0, totalAreaMeters),
    totalAreaSqMiles: Math.max(0, totalAreaMeters * SQ_METERS_TO_SQ_MILES),
  };
}
