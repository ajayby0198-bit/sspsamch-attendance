import React from 'react';

interface AyurvedicCrestProps {
  className?: string;
}

export const AyurvedicCrest: React.FC<AyurvedicCrestProps> = ({ className = 'w-9 h-9' }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <circle cx="32" cy="32" r="29" stroke="#C6923A" strokeWidth="2" strokeDasharray="3 3" />
    <circle cx="32" cy="32" r="24" fill="#0D281E" stroke="#C6923A" strokeWidth="1.5" />
    {/* Sacred Lotus Petals */}
    <path
      d="M32 45C25 45 21 40 20 35C24 36 28 38 32 45Z"
      fill="#196146"
      stroke="#D4A853"
      strokeWidth="1"
    />
    <path
      d="M32 45C39 45 43 40 44 35C40 36 36 38 32 45Z"
      fill="#196146"
      stroke="#D4A853"
      strokeWidth="1"
    />
    {/* Dhanvantari Kalash */}
    <path
      d="M25 26H39L37 30C40 32.5 40 38.5 36.5 42H27.5C24 38.5 24 32.5 27 30L25 26Z"
      fill="#D4A853"
      stroke="#FFF8E1"
      strokeWidth="1"
    />
    {/* Medicinal Leaf Sprout */}
    <path
      d="M32 25C32 18 36 14 41 13C40 19 37 23 32 25Z"
      fill="#34D399"
    />
    <path
      d="M32 25C32 18 28 14 23 13C24 19 27 23 32 25Z"
      fill="#10B981"
    />
    <path d="M32 26V12" stroke="#FFF8E1" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
