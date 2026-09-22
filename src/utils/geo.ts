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
 * Convert GeoPoint array to turf Polygon feature with self-intersection handling
 */
export function toTurfPolygon(
  coords: GeoPoint[]
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  if (coords.length < 4) return null;

  const turfCoords = coords.map((pt) => [pt.lng, pt.lat]);
  // Ensure closed ring
  const first = turfCoords[0];
  const last = turfCoords[turfCoords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    turfCoords.push([...first]);
  }

  try {
    const rawPoly = turf.polygon([turfCoords]);
    const unkinked = turf.unkinkPolygon(rawPoly);
    if (unkinked.features.length === 0) return null;
    if (unkinked.features.length === 1) return unkinked.features[0];

    // Combine unkinked polygons
    let combined: any = unkinked.features[0];
    for (let i = 1; i < unkinked.features.length; i++) {
      try {
        const unionRes = turf.union(turf.featureCollection([combined, unkinked.features[i]]));
        if (unionRes) combined = unionRes;
      } catch {
        // Continue
      }
    }
    return combined;
  } catch {
    return null;
  }
}

/**
 * Calculates the floodable area in square miles, subtracting any existing flooded water
 */
export function calculateFloodableAreaSqMiles(
  enclosedCoords: GeoPoint[],
  existingWaterFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
): number {
  const poly = toTurfPolygon(enclosedCoords);
  if (!poly) return 0;

  try {
    if (!existingWaterFeature) {
      const sqMeters = turf.area(poly);
      return Math.max(0, sqMeters * SQ_METERS_TO_SQ_MILES);
    }

    // Subtract existing water from candidate polygon
    const diff = turf.difference(turf.featureCollection([poly, existingWaterFeature]));
    if (!diff) return 0;

    const sqMeters = turf.area(diff);
    return Math.max(0, sqMeters * SQ_METERS_TO_SQ_MILES);
  } catch (err) {
    // Fallback simple area if difference encounters topology anomalies
    try {
      const sqMeters = turf.area(poly);
      return Math.max(0, sqMeters * SQ_METERS_TO_SQ_MILES);
    } catch {
      return 0;
    }
  }
}

/**
 * Computes union of new flooded area with existing water feature
 */
export function unionWater(
  existingWaterFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null,
  newCoords: GeoPoint[]
): {
  newFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  totalAreaSqMiles: number;
} {
  const newPoly = toTurfPolygon(newCoords);
  if (!newPoly) {
    return {
      newFeature: existingWaterFeature,
      totalAreaSqMiles: existingWaterFeature
        ? turf.area(existingWaterFeature) * SQ_METERS_TO_SQ_MILES
        : 0,
    };
  }

  if (!existingWaterFeature) {
    return {
      newFeature: newPoly,
      totalAreaSqMiles: turf.area(newPoly) * SQ_METERS_TO_SQ_MILES,
    };
  }

  try {
    const unionRes = turf.union(turf.featureCollection([existingWaterFeature, newPoly]));
    if (unionRes) {
      const area = turf.area(unionRes) * SQ_METERS_TO_SQ_MILES;
      return {
        newFeature: unionRes as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
        totalAreaSqMiles: area,
      };
    }
  } catch {
    // If union fails due to precision, compute combined area estimate
    const combinedArea =
      (turf.area(existingWaterFeature) + turf.area(newPoly)) * SQ_METERS_TO_SQ_MILES;
    return {
      newFeature: existingWaterFeature,
      totalAreaSqMiles: combinedArea,
    };
  }

  return {
    newFeature: existingWaterFeature,
    totalAreaSqMiles: turf.area(existingWaterFeature) * SQ_METERS_TO_SQ_MILES,
  };
}

/**
 * Calculates supply ship position along perimeter arc between start of path and current user position
 */
export function calculateSupplyShipState(
  startPt: GeoPoint,
  currentPt: GeoPoint,
  timeMs: number
): {
  position: GeoPoint;
  heading: number;
  progress: number;
  isForward: boolean;
} {
  const cycleMs = 30000; // 15s forward, 15s backward = 30s loop
  const elapsedInCycle = timeMs % cycleMs;
  const isForward = elapsedInCycle < 15000;
  const progress = isForward
    ? elapsedInCycle / 15000
    : (30000 - elapsedInCycle) / 15000;

  const chordDist = getDistanceMeters(startPt, currentPt);

  if (chordDist < 5) {
    return {
      position: startPt,
      heading: 0,
      progress,
      isForward,
    };
  }

  // Calculate arched outer perimeter point
  const bearing = getBearing(startPt, currentPt);
  const perpBearing = (bearing + 90) % 360;
  const offset = Math.max(30, chordDist * 0.28);
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
  const dt = 0.01;
  const tNext = isForward ? Math.min(1, t + dt) : Math.max(0, t - dt);
  const tNext1 = 1 - tNext;
  const nextLat = tNext1 * tNext1 * startPt.lat + 2 * tNext1 * tNext * apex.lat + tNext * tNext * currentPt.lat;
  const nextLng = tNext1 * tNext1 * startPt.lng + 2 * tNext1 * tNext * apex.lng + tNext * tNext * currentPt.lng;

  let heading = getBearing({ lat: curLat, lng: curLng }, { lat: nextLat, lng: nextLng });
  if (isNaN(heading)) heading = 0;

  return {
    position: { lat: curLat, lng: curLng },
    heading,
    progress,
    isForward,
  };
}

/**
 * Builds the polygon enclosed by the supply ship's 2 black dotted lines and the user's path:
 * - Start of path -> along user path to pirate ship
 * - Bow black dotted line to supply ship
 * - Stern black dotted line back to start of path
 */
export function buildSupplyPolygon(
  startPt: GeoPoint,
  userPath: GeoPoint[],
  currentPt: GeoPoint,
  supplyPt: GeoPoint
): GeoPoint[] {
  const ring: GeoPoint[] = [startPt];
  for (const pt of userPath) {
    ring.push(pt);
  }
  ring.push(currentPt);
  ring.push(supplyPt);
  ring.push(startPt);
  return ring;
}

/**
 * Union multiple polygons into existing water feature and compute accurate total score
 */
export function unionMultipleWater(
  existingWaterFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null,
  polygonCoordsList: GeoPoint[][]
): {
  newFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  totalAreaSqMiles: number;
} {
  let currentFeature = existingWaterFeature;
  for (const coords of polygonCoordsList) {
    if (coords && coords.length >= 3) {
      const res = unionWater(currentFeature, coords);
      currentFeature = res.newFeature;
    }
  }
  return {
    newFeature: currentFeature,
    totalAreaSqMiles: currentFeature
      ? turf.area(currentFeature) * SQ_METERS_TO_SQ_MILES
      : 0,
  };
}
