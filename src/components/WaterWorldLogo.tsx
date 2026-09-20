import React from 'react';

export const WaterWorldLogo: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div className={`flex items-center gap-3 select-none pointer-events-auto ${className}`}>
      {/* Flooded Earth Globe Emblem inspired by Waterworld movie intro */}
      <div className="relative w-12 h-12 sm:w-14 sm:h-14 flex-shrink-0 drop-shadow-[0_0_15px_rgba(6,182,212,0.8)]">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          <defs>
            {/* Oceanic Sphere Gradient */}
            <radialGradient id="globeWaterGrad" cx="40%" cy="35%" r="60%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#0284c7" />
              <stop offset="85%" stopColor="#0c4a6e" />
              <stop offset="100%" stopColor="#082f49" />
            </radialGradient>

            {/* Weathered Bronze/Brass Rim Gradient */}
            <linearGradient id="bronzeRim" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="35%" stopColor="#eab308" />
              <stop offset="70%" stopColor="#854d0e" />
              <stop offset="100%" stopColor="#ca8a04" />
            </linearGradient>

            {/* Water Wave Clip */}
            <clipPath id="globeClip">
              <circle cx="50" cy="50" r="42" />
            </clipPath>
          </defs>

          {/* Outer Ancient Mariner Brass Ring with Rivets */}
          <circle cx="50" cy="50" r="48" fill="none" stroke="url(#bronzeRim)" stroke-width="3" opacity="0.9" />
          <circle cx="50" cy="50" r="45" fill="none" stroke="#042f2e" stroke-width="1.5" />
          
          {/* Compass / Astrolabe ticks */}
          <line x1="50" y1="2" x2="50" y2="7" stroke="#fbbf24" stroke-width="2" />
          <line x1="50" y1="93" x2="50" y2="98" stroke="#fbbf24" stroke-width="2" />
          <line x1="2" y1="50" x2="7" y2="50" stroke="#fbbf24" stroke-width="2" />
          <line x1="93" y1="50" x2="98" y2="50" stroke="#fbbf24" stroke-width="2" />

          {/* The Flooded Globe Body */}
          <circle cx="50" cy="50" r="42" fill="url(#globeWaterGrad)" />

          {/* Flooded Earth submerged latitude & longitude grid (Waterworld aesthetic) */}
          <g clipPath="url(#globeClip)" opacity="0.65" stroke="#7dd3fc" stroke-width="1" fill="none">
            {/* Equator & Parallels */}
            <ellipse cx="50" cy="50" rx="42" ry="12" />
            <ellipse cx="50" cy="32" rx="38" ry="9" />
            <ellipse cx="50" cy="68" rx="38" ry="9" />
            {/* Meridians */}
            <ellipse cx="50" cy="50" rx="18" ry="42" />
            <line x1="50" y1="8" x2="50" y2="92" />
            
            {/* Submerged continent fragments / atolls */}
            <path d="M 32 36 Q 42 42 38 48 Q 28 44 32 36 Z" fill="#047857" opacity="0.5" stroke="none" />
            <path d="M 58 45 Q 68 40 72 52 Q 62 58 58 45 Z" fill="#047857" opacity="0.5" stroke="none" />
            <circle cx="48" cy="64" r="2.5" fill="#f59e0b" opacity="0.8" />
          </g>

          {/* Rolling Ocean Wave across lower hemisphere */}
          <g clipPath="url(#globeClip)">
            <path
              d="M 5 62 Q 22 55 40 64 T 75 60 T 95 65 L 95 95 L 5 95 Z"
              fill="#0369a1"
              opacity="0.7"
            />
            <path
              d="M 5 70 Q 25 64 50 72 T 95 68 L 95 95 L 5 95 Z"
              fill="#075985"
              opacity="0.8"
            />
            {/* Wave foam crest */}
            <path
              d="M 5 62 Q 22 55 40 64 T 75 60 T 95 65"
              fill="none"
              stroke="#e0f2fe"
              stroke-width="1.8"
              opacity="0.9"
            />
          </g>

          {/* Glass specular highlight on upper sphere */}
          <ellipse cx="38" cy="26" rx="16" ry="9" fill="#ffffff" opacity="0.25" transform="rotate(-25 38 26)" />
        </svg>
      </div>

      {/* Typography: Iconic Waterworld Movie Chiseled Title */}
      <div className="flex flex-col">
        <div className="relative flex items-center">
          {/* Main Title: Weathered Bronze & Sunken Gold Movie Typography */}
          <h1
            className="font-black text-2xl sm:text-3xl md:text-4xl tracking-[0.25em] uppercase font-['Cinzel'] leading-none text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-400 to-amber-700 drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]"
            style={{
              filter: 'drop-shadow(0 0 10px rgba(245, 158, 11, 0.4)) drop-shadow(0 0 20px rgba(6, 182, 212, 0.4))',
              letterSpacing: '0.28em',
              textShadow: '0 1px 0 #fff, 0 2px 4px #000, 0 4px 8px #042f2e',
            }}
          >
            WATERWORLD
          </h1>
        </div>

        {/* Cinematic Subtitle / Tagline */}
        <div className="flex items-center gap-2 mt-1">
          <div className="h-[1px] w-6 bg-gradient-to-r from-transparent via-cyan-400 to-cyan-500 opacity-80" />
          <span className="text-[9px] sm:text-[10px] font-extrabold tracking-[0.35em] text-cyan-300 uppercase font-['Rajdhani'] drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
            THE HIGH SEAS
          </span>
          <div className="h-[1px] flex-1 bg-gradient-to-r from-cyan-500 via-cyan-400 to-transparent opacity-80" />
        </div>
      </div>
    </div>
  );
};
