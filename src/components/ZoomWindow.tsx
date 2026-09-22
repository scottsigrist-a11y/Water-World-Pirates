import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ViewMode } from '../types';
import { Compass, Maximize, Crosshair, ChevronLeft, ChevronRight, X } from 'lucide-react';

export const ZOOM_MILES_OPTIONS = [0.5, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200];

interface ZoomWindowProps {
  isOpen: boolean;
  onClose: () => void;
  viewMode: ViewMode;
  onSelectViewMode: (mode: ViewMode) => void;
  zoomMiles: number;
  onSelectZoomMiles: (miles: number) => void;
  focusedRow: number; // 0 = View Mode, 1 = Zoom Dial
  onSetFocusedRow: (row: number) => void;
}

export const ZoomWindow: React.FC<ZoomWindowProps> = ({
  isOpen,
  onClose,
  viewMode,
  onSelectViewMode,
  zoomMiles,
  onSelectZoomMiles,
  focusedRow,
  onSetFocusedRow,
}) => {
  if (!isOpen) return null;

  const currentZoomIndex = ZOOM_MILES_OPTIONS.indexOf(zoomMiles) !== -1
    ? ZOOM_MILES_OPTIONS.indexOf(zoomMiles)
    : 0;

  const handlePrevZoom = () => {
    const nextIdx = (currentZoomIndex - 1 + ZOOM_MILES_OPTIONS.length) % ZOOM_MILES_OPTIONS.length;
    onSelectZoomMiles(ZOOM_MILES_OPTIONS[nextIdx]);
  };

  const handleNextZoom = () => {
    const nextIdx = (currentZoomIndex + 1) % ZOOM_MILES_OPTIONS.length;
    onSelectZoomMiles(ZOOM_MILES_OPTIONS[nextIdx]);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto">
        <motion.div
          initial={{ scale: 0.85, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.85, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="relative w-full max-w-lg bg-neutral-950/95 border-2 border-amber-500/60 rounded-3xl p-6 text-white shadow-[0_0_50px_rgba(245,158,11,0.25)] overflow-hidden flex flex-col gap-5"
        >
          {/* Astrolabe / Radar decorative ring background */}
          <div className="absolute -top-24 -right-24 w-60 h-60 rounded-full border border-amber-500/10 pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-60 h-60 rounded-full border border-cyan-500/10 pointer-events-none" />

          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
            <div className="flex items-center gap-2.5">
              <Compass className="w-6 h-6 text-amber-400 animate-spin" style={{ animationDuration: '20s' }} />
              <div>
                <h2 className="text-sm sm:text-base font-black tracking-[0.2em] uppercase font-['Cinzel'] text-amber-300">
                  Navigation & Zoom Scope
                </h2>
                <p className="text-[10px] text-neutral-400 font-['Rajdhani'] tracking-wider">
                  SWIPE UP/DOWN: SELECT ROW • LEFT/RIGHT: ROTATE SETTING
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white transition"
              title="Close Scope Window"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ROW 0: View Mode Selector ("Center" vs "Full Course") */}
          <div
            onClick={() => onSetFocusedRow(0)}
            className={`p-3.5 rounded-2xl transition-all border cursor-pointer ${
              focusedRow === 0
                ? 'bg-amber-950/40 border-amber-400/80 shadow-[0_0_20px_rgba(245,158,11,0.2)] ring-1 ring-amber-400/50'
                : 'bg-neutral-900/40 border-neutral-800 hover:border-neutral-700'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${focusedRow === 0 ? 'bg-amber-400 animate-ping' : 'bg-neutral-600'}`} />
                View Centering Mode
              </span>
              <span className="text-[10px] text-neutral-400 font-mono">
                {focusedRow === 0 ? 'ACTIVE SELECTION' : 'Tap or swipe down'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectViewMode('center');
                  onSetFocusedRow(0);
                }}
                className={`py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-wider transition-all border ${
                  viewMode === 'center'
                    ? 'bg-cyan-500 text-black border-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.5)] scale-[1.02]'
                    : 'bg-neutral-800/80 text-neutral-300 border-neutral-700 hover:bg-neutral-700'
                }`}
              >
                <Crosshair className="w-4 h-4" />
                <span>Center</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectViewMode('full_course');
                  onSetFocusedRow(0);
                }}
                className={`py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-wider transition-all border ${
                  viewMode === 'full_course'
                    ? 'bg-amber-500 text-black border-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.5)] scale-[1.02]'
                    : 'bg-neutral-800/80 text-neutral-300 border-neutral-700 hover:bg-neutral-700'
                }`}
              >
                <Maximize className="w-4 h-4" />
                <span>Full Course</span>
              </button>
            </div>
            <p className="text-[10px] text-neutral-400 mt-2">
              {viewMode === 'center'
                ? 'Ship stays centered at fixed zoom level.'
                : 'Auto-fits entire nautical trail and perimeter on screen.'}
            </p>
          </div>

          {/* ROW 1: Horizontal Rotational Selector for Zoom Amount (Closest to 200 miles in 20 mi increments) */}
          <div
            onClick={() => onSetFocusedRow(1)}
            className={`p-3.5 rounded-2xl transition-all border cursor-pointer ${
              focusedRow === 1
                ? 'bg-cyan-950/40 border-cyan-400/80 shadow-[0_0_20px_rgba(6,182,212,0.2)] ring-1 ring-cyan-400/50'
                : 'bg-neutral-900/40 border-neutral-800 hover:border-neutral-700'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${focusedRow === 1 ? 'bg-cyan-400 animate-ping' : 'bg-neutral-600'}`} />
                Zoom Scope Span (Rotational)
              </span>
              <span className="text-[10px] text-neutral-400 font-mono">
                {focusedRow === 1 ? 'SWIPE LEFT / RIGHT' : 'Tap or swipe up'}
              </span>
            </div>

            {/* Rotational Selector Carousel */}
            <div className="relative flex items-center justify-between gap-2 py-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrevZoom();
                  onSetFocusedRow(1);
                }}
                className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:bg-cyan-600 text-neutral-300 hover:text-white transition"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              {/* Rotational Dial Cylinder */}
              <div className="flex-1 flex items-center justify-center gap-2 overflow-hidden px-1">
                {[-2, -1, 0, 1, 2].map((offset) => {
                  const idx = (currentZoomIndex + offset + ZOOM_MILES_OPTIONS.length) % ZOOM_MILES_OPTIONS.length;
                  const val = ZOOM_MILES_OPTIONS[idx];
                  const label = val <= 0.5 ? 'Closest' : `${val} mi`;
                  const isCenter = offset === 0;

                  return (
                    <motion.div
                      key={`${offset}-${val}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectZoomMiles(val);
                        onSetFocusedRow(1);
                      }}
                      className={`cursor-pointer transition-all duration-200 select-none text-center ${
                        isCenter
                          ? 'py-2 px-4 rounded-xl bg-cyan-500 text-black font-extrabold text-sm sm:text-base shadow-[0_0_15px_rgba(6,182,212,0.6)] scale-110'
                          : Math.abs(offset) === 1
                          ? 'py-1.5 px-2.5 rounded-lg bg-neutral-800 text-neutral-300 font-bold text-xs opacity-70 hover:opacity-100'
                          : 'hidden sm:block py-1 px-2 rounded bg-neutral-900 text-neutral-500 font-semibold text-[11px] opacity-40'
                      }`}
                    >
                      {label}
                    </motion.div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNextZoom();
                  onSetFocusedRow(1);
                }}
                className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:bg-cyan-600 text-neutral-300 hover:text-white transition"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* Quick-select chips */}
            <div className="flex flex-wrap gap-1.5 mt-2 justify-center">
              {ZOOM_MILES_OPTIONS.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectZoomMiles(val);
                    onSetFocusedRow(1);
                  }}
                  className={`text-[10px] px-2 py-0.5 rounded transition ${
                    val === zoomMiles
                      ? 'bg-cyan-400 text-black font-bold shadow'
                      : 'bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800'
                  }`}
                >
                  {val <= 0.5 ? 'Closest' : `${val}m`}
                </button>
              ))}
            </div>
          </div>

          {/* Footer Controls & Tip */}
          <div className="flex items-center justify-between pt-2 border-t border-neutral-800">
            <span className="text-[10px] text-neutral-400">
              Tip: Swipe all the way up or down to dismiss.
            </span>
            <button
              type="button"
              onClick={onClose}
              className="py-1.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs uppercase tracking-wider transition shadow-[0_0_12px_rgba(245,158,11,0.4)]"
            >
              Done
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
