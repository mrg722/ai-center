import type { OfficeAnimation, OfficeDirection } from './animationMachine';
import { getSpriteFrame } from './animationMachine';

export type SpriteKind = 'claude' | 'chatgpt' | 'codex' | 'antigravity' | 'vercel' | 'nvidia' | 'moderator';

export interface SpriteProfile {
  accent: string;
  hair: string;
  skin: string;
  kind?: SpriteKind;
  hat?: string;
  glasses?: boolean;
  logo?: 'vercel' | 'nvidia' | 'chatgpt';
}

export const SPRITE_PROFILES: Record<string, SpriteProfile> = {
  claude: { accent: '#f97316', hair: '#251812', skin: '#e9c6a5', kind: 'claude' },
  chatgpt: { accent: '#f4f4f2', hair: '#d7d7d0', skin: '#d5d9dc', kind: 'chatgpt', logo: 'chatgpt' },
  gpt: { accent: '#f4f4f2', hair: '#d7d7d0', skin: '#d5d9dc', kind: 'chatgpt', logo: 'chatgpt' },
  openai: { accent: '#f4f4f2', hair: '#d7d7d0', skin: '#d5d9dc', kind: 'chatgpt', logo: 'chatgpt' },
  codex: { accent: '#43b883', hair: '#1b1b24', skin: '#c8956d', kind: 'codex' },
  gemini: { accent: '#8b5cf6', hair: '#4a3426', skin: '#f1d3b8', kind: 'antigravity' },
  antigravity: { accent: '#3b82f6', hair: '#17202b', skin: '#e9c6a5', kind: 'antigravity' },
  vercel: { accent: '#f4f4f5', hair: '#15171b', skin: '#cbd0d7', kind: 'vercel', logo: 'vercel' },
  'vercel-ai-gateway': { accent: '#f4f4f5', hair: '#15171b', skin: '#cbd0d7', kind: 'vercel', logo: 'vercel' },
  nvidia: { accent: '#76b900', hair: '#182016', skin: '#9db39a', kind: 'nvidia', logo: 'nvidia' },
  'nvidia-nim': { accent: '#76b900', hair: '#182016', skin: '#9db39a', kind: 'nvidia', logo: 'nvidia' },
  moderator: { accent: '#c9962f', hair: '#241a15', skin: '#e9c6a5', kind: 'moderator', glasses: true },
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

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
    ctx.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2 + 1, 1);
  }
}

export interface OfficeSpriteOptions {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  slug: string;
  shirt: string;
  profile: SpriteProfile;
  style: string;
  direction: OfficeDirection;
  frame: number;
  active: boolean;
  walking: boolean;
}

/**
 * Character art is deliberately authored per entity rather than using one
 * generic human sprite. This keeps the visual identities from the AI Office
 * reference: Claude = orange hood, ChatGPT = white/cyan robot, Antigravity =
 * blue astronaut, Vercel = multicolor robot, NVIDIA = green robot, Martin =
 * glasses/desk lead. The state machine still decides only pose/animation.
 */
export function drawOfficeSprite(options: OfficeSpriteOptions): void {
  const { ctx, x, y, profile, frame, active, walking } = options;
  const kind = profile.kind ?? 'codex';
  const bob = walking ? 0 : frame === 2 ? -1 : 0;
  const px = x;
  const py = y + bob;

  if (kind === 'claude') return drawClaude(ctx, px, py, profile, active, frame);
  if (kind === 'chatgpt') return drawChatGpt(ctx, px, py, profile, active, frame);
  if (kind === 'antigravity') return drawAntigravity(ctx, px, py, profile, active, frame);
  if (kind === 'vercel') return drawVercel(ctx, px, py, profile, active, frame);
  if (kind === 'nvidia') return drawNvidia(ctx, px, py, profile, active, frame);
  if (kind === 'moderator') return drawModerator(ctx, px, py, profile, active, frame);
  return drawCodex(ctx, px, py, profile, active, frame);
}

function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, wide = 18) {
  ctx.globalAlpha = 0.5;
  rect(ctx, x - wide / 2, y + 12, wide, 3, '#090c11');
  ctx.globalAlpha = 1;
}

function drawClaude(ctx: CanvasRenderingContext2D, x: number, y: number, p: SpriteProfile, active: boolean, frame: number) {
  drawShadow(ctx, x, y);
  const orange = p.accent;
  const dark = '#171a20';
  const hood = shade(orange, 12);
  rect(ctx, x - 8, y - 11, 16, 15, orange);
  rect(ctx, x - 10, y - 8, 3, 9, hood);
  rect(ctx, x + 7, y - 8, 3, 9, hood);
  rect(ctx, x - 7, y - 15, 14, 5, hood);
  rect(ctx, x - 5, y - 18, 10, 9, dark);
  rect(ctx, x - 4, y - 17, 8, 6, '#0b0e13');
  rect(ctx, x - 2, y - 14, 1, 1, '#f5f7fa');
  rect(ctx, x + 2, y - 14, 1, 1, '#f5f7fa');
  rect(ctx, x - 7, y + 4, 6, 8, dark);
  rect(ctx, x + 1, y + 4, 6, 8, dark);
  rect(ctx, x - 8, y - 4, 3, 7, shade(orange, -24));
  rect(ctx, x + 5, y - 4, 3, 7, shade(orange, -24));
  rect(ctx, x - 9, y + 2, 4, 2, p.skin);
  rect(ctx, x + 5, y + 2, 4, 2, p.skin);
  if (active) {
    rect(ctx, x - 5, y - 1, 3, 2, '#ffcf73');
    rect(ctx, x + 2, y - 1, 3, 2, '#ffcf73');
  }
  rect(ctx, x - 6, y - 5, 12, 2, shade(orange, 28));
  if (frame % 2 === 0) rect(ctx, x - 3, y + 6, 6, 2, '#f2b04b');
}

function drawChatGpt(ctx: CanvasRenderingContext2D, x: number, y: number, p: SpriteProfile, active: boolean, frame: number) {
  drawShadow(ctx, x, y, 20);
  const white = '#eef1f1';
  const panel = '#cdd4d8';
  const visor = '#10171e';
  const cyan = '#5ee5d1';
  rect(ctx, x - 9, y - 10, 18, 14, white);
  rect(ctx, x - 7, y - 13, 14, 3, white);
  rect(ctx, x - 6, y - 9, 12, 8, visor);
  rect(ctx, x - 4, y - 6, 2, 2, cyan);
  rect(ctx, x + 2, y - 6, 2, 2, cyan);
  rect(ctx, x - 7, y + 3, 14, 12, panel);
  rect(ctx, x - 5, y + 4, 10, 2, '#ffffff');
  rect(ctx, x - 8, y + 5, 3, 7, panel);
  rect(ctx, x + 5, y + 5, 3, 7, panel);
  rect(ctx, x - 6, y + 15, 5, 3, '#7c8790');
  rect(ctx, x + 1, y + 15, 5, 3, '#7c8790');
  rect(ctx, x - 10, y - 5, 2, 6, cyan);
  rect(ctx, x + 8, y - 5, 2, 6, cyan);
  drawChatLogo(ctx, x, y + 8, frame);
  if (active) rect(ctx, x - 4 + (frame % 2) * 4, y + 5, 3, 2, '#7cead8');
}

function drawChatLogo(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number) {
  const c = '#36a879';
  const pts = frame % 2 === 0
    ? [[-3,0],[0,-2],[3,0],[1,3],[-2,2]] as const
    : [[-3,1],[0,-2],[3,1],[1,3],[-2,3]] as const;
  for (const [dx, dy] of pts) rect(ctx, x + dx, y + dy, 2, 2, c);
}

function drawAntigravity(ctx: CanvasRenderingContext2D, x: number, y: number, p: SpriteProfile, active: boolean, frame: number) {
  drawShadow(ctx, x, y, 22);
  const blue = p.accent;
  const visor = '#162230';
  rect(ctx, x - 9, y - 10, 18, 14, '#f1f4f6');
  rect(ctx, x - 8, y - 14, 16, 5, blue);
  rect(ctx, x - 6, y - 11, 12, 7, visor);
  rect(ctx, x - 3, y - 8, 2, 2, '#67c8ff');
  rect(ctx, x + 2, y - 8, 2, 2, '#67c8ff');
  rect(ctx, x - 7, y + 4, 14, 11, '#e8edf0');
  rect(ctx, x - 9, y + 5, 3, 7, blue);
  rect(ctx, x + 6, y + 5, 3, 7, blue);
  rect(ctx, x - 7, y + 15, 5, 3, blue);
  rect(ctx, x + 2, y + 15, 5, 3, blue);
  rect(ctx, x - 6, y + 6, 12, 2, shade(blue, 24));
  rect(ctx, x - 3, y + 9, 6, 2, blue);
  if (active) {
    rect(ctx, x - 5 + (frame % 2) * 6, y + 11, 3, 2, '#ffffff');
    rect(ctx, x - 2, y + 1, 4, 2, blue);
  }
}

function drawVercel(ctx: CanvasRenderingContext2D, x: number, y: number, p: SpriteProfile, active: boolean, frame: number) {
  drawShadow(ctx, x, y, 22);
  const dark = '#242934';
  const colors = ['#ff4d6d', '#ffb347', '#ffe66d', '#5ee58a', '#62b6ff', '#b388ff'];
  rect(ctx, x - 8, y - 10, 16, 13, dark);
  rect(ctx, x - 6, y - 15, 12, 5, '#101318');
  for (let i = 0; i < colors.length; i++) rect(ctx, x - 6 + i * 2, y - 14, 2, 4, colors[(i + frame) % colors.length]);
  rect(ctx, x - 5, y - 12, 3, 2, '#f4f4f5');
  rect(ctx, x + 2, y - 12, 3, 2, '#f4f4f5');
  rect(ctx, x - 7, y + 3, 14, 12, dark);
  rect(ctx, x - 10, y + 4, 3, 8, '#ff4d6d');
  rect(ctx, x + 7, y + 4, 3, 8, '#62b6ff');
  rect(ctx, x - 7, y + 15, 5, 3, '#111318');
  rect(ctx, x + 2, y + 15, 5, 3, '#111318');
  rect(ctx, x - 4, y + 5, 8, 2, '#f4f4f5');
  rect(ctx, x - 2, y + 8, 4, 3, '#f4f4f5');
  if (active) rect(ctx, x - 5 + (frame % 2) * 6, y + 12, 4, 2, colors[(frame + 2) % colors.length]);
}

function drawNvidia(ctx: CanvasRenderingContext2D, x: number, y: number, p: SpriteProfile, active: boolean, frame: number) {
  drawShadow(ctx, x, y, 22);
  const green = p.accent;
  const dark = '#152019';
  rect(ctx, x - 9, y - 10, 18, 14, green);
  rect(ctx, x - 7, y - 14, 14, 5, dark);
  rect(ctx, x - 5, y - 11, 10, 7, '#08100a');
  rect(ctx, x - 3, y - 9, 6, 3, green);
  rect(ctx, x - 2, y - 8, 4, 1, dark);
  rect(ctx, x - 7, y + 4, 14, 12, green);
  rect(ctx, x - 9, y + 5, 3, 7, shade(green, -20));
  rect(ctx, x + 6, y + 5, 3, 7, shade(green, -20));
  rect(ctx, x - 7, y + 16, 5, 3, dark);
  rect(ctx, x + 2, y + 16, 5, 3, dark);
  if (active || frame % 3 === 0) rect(ctx, x - 5, y + 6, 10, 2, dark);
}

function drawModerator(ctx: CanvasRenderingContext2D, x: number, y: number, p: SpriteProfile, active: boolean, frame: number) {
  drawShadow(ctx, x, y, 22);
  const shirt = p.accent;
  rect(ctx, x - 8, y - 10, 16, 13, shirt);
  rect(ctx, x - 10, y - 7, 3, 8, shade(shirt, -18));
  rect(ctx, x + 7, y - 7, 3, 8, shade(shirt, -18));
  rect(ctx, x - 5, y - 21, 10, 10, p.hair);
  rect(ctx, x - 4, y - 13, 8, 4, p.skin);
  rect(ctx, x - 5, y - 14, 4, 2, '#18202b');
  rect(ctx, x + 1, y - 14, 4, 2, '#18202b');
  rect(ctx, x - 1, y - 13, 2, 1, '#18202b');
  rect(ctx, x - 7, y + 3, 5, 8, '#20252f');
  rect(ctx, x + 2, y + 3, 5, 8, '#20252f');
  if (active) rect(ctx, x - 4 + (frame % 2) * 4, y - 2, 3, 2, '#f2b544');
}

function drawCodex(ctx: CanvasRenderingContext2D, x: number, y: number, p: SpriteProfile, active: boolean, frame: number) {
  drawShadow(ctx, x, y, 20);
  const shirt = p.accent;
  rect(ctx, x - 8, y - 10, 16, 13, shirt);
  rect(ctx, x - 10, y - 6, 3, 7, shade(shirt, -18));
  rect(ctx, x + 7, y - 6, 3, 7, shade(shirt, -18));
  rect(ctx, x - 5, y - 20, 10, 9, p.hair);
  rect(ctx, x - 4, y - 12, 8, 3, p.skin);
  rect(ctx, x - 3, y - 11, 1, 1, '#20252f');
  rect(ctx, x + 2, y - 11, 1, 1, '#20252f');
  rect(ctx, x - 7, y + 3, 5, 8, '#20252f');
  rect(ctx, x + 2, y + 3, 5, 8, '#20252f');
  if (active) rect(ctx, x - 5 + (frame % 2) * 5, y - 2, 3, 2, '#dbe2ec');
}
