import type { AgentStatus } from '@/shared/domain';

export type OfficeAnimation =
  | 'idle' | 'thinking' | 'working' | 'researching' | 'walking' | 'reviewing'
  | 'waiting' | 'error' | 'complete' | 'blocked' | 'offline' | 'approving';

export type OfficeDirection = 'up' | 'down' | 'left' | 'right';

export interface SpriteFrame {
  index: number;
  durationMs: number;
}

export interface AnimationSpec {
  frames: readonly SpriteFrame[];
  loop: boolean;
}

const IDLE: AnimationSpec = {
  frames: [{ index: 0, durationMs: 420 }, { index: 1, durationMs: 420 }, { index: 2, durationMs: 420 }, { index: 1, durationMs: 420 }],
  loop: true,
};
const WALK: AnimationSpec = {
  frames: [{ index: 0, durationMs: 120 }, { index: 1, durationMs: 120 }, { index: 2, durationMs: 120 }, { index: 1, durationMs: 120 }],
  loop: true,
};
const TYPE: AnimationSpec = {
  frames: [{ index: 0, durationMs: 180 }, { index: 1, durationMs: 180 }, { index: 2, durationMs: 180 }, { index: 1, durationMs: 180 }],
  loop: true,
};
const THINK: AnimationSpec = {
  frames: [{ index: 0, durationMs: 360 }, { index: 1, durationMs: 360 }, { index: 2, durationMs: 360 }],
  loop: true,
};
const REVIEW: AnimationSpec = {
  frames: [{ index: 0, durationMs: 220 }, { index: 1, durationMs: 220 }, { index: 2, durationMs: 220 }, { index: 3, durationMs: 220 }],
  loop: true,
};
const ONE_SHOT: AnimationSpec = {
  frames: [{ index: 0, durationMs: 120 }, { index: 1, durationMs: 160 }, { index: 2, durationMs: 220 }],
  loop: false,
};

export const OFFICE_ANIMATIONS: Record<OfficeAnimation, AnimationSpec> = {
  idle: IDLE, thinking: THINK, working: TYPE, researching: TYPE, walking: WALK,
  reviewing: REVIEW, waiting: IDLE, error: ONE_SHOT, complete: ONE_SHOT,
  blocked: THINK, offline: { frames: [{ index: 0, durationMs: 1000 }], loop: false },
  approving: REVIEW,
};

export function getOfficeAnimation(status: AgentStatus, style: string, moving = false): OfficeAnimation {
  if (moving) return 'walking';
  switch (status) {
    case 'WORKING': return style === 'researcher' ? 'researching' : 'working';
    case 'THINKING': return 'thinking';
    case 'REVIEWING': return 'reviewing';
    case 'WAITING': return 'waiting';
    case 'ERROR': return 'error';
    case 'BLOCKED': return 'blocked';
    case 'OFFLINE': return 'offline';
    case 'ONLINE':
    default: return 'idle';
  }
}

export function getSpriteFrame(animation: OfficeAnimation, elapsedMs: number, reducedMotion = false): number {
  const spec = OFFICE_ANIMATIONS[animation];
  if (reducedMotion || spec.frames.length === 1) return spec.frames[0].index;
  const total = spec.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  const time = spec.loop ? elapsedMs % total : Math.min(elapsedMs, total - 1);
  let cursor = 0;
  for (const frame of spec.frames) {
    cursor += frame.durationMs;
    if (time < cursor) return frame.index;
  }
  return spec.frames[spec.frames.length - 1].index;
}

export function getDirection(dx: number, dy: number): OfficeDirection {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}
