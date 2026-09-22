'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLive } from '@/lib/client/live';
import { TERMINAL_TASK_STATUSES } from '@/shared/domain';
import { computeLayout, hitTest, paintDynamic, paintStatic, WORLD, type OfficeAgent, type OfficeTask } from './scene';

interface Camera {
  x: number; // world center
  y: number;
  zoom: number; // screen px per world px (before DPR)
}

/**
 * Interactive, real-time pixel office. Camera: wheel/pinch zoom, drag pan,
 * double-click to focus a desk, keyboard (arrows, +/-, 0). Click a desk to
 * select an agent. In `compact` mode it is a non-interactive live preview.
 */
export function OfficeCanvas({
  compact = false,
  selectedId = null,
  onSelect,
  focusRequest,
}: {
  compact?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  focusRequest?: { id: string; n: number } | null;
}) {
  const { snap, flights } = useLive();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Camera>({ x: WORLD.w / 2, y: WORLD.h / 2, zoom: 1 });
  const target = useRef<Camera | null>(null);
  const fitted = useRef(false);
  const lastSize = useRef<{ w: number; h: number } | null>(null);
  const userCamera = useRef(false);
  const hover = useRef<string | null>(null);
  const [cursor, setCursor] = useState('grab');

  const agents: OfficeAgent[] = useMemo(
    () =>
      (snap?.agents ?? []).map((a) => ({
        id: a.id,
        slug: a.slug,
        name: a.name,
        color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : '#94a3b8',
        status: a.status,
        style: a.office_style,
        paused: a.paused,
        simulated: a.simulated,
      })),
    [snap?.agents],
  );
  const tasks: OfficeTask[] = useMemo(() => {
    const colors = new Map((snap?.agents ?? []).map((a) => [a.id, a.color]));
    return (snap?.tasks ?? [])
      .filter((t) => !TERMINAL_TASK_STATUSES.includes(t.status) && t.status !== 'APPROVED')
      .map((t) => ({ key: t.key, status: t.status, color: (t.assigned_agent && colors.get(t.assigned_agent)) || '#8b97a8' }));
  }, [snap?.tasks, snap?.agents]);

  const layout = useMemo(() => computeLayout(agents), [agents]);
  const layoutKey = agents.map((a) => `${a.id}:${a.color}`).join('|');

  // static layer cache (rebuilt when desks change or the hour changes)
  const staticLayer = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const getStatic = useCallback(() => {
    const hour = new Date().getHours();
    const key = `${layoutKey}#${hour}`;
    if (staticLayer.current?.key === key) return staticLayer.current.canvas;
    const c = document.createElement('canvas');
    c.width = WORLD.w;
    c.height = WORLD.h;
    const ctx = c.getContext('2d')!;
    paintStatic(ctx, layout, agents, hour);
    staticLayer.current = { key, canvas: c };
    return c;
  }, [layout, agents, layoutKey]);

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const z = Math.min(el.clientWidth / WORLD.w, el.clientHeight / WORLD.h) * (compact ? 1 : 0.96);
    target.current = { x: WORLD.w / 2, y: WORLD.h / 2, zoom: Math.max(0.2, z) };
  }, [compact]);

  const focus = useCallback(
    (id: string) => {
      const el = wrap.current;
      if (!el) return;
      const s = id === 'moderator' ? { x: layout.moderatorRect.x, y: layout.moderatorRect.y, w: layout.moderatorRect.w, h: layout.moderatorRect.h } : layout.slots.get(id);
      if (!s) return;
      const z = Math.min(el.clientWidth / (s.w * 1.6), el.clientHeight / (s.h * 1.6), 6);
      target.current = { x: s.x + s.w / 2, y: s.y + s.h / 2, zoom: z };
    },
    [layout],
  );

  useEffect(() => {
    if (focusRequest) focus(focusRequest.id);
  }, [focusRequest, focus]);

  // render loop
  const stateRef = useRef({ agents, tasks, layout, flights, selectedId, moderatorName: snap?.me.display_name ?? 'YOU' });
  stateRef.current = { agents, tasks, layout, flights, selectedId, moderatorName: snap?.me.display_name ?? 'YOU' };

  useEffect(() => {
    const cv = canvas.current;
    const el = wrap.current;
    if (!cv || !el) return;
    const world = document.createElement('canvas');
    world.width = WORLD.w;
    world.height = WORLD.h;
    const wctx = world.getContext('2d')!;
    const ctx = cv.getContext('2d')!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = 0;
    const start = performance.now();
    const frameMs = compact ? 1000 / 12 : 1000 / 30;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.max(1, Math.floor(el.clientWidth * dpr));
      cv.height = Math.max(1, Math.floor(el.clientHeight * dpr));
      cv.style.width = `${el.clientWidth}px`;
      cv.style.height = `${el.clientHeight}px`;
      const sizeChanged = !lastSize.current ||
        Math.abs(lastSize.current.w - el.clientWidth) > 8 ||
        Math.abs(lastSize.current.h - el.clientHeight) > 8;
      if (( !fitted.current || (!userCamera.current && sizeChanged) || compact) && el.clientWidth > 0 && el.clientHeight > 0) {
        fit();
        if (target.current) cam.current = { ...target.current };
        fitted.current = true;
      }
      lastSize.current = { w: el.clientWidth, h: el.clientHeight };
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < frameMs) return;
      last = now;
      const s = stateRef.current;
      // ease camera toward target
      if (target.current) {
        const c = cam.current;
        const k = reduced ? 1 : 0.18;
        c.x += (target.current.x - c.x) * k;
        c.y += (target.current.y - c.y) * k;
        c.zoom += (target.current.zoom - c.zoom) * k;
        if (Math.abs(target.current.zoom - c.zoom) < 0.001 && Math.abs(target.current.x - c.x) < 0.1 && Math.abs(target.current.y - c.y) < 0.1) {
          cam.current = { ...target.current };
          target.current = null;
        }
      }
      const t = reduced ? Math.floor((now - start) / 1000) : (now - start) / 1000;
      wctx.drawImage(getStatic(), 0, 0);
      paintDynamic(wctx, {
        layout: s.layout,
        agents: s.agents,
        tasks: s.tasks,
        flights: s.flights,
        hoverId: compact ? null : hover.current,
        selectedId: s.selectedId,
        now: Date.now(),
        t,
        activeCount: s.agents.filter((a) => ['WORKING', 'THINKING', 'REVIEWING'].includes(a.status)).length,
        reducedMotion: reduced,
        moderatorName: s.moderatorName,
      });
      const dpr = cv.width / Math.max(1, el.clientWidth);
      const c = cam.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.imageSmoothingEnabled = false;
      const z = c.zoom * dpr;
      ctx.setTransform(z, 0, 0, z, cv.width / 2 - c.x * z, cv.height / 2 - c.y * z);
      ctx.drawImage(world, 0, 0);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [compact, fit, getStatic]);

  /* ───────────── interaction */
  const toWorld = (clientX: number, clientY: number) => {
    const el = wrap.current!;
    const r = el.getBoundingClientRect();
    const c = cam.current;
    return { x: c.x + (clientX - r.left - r.width / 2) / c.zoom, y: c.y + (clientY - r.top - r.height / 2) / c.zoom };
  };
  const clamp = (c: Camera): Camera => {
    const el = wrap.current;
    const zoom = Math.min(8, Math.max(0.25, c.zoom));
    if (!el) return { ...c, zoom };
    const hw = el.clientWidth / 2 / zoom;
    const hh = el.clientHeight / 2 / zoom;
    const x = WORLD.w <= hw * 2 ? WORLD.w / 2 : Math.min(WORLD.w - hw, Math.max(hw, c.x));
    const y = WORLD.h <= hh * 2 ? WORLD.h / 2 : Math.min(WORLD.h - hh, Math.max(hh, c.y));
    return { x, y, zoom };
  };
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const before = toWorld(clientX, clientY);
    const c = cam.current;
    const zoom = Math.min(8, Math.max(0.25, c.zoom * factor));
    const el = wrap.current!;
    const r = el.getBoundingClientRect();
    const next = { zoom, x: before.x - (clientX - r.left - r.width / 2) / zoom, y: before.y - (clientY - r.top - r.height / 2) / zoom };
    target.current = null;
    cam.current = clamp(next);
  };

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; moved: boolean; pinch?: number } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el || compact) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  if (compact) {
    return (
      <div ref={wrap} className="relative h-full w-full overflow-hidden bg-[#05070a]" aria-label="Vista previa de la AI Office">
        <canvas ref={canvas} className="pixelated block" />
      </div>
    );
  }

  return (
    <div
      ref={wrap}
      className="relative h-full w-full touch-none overflow-hidden bg-[#05070a] outline-none"
      style={{ cursor }}
      tabIndex={0}
      role="application"
      aria-label="AI Office: oficina pixel art interactiva. Arrastra para mover, rueda o pellizco para zoom, clic en un escritorio para ver el agente."
      data-testid="office"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          drag.current = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, moved: true, pinch: Math.hypot(a.x - b.x, a.y - b.y) };
        } else drag.current = { x: e.clientX, y: e.clientY, moved: false };
        setCursor('grabbing');
      }}
      onPointerMove={(e) => {
        const p = pointers.current.get(e.pointerId);
        if (p) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const d = drag.current;
        if (d && pointers.current.size === 2 && d.pinch) {
          const [a, b] = [...pointers.current.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / d.pinch);
          d.pinch = dist;
          return;
        }
        if (d && p) {
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          if (d.moved) {
            const c = cam.current;
            target.current = null;
            userCamera.current = true;
            cam.current = clamp({ ...c, x: c.x - dx / c.zoom, y: c.y - dy / c.zoom });
            d.x = e.clientX;
            d.y = e.clientY;
          }
          return;
        }
        const w = toWorld(e.clientX, e.clientY);
        const h = hitTest(layout, w.x, w.y);
        hover.current = h;
        setCursor(h ? 'pointer' : 'grab');
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        const d = drag.current;
        if (d && !d.moved && pointers.current.size === 0) {
          const w = toWorld(e.clientX, e.clientY);
          const id = hitTest(layout, w.x, w.y);
          onSelect?.(id);
        }
        if (pointers.current.size === 0) drag.current = null;
        setCursor(hover.current ? 'pointer' : 'grab');
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        drag.current = null;
      }}
      onDoubleClick={(e) => {
        const w = toWorld(e.clientX, e.clientY);
        const id = hitTest(layout, w.x, w.y);
        if (id) {
          onSelect?.(id);
          userCamera.current = true;
          focus(id);
        } else zoomAt(e.clientX, e.clientY, 1.6);
      }}
      onKeyDown={(e) => {
        const c = cam.current;
        const step = 40 / c.zoom;
        userCamera.current = true;
        if (e.key === 'ArrowLeft') cam.current = clamp({ ...c, x: c.x - step });
        else if (e.key === 'ArrowRight') cam.current = clamp({ ...c, x: c.x + step });
        else if (e.key === 'ArrowUp') cam.current = clamp({ ...c, y: c.y - step });
        else if (e.key === 'ArrowDown') cam.current = clamp({ ...c, y: c.y + step });
        else if (e.key === '+' || e.key === '=') cam.current = clamp({ ...c, zoom: c.zoom * 1.2 });
        else if (e.key === '-') cam.current = clamp({ ...c, zoom: c.zoom / 1.2 });
        else if (e.key === '0') fit();
        else if (e.key === 'Escape') onSelect?.(null);
        else return;
        e.preventDefault();
      }}
    >
      <canvas ref={canvas} className="pixelated block" />
      <div className="absolute bottom-3 left-3 flex gap-1">
        {[
          { l: '+', f: () => { const el = wrap.current!.getBoundingClientRect(); zoomAt(el.left + el.width / 2, el.top + el.height / 2, 1.3); } },
          { l: '−', f: () => { const el = wrap.current!.getBoundingClientRect(); zoomAt(el.left + el.width / 2, el.top + el.height / 2, 1 / 1.3); } },
          { l: 'Ver todo', f: fit },
        ].map((b) => (
          <button
            key={b.l}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={b.f}
            className="h-8 min-w-8 rounded-md border border-line-strong bg-ink-900/90 px-2 font-mono text-xs text-fg-muted backdrop-blur hover:text-fg"
          >
            {b.l}
          </button>
        ))}
      </div>
      <div className="pointer-events-none absolute right-3 top-3 hidden rounded-md border border-line bg-ink-900/80 px-2 py-1 font-mono text-[10px] text-fg-dim backdrop-blur sm:block">
        arrastrar · rueda/pellizco · doble clic enfoca · 0 = ver todo
      </div>
    </div>
  );
}
