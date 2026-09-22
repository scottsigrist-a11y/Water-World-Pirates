import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Anchor, 
  Navigation, 
  Waves,
  Compass,
  MapPin,
  Ship
} from 'lucide-react';
import { ScoutBoatInfo, AnchorPoint } from '../types';
import { WaterWorldLogo } from './WaterWorldLogo';

interface GlassesHUDProps {
  score: number;
  floodableSqMiles: number;
  supplyFloodableSqMiles: number;
  scoutFloodableSqMiles: number;
  isFlooding: boolean;
  scoutInfo: ScoutBoatInfo | null;
  anchor: AnchorPoint | null;
  currentHeading: number;
  currentSpeedMph: number;
  visibleRadiusMiles: number;
  hasGps: boolean;
  onGrantGps: () => void;
  onOpenZoomWindow: () => void;
  onFlood?: () => void;
}

export const GlassesHUD: React.FC<GlassesHUDProps> = ({
  score,
  floodableSqMiles,
  supplyFloodableSqMiles,
  scoutFloodableSqMiles,
  isFlooding,
  scoutInfo,
  anchor,
  currentHeading,
  currentSpeedMph,
  visibleRadiusMiles,
  hasGps,
  onGrantGps,
  onOpenZoomWindow,
  onFlood,
}) => {
  return (
    <div className="absolute inset-0 pointer-events-none z-[1000] flex flex-col justify-between p-4 md:p-8 select-none">
      {/* Top Bar with Score (Upper Left) and Floodable with Breakout (Upper Right) */}
      <header className="flex items-start justify-between w-full">
        {/* UPPER LEFT: Golden Letters with Black Glow */}
        <div id="hud-score-display" className="pointer-events-auto flex flex-col items-start">
          <div className="hud-score text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-wider flex items-baseline gap-2">
            <span>Score:</span>
            <span className="font-mono text-4xl sm:text-5xl md:text-6xl text-amber-300">
              {score.toFixed(2)}
            </span>
          </div>
          <div className="text-xs sm:text-sm font-bold text-amber-200/80 uppercase tracking-widest pl-1 mt-0.5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
            sq miles flooded
          </div>
        </div>

        {/* TOP CENTER: GPS Status / Prompt if not yet locked */}
        <div className="pointer-events-auto flex flex-col items-center">
          {!hasGps ? (
            <button
              type="button"
              onClick={onGrantGps}
              className="bg-amber-500/90 hover:bg-amber-400 text-black font-bold px-3.5 py-1.5 rounded-full text-xs flex items-center gap-1.5 shadow-[0_0_15px_rgba(245,158,11,0.6)] animate-pulse transition cursor-pointer"
              title="Allow GPS Location on Glasses"
            >
              <MapPin className="w-3.5 h-3.5 text-black" />
              <span>Acquiring Glasses GPS (Tap to allow)</span>
            </button>
          ) : (
            <div className="bg-black/60 backdrop-blur-sm border border-emerald-500/40 px-3 py-1 rounded-full text-[10px] font-mono font-bold text-emerald-300 flex items-center gap-1.5 drop-shadow">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>DEVICE GPS LOCKED</span>
            </div>
          )}
        </div>

        {/* UPPER RIGHT: Large Bold Letters saying Floodable & Breakout */}
        <div
          id="hud-floodable-display"
          onClick={() => onFlood && onFlood()}
          className="pointer-events-auto flex flex-col items-end text-right cursor-pointer group"
          title="Click or Swipe Down to Flood Territory"
        >
          <div className="hud-floodable text-3xl sm:text-4xl md:text-5xl font-black tracking-wider flex items-baseline gap-2 group-hover:scale-105 transition-transform">
            <span>Floodable:</span>
            <span
              className={`font-mono text-4xl sm:text-5xl md:text-6xl transition-colors duration-200 ${
                floodableSqMiles > 0
                  ? 'text-cyan-300 drop-shadow-[0_0_12px_rgba(34,211,238,0.8)]'
                  : 'text-neutral-300'
              }`}
            >
              {floodableSqMiles.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-cyan-400 bg-cyan-950/80 border border-cyan-400/40 px-2 py-0.5 rounded-md uppercase tracking-wider font-bold">
              Swipe Down or Tap to Flood
            </span>
            <span className="text-xs sm:text-sm font-bold text-cyan-100/80 uppercase tracking-widest drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
              sq miles
            </span>
          </div>

          {/* Subtext Breakout: Supply Ship & Scout */}
          <div className="mt-1.5 flex flex-col items-end gap-0.5 text-xs sm:text-[13px] font-mono font-bold bg-black/75 backdrop-blur-md border border-neutral-700/80 px-3 py-1.5 rounded-xl shadow-lg">
            <div className="flex items-center gap-1.5">
              <Ship className="w-3 h-3 text-amber-400" />
              <span className="text-neutral-400">Supply Ship:</span>
              <span className="text-amber-300">{supplyFloodableSqMiles.toFixed(2)} sq mi</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Navigation className="w-3 h-3 text-cyan-400" />
              <span className="text-neutral-400">Scout:</span>
              <span className="text-cyan-300">{scoutFloodableSqMiles.toFixed(2)} sq mi</span>
            </div>
          </div>
        </div>
      </header>

      {/* CENTER: FLOODING Banner (Large Black letters surrounded by white for 1 second) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <AnimatePresence>
          {isFlooding && (
            <motion.div
              id="flooding-banner"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: [0.6, 1.15, 1], opacity: 1 }}
              exit={{ scale: 1.25, opacity: 0 }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
              className="flex flex-col items-center"
            >
              <div className="hud-flooding text-6xl sm:text-8xl md:text-9xl font-black tracking-widest select-none">
                FLOODING
              </div>
              <div className="mt-2 text-white font-bold tracking-widest text-lg sm:text-xl uppercase drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] flex items-center gap-2">
                <Waves className="w-6 h-6 text-cyan-400 animate-pulse" />
                <span>Territory Enclosed</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Status Badges (Scout / Anchor) */}
      <div className="flex flex-col gap-2 items-start pointer-events-none max-w-xs">
        {/* Active Scout Status Badge */}
        {scoutInfo && scoutInfo.state !== 'idle' && (
          <div className="bg-black/80 backdrop-blur-md border border-cyan-400/60 px-3.5 py-1.5 rounded-full flex items-center gap-2 shadow-2xl animate-pulse">
            <Navigation className="w-4 h-4 text-cyan-300" />
            <span className="text-xs font-bold text-cyan-200 tracking-wider">
              {scoutInfo.state === 'returning'
                ? 'SCOUT RETURNING TO SHIP (<1s)...'
                : `SCOUT DEPLOYED (90° ${scoutInfo.direction.toUpperCase()})`}
            </span>
          </div>
        )}

        {/* Anchor Status Badge */}
        {anchor && (
          <div className="bg-black/80 backdrop-blur-md border border-amber-400/60 px-3.5 py-1.5 rounded-full flex items-center gap-2 shadow-2xl">
            <Anchor className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-amber-200 tracking-wider">
              ANCHOR DROPPED — SWIPE DOWN TO ENCLOSE & FLOOD
            </span>
          </div>
        )}
      </div>

      {/* Bottom Footer: Water World Movie Logo, Navigation Scope Trigger, and Subtle Maritime Compass */}
      <footer className="w-full flex items-end justify-between gap-4">
        {/* Left: Authentic Water World Movie Logo */}
        <div className="pointer-events-auto bg-black/75 backdrop-blur-md border border-amber-500/30 rounded-2xl px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.85)] flex items-center gap-4">
          <WaterWorldLogo />
          
          <div className="hidden sm:flex items-center gap-3 pl-3 border-l border-neutral-800 text-xs text-neutral-400 font-mono">
            <div className="flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-amber-400" />
              <span className="text-neutral-200 font-bold">{Math.round(currentHeading)}°</span>
            </div>
            <span className="text-neutral-600">•</span>
            <div className="text-emerald-300 font-bold">
              {currentSpeedMph.toFixed(1)} mph
            </div>
            <span className="text-neutral-600">•</span>
            <div className="text-cyan-300">
              ~{Math.round(visibleRadiusMiles)} mi
            </div>
          </div>
        </div>

        {/* Right: Quick Scope button or swipe up hint */}
        <button
          type="button"
          onClick={onOpenZoomWindow}
          className="pointer-events-auto bg-black/80 hover:bg-neutral-900 active:bg-amber-600/30 backdrop-blur-md border border-amber-500/40 px-3.5 py-2 rounded-2xl text-amber-300 font-bold text-xs flex items-center gap-2 shadow-xl transition"
          title="Swipe Up or Click for Zoom Scope Window"
        >
          <Compass className="w-4 h-4 text-amber-400" />
          <span>Scope / Zoom (Swipe Up)</span>
        </button>
      </footer>
    </div>
  );
};
