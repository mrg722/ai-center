import type { AgentStatus } from '@/shared/domain';
import type { OfficeAnimation, OfficeDirection } from './animationMachine';
import { getDirection, getOfficeAnimation } from './animationMachine';

export interface OfficePoint { x: number; y: number; }
export interface OfficeMovementEvent { id: string; from: string; to: string[]; type: string; at: number; }
export interface CharacterMotion {
  active: boolean;
  x: number;
  y: number;
  direction: OfficeDirection;
  animation: OfficeAnimation;
  progress: number;
}

const WALK_TYPES = new Set(['HANDOFF', 'REVIEW', 'APPROVAL_REQUEST', 'TASK', 'COMMAND']);
export const WALK_DURATION_MS = 1900;

export function shouldWalkForMessage(type: string): boolean {
  return WALK_TYPES.has(type);
}

function easeInOut(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
}

export function getMovement(
  origin: OfficePoint,
  destination: OfficePoint,
  now: number,
  eventAt: number,
  status: AgentStatus,
  style: string,
  type: string,
): CharacterMotion {
  if (!shouldWalkForMessage(type)) {
    return { active: false, x: origin.x, y: origin.y, direction: 'down', animation: getOfficeAnimation(status, style), progress: 0 };
  }
  const raw = (now - eventAt) / WALK_DURATION_MS;
  if (raw < 0 || raw > 1) {
    return { active: false, x: origin.x, y: origin.y, direction: 'down', animation: getOfficeAnimation(status, style), progress: Math.max(0, Math.min(1, raw)) };
  }
  const p = easeInOut(raw);
  const dx = destination.x - origin.x;
  const dy = destination.y - origin.y;
  return { active: true, x: origin.x + dx * p, y: origin.y + dy * p, direction: getDirection(dx, dy), animation: 'walking', progress: p };
}

export interface BotMotion {
  x: number;
  y: number;
  direction: OfficeDirection;
  animation: 'idle' | 'walking' | 'observing' | 'resting';
  targetIndex: number;
}

const BOT_POINTS: readonly OfficePoint[] = [
  { x: 190, y: 430 }, { x: 300, y: 330 }, { x: 470, y: 330 }, { x: 590, y: 290 },
  { x: 680, y: 410 }, { x: 520, y: 440 }, { x: 300, y: 450 },
];

export function getBotMotion(t: number, reducedMotion = false): BotMotion {
  if (reducedMotion) return { x: BOT_POINTS[0].x, y: BOT_POINTS[0].y, direction: 'down', animation: 'resting', targetIndex: 0 };
  const cycle = 28;
  const phase = (t % cycle) / cycle;
  const segmentFloat = phase * BOT_POINTS.length;
  const index = Math.floor(segmentFloat) % BOT_POINTS.length;
  const next = (index + 1) % BOT_POINTS.length;
  const local = segmentFloat - Math.floor(segmentFloat);
  const a = BOT_POINTS[index];
  const b = BOT_POINTS[next];
  if (local < 0.16) return { x: a.x, y: a.y, direction: getDirection(b.x - a.x, b.y - a.y), animation: 'observing', targetIndex: index };
  if (local > 0.88) return { x: b.x, y: b.y, direction: getDirection(b.x - a.x, b.y - a.y), animation: 'resting', targetIndex: next };
  const p = easeInOut((local - 0.16) / 0.72);
  return {
    x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p,
    direction: getDirection(b.x - a.x, b.y - a.y), animation: 'walking', targetIndex: next,
  };
}
