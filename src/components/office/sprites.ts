import type { OfficeAnimation, OfficeDirection } from './animationMachine';
import { getSpriteFrame } from './animationMachine';

export interface SpriteProfile {
  accent: string;
  hair: string;
  skin: string;
  hat?: string;
  glasses?: boolean;
  logo?: 'vercel' | 'nvidia';
}

export const SPRITE_PROFILES: Record<string, SpriteProfile> = {
  claude: { accent: '#f08a3c', hair: '#3a261b', skin: '#e9c6a5' },
  codex: { accent: '#43b883', hair: '#1b1b24', skin: '#c8956d' },
  gemini: { accent: '#8b5cf6', hair: '#4a3426', skin: '#f1d3b8' },
  antigravity: { accent: '#a78bfa', hair: '#1b1b24', skin: '#e9c6a5' },
  vercel: { accent: '#f4f4f5', hair: '#1b1b24', skin: '#e9c6a5', logo: 'vercel' },
  nvidia: { accent: '#76b900', hair: '#2b2118', skin: '#c8956d', logo: 'nvidia' },
  moderator: { accent: '#c9962f', hair: '#2b2118', skin: '#e9c6a5', glasses: true },
};

export function resolveSpriteProfile(slug: string, fallbackAccent: string): SpriteProfile {
  return SPRITE_PROFILES[slug] ?? { accent: fallbackAccent, hair: '#2b2118', skin: '#e9c6a5' };
}

export function spriteFrame(animation: OfficeAnimation, elapsedMs: number, reducedMotion: boolean): number {
  return getSpriteFrame(animation, elapsedMs, reducedMotion);
}

export function spriteOffset(frame: number, direction: OfficeDirection): { x: number; y: number } {
  const side = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
  const vertical = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
  return { x: side * (frame === 1 ? 1 : frame === 2 ? 2 : 0), y: vertical * (frame === 2 ? 1 : 0) };
}
