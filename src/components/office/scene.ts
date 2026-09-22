/**
 * AI Office — procedural top-down pixel-art scene.
 *
 * RULE: the office decides nothing. Every animation is a pure function of
 * `agent.status` (the orchestrator's AgentState), real tasks and real message
 * events. `Claude.state = WORKING` → typing + code on screen; OFFLINE → empty
 * chair; and so on. No timers here ever change what an agent "is doing".
 *
 * Everything is drawn with fillRect on a world-resolution buffer (1 world
 * unit = 1 pixel) and then scaled up with smoothing disabled, so it stays
 * crisp at any zoom. No image assets, no external services.
 *
 * The scene is a VIEW of real state: each desk belongs to a real agent, the
 * character animation follows the agent's live status, monitors show what
 * that status means, the whiteboard lists the real active tasks and paper
 * planes fly only when the orchestrator routes a real message.
 */
import { drawText, textWidth } from './pixelfont';
import type { AgentStatus, TaskStatus } from '@/shared/domain';

export const WORLD = { w: 832, h: 512 };

export interface OfficeAgent {
  id: string;
  slug: string;
  name: string;
  color: string;
  status: AgentStatus;
  style: string; // builder | reviewer | researcher | generic
  paused: boolean;
  simulated: boolean;
}
export interface OfficeTask {
  key: string;
  status: TaskStatus;
  color: string; // assignee colour
}
export interface OfficeFlight {
  id: string;
  from: string; // agent id | 'moderator' | 'system'
  to: string[];
  type: string;
  at: number; // ms timestamp
}
export interface Point {
  x: number;
  y: number;
}
export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
  seat: Point;
}
export interface Layout {
  slots: Map<string, Slot>;
  moderator: Point;
  moderatorRect: { x: number; y: number; w: number; h: number };
  server: Point;
}

/* ───────────────────────────── helpers */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
function mix(hex: string, other: string, t: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(other.slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

export const STATUS_HEX: Record<AgentStatus, string> = {
  ONLINE: '#5fbf8a',
  WORKING: '#e8b04a',
  THINKING: '#a78bfa',
  WAITING: '#6fb3d9',
  REVIEWING: '#4fc1b5',
  ERROR: '#ef6b6b',
  OFFLINE: '#4b5566',
  BLOCKED: '#e08a3c',
};
const TASK_HEX: Partial<Record<TaskStatus, string>> = {
  OPEN: '#8b97a8',
  PLANNING: '#a78bfa',
  IN_PROGRESS: '#e8b04a',
  WAITING_AGENT: '#6fb3d9',
  WAITING_REVIEW: '#4fc1b5',
  WAITING_USER: '#f2b544',
  BLOCKED: '#e08a3c',
};
const MSG_HEX: Record<string, string> = {
  TASK: '#f2b544',
  HANDOFF: '#6fb3d9',
  REVIEW: '#4fc1b5',
  RESULT: '#5fbf8a',
  ERROR: '#ef6b6b',
  WARNING: '#e08a3c',
  APPROVAL_REQUEST: '#f2b544',
  COMMAND: '#8b97a8',
};

/* ───────────────────────────── layout */
const SLOT_POS: Point[] = [
  { x: 40, y: 92 },
  { x: 216, y: 92 },
  { x: 392, y: 92 },
  { x: 40, y: 236 },
  { x: 216, y: 236 },
  { x: 392, y: 236 },
  { x: 216, y: 372 },
  { x: 392, y: 372 },
];
const SLOT_W = 168;
const SLOT_H = 128;

export function computeLayout(agents: OfficeAgent[]): Layout {
  const slots = new Map<string, Slot>();
  agents.slice(0, SLOT_POS.length).forEach((a, i) => {
    const p = SLOT_POS[i];
    slots.set(a.id, { x: p.x, y: p.y, w: SLOT_W, h: SLOT_H, seat: { x: p.x + SLOT_W / 2, y: p.y + 70 } });
  });
  return {
    slots,
    moderator: { x: 700, y: 214 },
    moderatorRect: { x: 612, y: 150, w: 176, h: 120 },
    server: { x: 790, y: 90 },
  };
}

export function hitTest(layout: Layout, x: number, y: number): string | null {
  for (const [id, s] of layout.slots) if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return id;
  const m = layout.moderatorRect;
  if (x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h) return 'moderator';
  return null;
}

/* ───────────────────────────── static layer */
export function paintStatic(ctx: CanvasRenderingContext2D, layout: Layout, agents: OfficeAgent[], hour: number) {
  const R = rng(7);
  const { w, h } = WORLD;
  ctx.clearRect(0, 0, w, h);

  // floor: dark wood planks
  for (let y = 40; y < h; y += 8) {
    const off = ((y / 8) % 2) * 24;
    for (let x = -off; x < w; x += 48) {
      const v = Math.floor(R() * 10) - 5;
      rect(ctx, x, y, 48, 8, shade('#1a1612', v));
      rect(ctx, x, y + 7, 48, 1, '#120f0c');
      rect(ctx, x + 47, y, 1, 8, '#120f0c');
      if (R() < 0.15) rect(ctx, x + 6 + R() * 30, y + 3, 5, 1, shade('#1a1612', 8));
    }
  }

  // kitchen tiles (bottom-left)
  for (let y = 384; y < h - 8; y += 12)
    for (let x = 8; x < 200; x += 12) {
      rect(ctx, x, y, 12, 12, ((x + y) / 12) % 2 ? '#1c2129' : '#171b22');
      rect(ctx, x, y, 12, 1, '#12161c');
    }

  // lounge rug (bottom-right) + agent desk rugs
  roundRug(ctx, 612, 330, 208, 162, '#1d2230', '#252b3b');
  for (const a of agents) {
    const s = layout.slots.get(a.id);
    if (!s) continue;
    rect(ctx, s.x + 6, s.y + 10, s.w - 12, s.h - 14, mix('#15181f', a.color, 0.07));
    rect(ctx, s.x + 6, s.y + 10, s.w - 12, 1, mix('#15181f', a.color, 0.18));
    rect(ctx, s.x + 6, s.y + s.h - 5, s.w - 12, 1, '#0d0f14');
  }

  // floor cables: desks → server corner
  ctx.globalAlpha = 0.8;
  for (const [, s] of layout.slots) {
    const cy = s.y + 44;
    rect(ctx, s.x + 20, cy, 2, s.y + 118 - cy, '#0b0d11');
    rect(ctx, s.x + 20, s.y + 118, 600 - s.x, 2, '#0b0d11');
  }
  rect(ctx, 620, 70, 2, 280, '#0b0d11');
  rect(ctx, 620, 70, 150, 2, '#0b0d11');
  ctx.globalAlpha = 1;

  // walls
  rect(ctx, 0, 0, w, 8, '#0a0c10');
  rect(ctx, 0, 8, w, 30, '#232a36');
  rect(ctx, 0, 36, w, 4, '#171c25'); // baseboard
  for (let x = 0; x < w; x += 32) rect(ctx, x, 8, 1, 28, '#1e2430');
  rect(ctx, 0, 0, 8, h, '#0a0c10');
  rect(ctx, w - 8, 0, 8, h, '#0a0c10');
  rect(ctx, 0, h - 8, w, 8, '#0a0c10');

  // windows with real-time sky
  const night = hour < 7 || hour >= 20;
  const dusk = (hour >= 18 && hour < 20) || (hour >= 6 && hour < 8);
  const skyTop = night ? '#0b1430' : dusk ? '#3b2a4f' : '#3c6ea8';
  const skyBot = night ? '#1b2748' : dusk ? '#c0735a' : '#8fb8de';
  for (const wx of [40, 136, 232, 328]) {
    rect(ctx, wx - 2, 10, 60, 24, '#11151c');
    for (let i = 0; i < 20; i++) rect(ctx, wx, 12 + i, 56, 1, mix(skyTop, skyBot, i / 20));
    // skyline silhouettes
    const r2 = rng(wx);
    for (let bx = wx; bx < wx + 56; bx += 6) {
      const bh = 3 + Math.floor(r2() * 9);
      rect(ctx, bx, 32 - bh, 5, bh, night ? '#0a0f1e' : '#2c3c55');
      if (night) for (let k = 0; k < 2; k++) if (r2() < 0.6) rect(ctx, bx + 1 + Math.floor(r2() * 3), 33 - bh + Math.floor(r2() * bh), 1, 1, '#f2d27a');
    }
    rect(ctx, wx + 27, 12, 2, 20, '#11151c');
    rect(ctx, wx, 21, 56, 1, '#11151c');
  }

  // wall shelves with books (top-left, against wall)
  bookshelf(ctx, 420, 40, 88, R);
  // filing cabinets
  for (const fx of [516, 540]) {
    rect(ctx, fx, 40, 22, 30, '#3a4150');
    rect(ctx, fx, 40, 22, 2, '#4a5263');
    for (let d = 0; d < 3; d++) {
      rect(ctx, fx + 2, 44 + d * 9, 18, 7, '#333a48');
      rect(ctx, fx + 9, 47 + d * 9, 4, 1, '#8b97a8');
    }
  }

  // server corner (top-right)
  for (const sx of [742, 772]) {
    rect(ctx, sx, 44, 26, 72, '#0f1319');
    rect(ctx, sx, 44, 26, 2, '#2a3240');
    for (let u = 0; u < 8; u++) {
      rect(ctx, sx + 2, 48 + u * 8, 22, 6, '#171c24');
      rect(ctx, sx + 3, 50 + u * 8, 10, 1, '#262d38');
    }
    rect(ctx, sx + 2, 116, 22, 3, '#07090d');
  }
  drawText(ctx, 'SRV', 764, 124, '#3b4556');

  // moderator desk (L-shaped console)
  const m = layout.moderatorRect;
  rect(ctx, m.x + 6, m.y + 8, m.w - 12, m.h - 12, '#1b1a14');
  rect(ctx, m.x + 6, m.y + 8, m.w - 12, 1, '#3a321c');
  rect(ctx, m.x + 24, m.y + 26, 128, 30, '#3b3024');
  rect(ctx, m.x + 24, m.y + 52, 128, 4, '#2a2219');
  rect(ctx, m.x + 140, m.y + 26, 18, 56, '#3b3024');
  rect(ctx, m.x + 140, m.y + 78, 18, 4, '#2a2219');

  // meeting table + chairs (lounge)
  circle(ctx, 716, 420, 30, '#3a2f25');
  circle(ctx, 716, 418, 28, '#4a3c2e');
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const cx = 716 + Math.cos(ang) * 44;
    const cy = 420 + Math.sin(ang) * 36;
    rect(ctx, cx - 6, cy - 5, 12, 10, '#2c3444');
    rect(ctx, cx - 6, cy - 5, 12, 2, '#39445a');
  }
  // papers + laptop on table
  rect(ctx, 700, 410, 10, 12, '#d7d2c4');
  rect(ctx, 702, 413, 6, 1, '#8b97a8');
  rect(ctx, 724, 412, 14, 9, '#20252f');

  // kitchen: counter, coffee machine, fridge, water cooler
  rect(ctx, 16, 392, 120, 18, '#2d3440');
  rect(ctx, 16, 392, 120, 3, '#3d4656');
  rect(ctx, 24, 380, 16, 16, '#1a1d22'); // coffee machine
  rect(ctx, 26, 382, 12, 6, '#2b2f36');
  rect(ctx, 30, 390, 4, 3, '#0d0d0d');
  rect(ctx, 50, 386, 8, 8, '#e7e2d6'); // mugs
  rect(ctx, 60, 386, 8, 8, '#c86b4b');
  rect(ctx, 150, 380, 30, 44, '#cfd5dd'); // fridge
  rect(ctx, 150, 380, 30, 2, '#e6ebf0');
  rect(ctx, 150, 398, 30, 1, '#9aa3ae');
  rect(ctx, 175, 386, 2, 8, '#8b97a8');
  rect(ctx, 175, 402, 2, 12, '#8b97a8');
  rect(ctx, 110, 440, 14, 26, '#aebccb'); // water cooler
  rect(ctx, 111, 430, 12, 12, '#4c8fd1');
  rect(ctx, 113, 432, 3, 6, '#7fb2e6');
  // arcade cabinet (game-dev detail)
  rect(ctx, 150, 440, 28, 44, '#2b1d3f');
  rect(ctx, 150, 440, 28, 4, '#4a2f6e');
  rect(ctx, 154, 446, 20, 14, '#0a0a12');
  rect(ctx, 154, 464, 20, 6, '#1d142b');
  rect(ctx, 158, 466, 3, 3, '#ef6b6b');
  rect(ctx, 166, 466, 3, 3, '#5fbf8a');
  // bean bag
  circle(ctx, 60, 468, 14, '#6b3b54');
  circle(ctx, 57, 465, 8, '#7e4964');

  // plants
  for (const [px, py, sz] of [
    [20, 48, 1],
    [398, 48, 0],
    [600, 60, 1],
    [200, 216, 0],
    [376, 216, 0],
    [590, 300, 1],
    [806, 476, 1],
    [196, 476, 0],
  ] as const)
    plant(ctx, px, py, sz === 1, R);

  // trash bins
  rect(ctx, 588, 128, 10, 12, '#2a303b');
  rect(ctx, 588, 128, 10, 2, '#3a4250');

  // wall labels
  drawText(ctx, 'AI COMMAND CENTER', 506, 20, '#4a5568');
  drawText(ctx, 'MOD', m.x + 82, m.y + 44, '#8a7440');
  drawText(ctx, 'LOUNGE', 698, 470, '#3b4556');
  drawText(ctx, 'KITCHEN', 20, 490, '#3b4556');
}

function roundRug(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c1: string, c2: string) {
  rect(ctx, x + 4, y, w - 8, h, c1);
  rect(ctx, x, y + 4, w, h - 8, c1);
  rect(ctx, x + 8, y + 6, w - 16, 1, c2);
  rect(ctx, x + 8, y + h - 7, w - 16, 1, c2);
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: string) {
  ctx.fillStyle = c;
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    ctx.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2, 1);
  }
}

function plant(ctx: CanvasRenderingContext2D, x: number, y: number, big: boolean, R: () => number) {
  const s = big ? 1.4 : 1;
  rect(ctx, x, y + 10 * s, 12 * s, 9 * s, '#6b4a36');
  rect(ctx, x, y + 10 * s, 12 * s, 2, '#825b43');
  const greens = ['#2f6b45', '#3d8657', '#4e9e68', '#27593a'];
  for (let i = 0; i < (big ? 14 : 9); i++) {
    const lx = x + 6 * s + (R() - 0.5) * 16 * s;
    const ly = y + 6 * s + (R() - 0.7) * 14 * s;
    rect(ctx, lx, ly, 3 + R() * 3, 2 + R() * 2, greens[Math.floor(R() * greens.length)]);
  }
}

function bookshelf(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, R: () => number) {
  rect(ctx, x, y, w, 30, '#3a2c20');
  const spines = ['#8b3a3a', '#3a5f8b', '#8b7a3a', '#3a8b62', '#6b3a8b', '#b0a48a', '#2f3a4f', '#8b5a3a'];
  for (const sy of [y + 2, y + 16]) {
    rect(ctx, x + 2, sy + 12, w - 4, 2, '#2a1f16');
    let bx = x + 3;
    while (bx < x + w - 6) {
      const bw = 2 + Math.floor(R() * 3);
      const bh = 8 + Math.floor(R() * 4);
      rect(ctx, bx, sy + 12 - bh, bw, bh, spines[Math.floor(R() * spines.length)]);
      bx += bw + (R() < 0.15 ? 3 : 0);
    }
  }
}

/* ───────────────────────────── dynamic layer */
export interface DynamicInput {
  layout: Layout;
  agents: OfficeAgent[];
  tasks: OfficeTask[];
  flights: OfficeFlight[];
  hoverId: string | null;
  selectedId: string | null;
  now: number; // ms
  t: number; // seconds (animation clock)
  activeCount: number;
  reducedMotion: boolean;
  moderatorName: string;
}

export function paintDynamic(ctx: CanvasRenderingContext2D, d: DynamicInput) {
  const { layout, agents, t } = d;

  // wall clock (real time)
  const date = new Date(d.now);
  rect(ctx, 460, 12, 30, 12, '#10141b');
  drawText(ctx, `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`, 463, 15, '#f2b544');

  // whiteboard with live tasks
  whiteboard(ctx, 600, 9, 128, 26, d.tasks, t);

  // server LEDs: blink faster with more active agents
  const speed = 1 + d.activeCount * 2.5;
  for (const sx of [742, 772])
    for (let u = 0; u < 8; u++) {
      const phase = Math.sin(t * speed + u * 1.7 + sx) > 0.2;
      rect(ctx, sx + 18, 50 + u * 8, 2, 2, phase ? '#5fbf8a' : '#1f3a2a');
      rect(ctx, sx + 21, 50 + u * 8, 2, 2, Math.sin(t * speed * 0.7 + u) > 0.6 ? '#e8b04a' : '#3a2f1a');
    }

  // coffee machine light + arcade screen
  rect(ctx, 36, 384, 2, 2, Math.sin(t * 2) > 0 ? '#ef6b6b' : '#4a1f1f');
  const arc = ['#6b8afd', '#ef6b6b', '#5fbf8a', '#f2b544'];
  for (let i = 0; i < 4; i++) rect(ctx, 156 + i * 4, 448 + ((Math.floor(t * 3) + i) % 4) * 3, 3, 2, arc[(i + Math.floor(t)) % 4]);

  // desks, in draw order (back to front)
  for (const a of agents) {
    const s = layout.slots.get(a.id);
    if (s) desk(ctx, s, a, d);
  }
  moderatorDesk(ctx, layout, d);

  // hover / selection outlines
  for (const [id, s] of layout.slots) {
    if (id === d.selectedId) outline(ctx, s.x + 2, s.y + 4, s.w - 4, s.h - 6, '#f2b544', t);
    else if (id === d.hoverId) outline(ctx, s.x + 2, s.y + 4, s.w - 4, s.h - 6, '#8b97a8', 0);
  }
  const mr = layout.moderatorRect;
  if (d.selectedId === 'moderator') outline(ctx, mr.x + 2, mr.y + 2, mr.w - 4, mr.h - 4, '#f2b544', t);
  else if (d.hoverId === 'moderator') outline(ctx, mr.x + 2, mr.y + 2, mr.w - 4, mr.h - 4, '#8b97a8', 0);

  flights(ctx, d);
}

function outline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string, t: number) {
  const dash = Math.floor(t * 8) % 4;
  ctx.fillStyle = c;
  for (let i = 0; i < w; i += 4) {
    if ((i / 4 + dash) % 2 === 0) {
      ctx.fillRect(x + i, y, 2, 1);
      ctx.fillRect(x + i, y + h, 2, 1);
    }
  }
  for (let i = 0; i < h; i += 4) {
    if ((i / 4 + dash) % 2 === 0) {
      ctx.fillRect(x, y + i, 1, 2);
      ctx.fillRect(x + w, y + i, 1, 2);
    }
  }
}

function whiteboard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tasks: OfficeTask[], t: number) {
  rect(ctx, x - 2, y - 2, w + 4, h + 4, '#8b97a8');
  rect(ctx, x, y, w, h, '#e9edf2');
  drawText(ctx, 'TASKS', x + 3, y + 2, '#5c6779');
  if (!tasks.length) {
    drawText(ctx, 'NO ACTIVE', x + 40, y + 12, '#9aa3ae');
    return;
  }
  tasks.slice(0, 6).forEach((tk, i) => {
    const nx = x + 3 + i * 21;
    const ny = y + 9;
    const c = TASK_HEX[tk.status] ?? '#8b97a8';
    const wiggle = tk.status === 'WAITING_USER' && Math.sin(t * 4) > 0 ? -1 : 0;
    rect(ctx, nx, ny + wiggle, 19, 14, mix('#ffffff', c, 0.55));
    rect(ctx, nx, ny + wiggle, 19, 2, c);
    rect(ctx, nx + 15, ny + 10 + wiggle, 3, 3, tk.color);
    drawText(ctx, tk.key.split('-').pop() ?? '', nx + 2, ny + 5 + wiggle, '#1b1f27');
  });
}

const HAIR = ['#2b2118', '#4a3426', '#b88a5a', '#1b1b24', '#6b4a3a', '#d8d2c4', '#7a2f2f'];
const SKIN = ['#e9c6a5', '#c8956d', '#8d5a3b', '#f1d3b8', '#b07a55'];

function desk(ctx: CanvasRenderingContext2D, s: Slot, a: OfficeAgent, d: DynamicInput) {
  const { t } = d;
  const off = a.status === 'OFFLINE';
  const h = hash(a.slug);
  const dx = s.x + 20;
  const dy = s.y + 22;
  const dw = s.w - 40;

  // desk top
  rect(ctx, dx, dy, dw, 30, '#4a3a2c');
  rect(ctx, dx, dy, dw, 2, '#5c4836');
  rect(ctx, dx, dy + 30, dw, 5, '#33271d');
  rect(ctx, dx + 3, dy + 35, 4, 4, '#241b14');
  rect(ctx, dx + dw - 7, dy + 35, 4, 4, '#241b14');

  // lamp (left) — on unless offline
  rect(ctx, dx + 6, dy + 4, 8, 3, '#2a2f38');
  rect(ctx, dx + 9, dy - 4, 2, 9, '#2a2f38');
  rect(ctx, dx + 5, dy - 7, 10, 4, off ? '#3a3f48' : '#c9a24a');
  if (!off) {
    ctx.globalAlpha = 0.1;
    circle(ctx, dx + 10, dy + 6, 14, '#f7d58a');
    ctx.globalAlpha = 1;
  }

  // monitors by style
  const screens: { x: number; y: number; w: number; h: number }[] = [];
  const cx = s.x + s.w / 2;
  if (a.style === 'reviewer') {
    for (const k of [-1, 0, 1]) screens.push({ x: cx - 13 + k * 30, y: dy - 12 + (k === 0 ? -2 : 0), w: 26, h: 17 });
  } else if (a.style === 'builder') {
    screens.push({ x: cx - 24, y: dy - 14, w: 44, h: 21 });
    screens.push({ x: cx + 28, y: dy + 6, w: 16, h: 10 }); // laptop
  } else {
    screens.push({ x: cx - 16, y: dy - 12, w: 32, h: 19 });
  }
  screens.forEach((sc, i) => {
    rect(ctx, sc.x - 2, sc.y - 2, sc.w + 4, sc.h + 4, '#0d1117');
    if (!(a.style === 'builder' && i === 1)) {
      rect(ctx, sc.x + sc.w / 2 - 2, sc.y + sc.h + 2, 4, 4, '#0d1117');
      rect(ctx, sc.x + sc.w / 2 - 6, sc.y + sc.h + 5, 12, 2, '#161b22');
    } else {
      rect(ctx, sc.x - 3, sc.y + sc.h + 2, sc.w + 6, 3, '#20252f');
    }
    screen(ctx, sc, a, i, t, h, d.reducedMotion);
  });

  // researcher props: books + papers + magnifier
  if (a.style === 'researcher') {
    rect(ctx, dx + dw - 30, dy + 8, 16, 11, '#e6e0d0');
    rect(ctx, dx + dw - 23, dy + 8, 1, 11, '#b8b09a');
    for (let k = 0; k < 4; k++) rect(ctx, dx + dw - 29, dy + 10 + k * 2, 5, 1, '#9aa3ae');
    const flip = !off && ['WORKING', 'THINKING', 'REVIEWING'].includes(a.status) && Math.floor(t * 1.5) % 3 === 0;
    if (flip) rect(ctx, dx + dw - 23, dy + 6, 7, 12, '#f4efe2');
    rect(ctx, dx + dw - 46, dy + 12, 10, 3, '#3a5f8b');
    rect(ctx, dx + dw - 46, dy + 15, 10, 3, '#8b3a3a');
    rect(ctx, dx + dw - 45, dy + 9, 9, 3, '#3a8b62');
  } else {
    // papers
    rect(ctx, dx + dw - 26, dy + 12, 10, 12, '#d7d2c4');
    rect(ctx, dx + dw - 24, dy + 15, 6, 1, '#9aa3ae');
    rect(ctx, dx + dw - 24, dy + 18, 5, 1, '#9aa3ae');
  }
  // keyboard + mouse
  rect(ctx, cx - 14, dy + 20, 28, 6, '#1d222b');
  for (let k = 0; k < 6; k++) rect(ctx, cx - 12 + k * 4.5, dy + 22, 3, 1, '#3a4150');
  rect(ctx, cx + 18, dy + 21, 4, 5, '#1d222b');
  // mug with steam when active
  const mx = dx + dw - 12;
  rect(ctx, mx, dy + 18, 6, 6, h % 2 ? '#e7e2d6' : a.color);
  rect(ctx, mx + 6, dy + 19, 2, 3, h % 2 ? '#e7e2d6' : a.color);
  if (!off && !d.reducedMotion) {
    for (let k = 0; k < 3; k++) {
      const p = (t * 0.8 + k / 3) % 1;
      ctx.globalAlpha = 0.5 * (1 - p);
      rect(ctx, mx + 2 + Math.sin(p * 6 + k) * 1.5, dy + 16 - p * 10, 1, 2, '#c8d0da');
    }
    ctx.globalAlpha = 1;
  }
  // sticky note in agent colour
  rect(ctx, dx + 20, dy + 4, 7, 7, mix('#ffffff', a.color, 0.5));

  // chair + character
  character(ctx, s, a, d, h);

  // nameplate
  const label = a.name.toUpperCase().slice(0, 16);
  const lw = textWidth(label);
  const ny = s.y + s.h - 16;
  rect(ctx, cx - lw / 2 - 4, ny - 2, lw + 14, 9, '#0d1117');
  rect(ctx, cx - lw / 2 - 2, ny + 1, 3, 3, STATUS_HEX[a.status]);
  drawText(ctx, label, cx - lw / 2 + 4, ny, off ? '#5c6779' : a.color);
  // the label is the orchestrator's AgentState verbatim — the office never invents one
  const st = `${a.status}${a.simulated ? ' SIM' : ''}`;
  drawText(ctx, st, cx - textWidth(st) / 2, ny + 9, STATUS_HEX[a.status]);
}

function screen(ctx: CanvasRenderingContext2D, sc: { x: number; y: number; w: number; h: number }, a: OfficeAgent, idx: number, t: number, seed: number, reduced: boolean) {
  const { x, y, w, h } = sc;
  const st = a.status;
  if (st === 'OFFLINE') {
    rect(ctx, x, y, w, h, '#07090c');
    rect(ctx, x + w - 3, y + h - 2, 1, 1, '#2d3b2d');
    return;
  }
  const tt = reduced ? Math.floor(t / 2) * 2 : t;
  const bg = mix('#0b1016', a.color, 0.06);
  rect(ctx, x, y, w, h, bg);
  if (st === 'ERROR') {
    rect(ctx, x, y, w, h, Math.sin(tt * 5) > 0 ? '#3a1216' : '#2a0e11');
    rect(ctx, x + w / 2 - 1, y + 3, 2, h - 9, '#ef6b6b');
    rect(ctx, x + w / 2 - 1, y + h - 4, 2, 2, '#ef6b6b');
    return;
  }
  if (st === 'BLOCKED') {
    for (let i = -h; i < w; i += 6) for (let k = 0; k < h; k++) if (i + k >= 0 && i + k < w) rect(ctx, x + i + k, y + k, 3, 1, '#3a2a12');
    rect(ctx, x + w / 2 - 3, y + h / 2 - 3, 2, 6, '#e08a3c');
    rect(ctx, x + w / 2 + 1, y + h / 2 - 3, 2, 6, '#e08a3c');
    return;
  }
  if (st === 'ONLINE' || st === 'WAITING') {
    // screensaver: drifting agent glyph
    const px = x + 2 + ((Math.sin(tt * 0.6 + idx) + 1) / 2) * (w - 8);
    const py = y + 2 + ((Math.cos(tt * 0.45 + idx) + 1) / 2) * (h - 7);
    rect(ctx, px, py, 4, 4, mix(bg, a.color, 0.7));
    if (st === 'WAITING') {
      rect(ctx, x + 2, y + h - 3, ((tt * 6) % (w - 4)) + 1, 1, '#6fb3d9');
    }
    return;
  }
  if (st === 'THINKING') {
    const n = Math.floor(tt * 3) % 4;
    for (let k = 0; k < 3; k++) rect(ctx, x + w / 2 - 6 + k * 5, y + h / 2 - 1, 3, 3, k < n ? '#a78bfa' : '#2c2540');
    return;
  }
  // WORKING (code) / REVIEWING (diff)
  const r = rng(seed + idx * 99);
  const lines = Math.floor((h - 2) / 3);
  const scroll = Math.floor(tt * (st === 'REVIEWING' ? 3 : 6));
  const palette = st === 'REVIEWING' ? ['#4fc1b5', '#5fbf8a', '#ef6b6b', '#8b97a8'] : ['#6b8afd', '#e8b04a', '#8b97a8', a.color, '#a78bfa'];
  const widths: number[] = [];
  for (let i = 0; i < 64; i++) widths.push(3 + Math.floor(r() * (w - 8)));
  for (let l = 0; l < lines; l++) {
    const idxLine = (l + scroll) % 64;
    const indent = (idxLine % 5) * 2;
    const c = palette[(idxLine * 7 + idx) % palette.length];
    if (st === 'REVIEWING' && idxLine % 4 === 1) rect(ctx, x + 1, y + 1 + l * 3, w - 2, 2, idxLine % 8 === 1 ? '#12302a' : '#351418');
    rect(ctx, x + 2 + indent, y + 1 + l * 3, Math.min(widths[idxLine], w - 4 - indent), 1, c);
  }
  // cursor
  if (st === 'WORKING' && Math.floor(tt * 2) % 2 === 0) rect(ctx, x + 3, y + h - 3, 2, 2, '#dbe2ec');
}

function character(ctx: CanvasRenderingContext2D, s: Slot, a: OfficeAgent, d: DynamicInput, seed: number) {
  const { t } = d;
  const cx = s.x + s.w / 2;
  const cy = s.y + 76;
  const chairC = shade(a.color.length === 7 ? a.color : '#6b7280', -60);
  const off = a.status === 'OFFLINE';
  const hair = HAIR[seed % HAIR.length];
  const skin = SKIN[(seed >> 3) % SKIN.length];
  const shirt = a.color;

  // The chair always remains at the desk. ONLINE/WAITING agents may
  // wander in the nearby aisle as an idle animation; their authoritative
  // state is still unchanged and all working/review activity stays at desk.
  rect(ctx, cx - 11, cy - 4, 22, 14, chairC);
  rect(ctx, cx - 11, cy + 2, 22, 8, chairC);
  rect(ctx, cx - 11, cy + 2, 22, 2, shade(chairC, 25));
  rect(ctx, cx - 1, cy + 10, 2, 6, '#1b1f27');
  rect(ctx, cx - 8, cy + 15, 16, 2, '#1b1f27');

  if (off) return;

  const idle = a.status === 'ONLINE' || a.status === 'WAITING';
  const wander = idle && !d.reducedMotion;
  const walkPhase = t * 0.9 + seed * 0.17;
  const wx = wander ? cx + Math.round(Math.sin(walkPhase) * 34) : cx;
  const wy = wander ? s.y + 91 + Math.round(Math.sin(walkPhase * 0.5) * 4) : cy;
  const walking = wander && Math.abs(Math.cos(walkPhase)) > 0.18;
  const breathe = d.reducedMotion ? 0 : Math.sin(t * 1.6 + seed) > 0.6 ? 1 : 0;

  if (wander) {
    walkingCharacter(ctx, wx, wy, shirt, skin, hair, a.style, walking, walkPhase, seed);
  } else {
    const active = ['WORKING', 'REVIEWING', 'THINKING'].includes(a.status);
    const bob = active && !d.reducedMotion ? Math.floor(t * 6) % 2 : 0;
    const y = cy + breathe;

    const lArm = active && !d.reducedMotion && Math.floor(t * 8) % 2 === 0 ? -1 : 0;
    const rArm = active && !d.reducedMotion && Math.floor(t * 8) % 2 === 1 ? -1 : 0;

    rect(ctx, cx - 10, y - 16 + lArm, 3, 9, shade(shirt, -20));
    rect(ctx, cx + 7, y - 16 + rArm, 3, 9, shade(shirt, -20));
    rect(ctx, cx - 10, y - 18 + lArm, 3, 2, skin);
    rect(ctx, cx + 7, y - 18 + rArm, 3, 2, skin);
    rect(ctx, cx - 8, y - 10, 16, 12, shirt);
    rect(ctx, cx - 7, y - 11, 14, 1, shirt);
    rect(ctx, cx - 1, y - 9, 2, 10, shade(shirt, -25));
    const look = a.status === 'WAITING' && !d.reducedMotion ? Math.round(Math.sin(t * 0.8)) : 0;
    rect(ctx, cx - 2, y - 13, 4, 3, skin);
    rect(ctx, cx - 5 + look, y - 21 - bob, 10, 9, hair);
    rect(ctx, cx - 4 + look, y - 22 - bob, 8, 1, hair);
    if (look !== 0) rect(ctx, look > 0 ? cx + 4 + look : cx - 6 + look, y - 17 - bob, 2, 3, skin);
    // desk chair back in front of a seated agent
    rect(ctx, cx - 11, cy + 2, 22, 8, chairC);
    rect(ctx, cx - 11, cy + 2, 22, 2, shade(chairC, 25));
  }

  bubble(ctx, (wander ? wx : cx) + 11, (wander ? wy : cy) - 36, a, t, d.reducedMotion);
}

function walkingCharacter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  shirt: string,
  skin: string,
  hair: string,
  style: string,
  walking: boolean,
  phase: number,
  seed: number,
) {
  // shadow
  rect(ctx, x - 9, y + 10, 18, 3, '#0b0e13');

  // legs, alternating one pixel for a clear walk cycle
  const step = walking ? (Math.floor(phase * 5) % 2) : 0;
  const legA = step ? 1 : -1;
  const legB = -legA;
  rect(ctx, x - 5 + legA, y + 2, 5, 8, shade(shirt, -28));
  rect(ctx, x + 1 + legB, y + 2, 5, 8, shade(shirt, -35));
  rect(ctx, x - 6 + legA, y + 9, 6, 2, '#242933');
  rect(ctx, x + legB, y + 9, 6, 2, '#242933');

  // body silhouette with style-specific accent
  rect(ctx, x - 8, y - 10, 16, 13, shirt);
  rect(ctx, x - 7, y - 11, 14, 2, shirt);
  if (style === 'reviewer') rect(ctx, x - 10, y - 7, 3, 8, '#4fc1b5');
  if (style === 'researcher') rect(ctx, x + 7, y - 7, 3, 8, '#a78bfa');
  if (style === 'builder') rect(ctx, x - 2, y - 9, 4, 8, shade(shirt, -24));

  // arms swing opposite the legs
  rect(ctx, x - 10 + legB, y - 7, 3, 8, shade(shirt, -20));
  rect(ctx, x + 7 + legA, y - 7, 3, 8, shade(shirt, -20));
  rect(ctx, x - 10 + legB, y + 1, 3, 2, skin);
  rect(ctx, x + 7 + legA, y + 1, 3, 2, skin);

  // head, hair, tiny facial pixel for readability when zoomed
  rect(ctx, x - 5, y - 20, 10, 9, hair);
  rect(ctx, x - 4, y - 21, 8, 1, hair);
  rect(ctx, x - 4, y - 13, 8, 3, skin);
  rect(ctx, x - 3, y - 13, 1, 1, '#20252f');
  rect(ctx, x + 2, y - 13, 1, 1, '#20252f');

  // agent-color badge on the back/head silhouette
  rect(ctx, x - 2, y - 22, 4, 1, mix('#ffffff', shirt, 0.5));

  // tiny status spark for idle agents; it is visual-only and never changes
  // the actual AgentState represented by the office.
  const spark = Math.floor(phase * 2 + seed) % 3;
  if (spark === 0) rect(ctx, x + 11, y - 13, 2, 2, STATUS_HEX.ONLINE);
}

function bubble(ctx: CanvasRenderingContext2D, x: number, y: number, a: OfficeAgent, t: number, reduced: boolean) {
  const st = a.status; // orchestrator's AgentState, verbatim
  if (st === 'ONLINE' || st === 'WORKING') return;
  const float = reduced ? 0 : Math.round(Math.sin(t * 2) * 1);
  const by = y + float;
  rect(ctx, x, by, 15, 11, '#e9edf2');
  rect(ctx, x + 1, by - 1, 13, 1, '#e9edf2');
  rect(ctx, x + 1, by + 11, 13, 1, '#e9edf2');
  rect(ctx, x + 2, by + 12, 3, 2, '#e9edf2');
  const c = STATUS_HEX[st];
  if (st === 'THINKING') {
    const n = reduced ? 3 : (Math.floor(t * 3) % 3) + 1;
    for (let k = 0; k < 3; k++) rect(ctx, x + 3 + k * 4, by + 5, 2, 2, k < n ? c : '#c9ced6');
  } else if (st === 'WAITING') {
    rect(ctx, x + 4, by + 2, 7, 1, c);
    rect(ctx, x + 5, by + 3, 5, 2, c);
    rect(ctx, x + 7, by + 5, 1, 1, c);
    rect(ctx, x + 5, by + 6, 5, 2, c);
    rect(ctx, x + 4, by + 8, 7, 1, c);
  } else if (st === 'REVIEWING') {
    rect(ctx, x + 4, by + 2, 5, 5, c);
    rect(ctx, x + 5, by + 3, 3, 3, '#e9edf2');
    rect(ctx, x + 9, by + 7, 2, 2, c);
  } else if (st === 'ERROR') {
    rect(ctx, x + 7, by + 2, 2, 5, c);
    rect(ctx, x + 7, by + 8, 2, 2, c);
  } else if (st === 'BLOCKED') {
    rect(ctx, x + 5, by + 3, 2, 6, c);
    rect(ctx, x + 9, by + 3, 2, 6, c);
  }
}

function moderatorDesk(ctx: CanvasRenderingContext2D, layout: Layout, d: DynamicInput) {
  const m = layout.moderatorRect;
  const t = d.t;
  // three screens: agents, tasks, approvals
  const scr = [
    { x: m.x + 30, y: m.y + 12, w: 34, h: 18 },
    { x: m.x + 70, y: m.y + 10, w: 38, h: 20 },
    { x: m.x + 114, y: m.y + 12, w: 34, h: 18 },
  ];
  scr.forEach((s, i) => {
    rect(ctx, s.x - 2, s.y - 2, s.w + 4, s.h + 4, '#0d1117');
    rect(ctx, s.x, s.y, s.w, s.h, '#0f1218');
    if (i === 0) {
      d.agents.slice(0, 6).forEach((a, k) => {
        rect(ctx, s.x + 2, s.y + 2 + k * 3, 2, 2, STATUS_HEX[a.status]);
        rect(ctx, s.x + 6, s.y + 2 + k * 3, Math.min(s.w - 8, 6 + a.name.length * 2), 1, mix('#0f1218', a.color, 0.7));
      });
    } else if (i === 1) {
      d.tasks.slice(0, 6).forEach((tk, k) => rect(ctx, s.x + 2, s.y + 2 + k * 3, 8 + ((k * 13) % 24), 1, TASK_HEX[tk.status] ?? '#8b97a8'));
    } else {
      const pending = d.tasks.filter((x) => x.status === 'WAITING_USER').length;
      if (pending) {
        const on = Math.sin(t * 5) > 0;
        rect(ctx, s.x, s.y, s.w, s.h, on ? '#2c2210' : '#1a150b');
        drawText(ctx, `${pending}`, s.x + s.w / 2 - 1, s.y + 7, '#f2b544');
      } else drawText(ctx, 'OK', s.x + 12, s.y + 7, '#5fbf8a');
    }
  });
  // amber lamp
  rect(ctx, m.x + 150, m.y + 30, 6, 6, '#f2b544');
  ctx.globalAlpha = 0.12;
  circle(ctx, m.x + 153, m.y + 33, 16, '#f2b544');
  ctx.globalAlpha = 1;
  // the moderator (you) — amber hoodie
  const cx = layout.moderator.x;
  const cy = m.y + 76;
  const breathe = d.reducedMotion ? 0 : Math.sin(t * 1.3) > 0.6 ? 1 : 0;
  rect(ctx, cx - 10, cy - 4, 20, 14, '#5a4520');
  rect(ctx, cx - 8, cy - 10 + breathe, 16, 12, '#c9962f');
  rect(ctx, cx - 10, cy - 16 + breathe, 3, 9, '#a57a24');
  rect(ctx, cx + 7, cy - 16 + breathe, 3, 9, '#a57a24');
  rect(ctx, cx - 5, cy - 21 + breathe, 10, 9, '#2b2118');
  rect(ctx, cx - 11, cy + 2, 22, 8, '#5a4520');
  rect(ctx, cx - 11, cy + 2, 22, 2, '#7a5f2c');
  drawText(ctx, d.moderatorName.toUpperCase().slice(0, 14), cx - textWidth(d.moderatorName.toUpperCase().slice(0, 14)) / 2, m.y + m.h + 4, '#f2b544');
}

function pointOf(layout: Layout, id: string): Point {
  if (id === 'moderator') return { x: layout.moderator.x, y: layout.moderatorRect.y + 50 };
  if (id === 'system') return layout.server;
  const s = layout.slots.get(id);
  return s ? { x: s.x + s.w / 2, y: s.y + 50 } : layout.server;
}

function flights(ctx: CanvasRenderingContext2D, d: DynamicInput) {
  const DUR = 1400;
  for (const f of d.flights) {
    const age = d.now - f.at;
    if (age < 0 || age > DUR + 700) continue;
    const a = pointOf(d.layout, f.from);
    const color = MSG_HEX[f.type] ?? '#dbe2ec';
    for (const to of f.to) {
      const b = pointOf(d.layout, to);
      if (age <= DUR) {
        const p = age / DUR;
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const arc = Math.min(80, Math.hypot(b.x - a.x, b.y - a.y) * 0.35);
        const x = a.x + (b.x - a.x) * e;
        const y = a.y + (b.y - a.y) * e - Math.sin(Math.PI * e) * arc;
        // trail
        for (let k = 1; k <= 4; k++) {
          const pe = Math.max(0, e - k * 0.035);
          const tx = a.x + (b.x - a.x) * pe;
          const ty = a.y + (b.y - a.y) * pe - Math.sin(Math.PI * pe) * arc;
          ctx.globalAlpha = 0.5 - k * 0.1;
          rect(ctx, tx - 1, ty - 1, 2, 2, color);
        }
        ctx.globalAlpha = 1;
        // envelope
        rect(ctx, x - 5, y - 3, 10, 7, '#e9edf2');
        rect(ctx, x - 5, y - 3, 10, 1, color);
        rect(ctx, x - 3, y - 1, 2, 1, color);
        rect(ctx, x + 1, y - 1, 2, 1, color);
        rect(ctx, x - 1, y, 2, 1, color);
      } else {
        const p = (age - DUR) / 700;
        ctx.globalAlpha = 1 - p;
        const r = 4 + p * 16;
        ctx.fillStyle = color;
        for (let k = 0; k < 24; k++) {
          const ang = (k / 24) * Math.PI * 2;
          ctx.fillRect(Math.round(b.x + Math.cos(ang) * r), Math.round(b.y + Math.sin(ang) * r * 0.7), 1, 1);
        }
        ctx.globalAlpha = 1;
      }
    }
    // speech tag above the sender at departure
    if (age < 1600 && f.from !== 'system') {
      const lbl = f.type.slice(0, 10);
      const w = textWidth(lbl) + 6;
      ctx.globalAlpha = age < 1200 ? 1 : 1 - (age - 1200) / 400;
      rect(ctx, a.x - w / 2, a.y - 64, w, 9, '#0d1117');
      drawText(ctx, lbl, a.x - w / 2 + 3, a.y - 62, color);
      ctx.globalAlpha = 1;
    }
  }
}
