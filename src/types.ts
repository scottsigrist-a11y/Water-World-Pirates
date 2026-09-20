export interface GeoPoint {
  lat: number;
  lng: number;
}

export type ScoutDirection = 'left' | 'right';

export type ScoutState = 'idle' | 'active' | 'returning';

export interface ScoutBoatInfo {
  state: ScoutState;
  direction: ScoutDirection;
  position: GeoPoint;
  heading: number; // in degrees
  speedMps: number; // meters per second
  path: GeoPoint[];
  returnProgress?: number; // 0 to 1
  returnStartPos?: GeoPoint;
}

export interface AnchorPoint {
  position: GeoPoint;
  timestamp: number;
}

export interface FloodedTerritory {
  id: string;
  coords: GeoPoint[];
  areaSqMiles: number;
  timestamp: number;
  geojson: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
}
