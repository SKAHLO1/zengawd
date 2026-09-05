"use client";

import { useEffect, useRef } from "react";

/**
 * Decorative hollow wireframe globe with points orbiting it.
 *
 * Canvas 2D and no dependencies: a WebGL/three.js globe would cost more bundle than the whole app.
 * Purely ornamental, so it is aria-hidden, it renders a single static frame when the visitor asks for
 * reduced motion, and it stops animating when off-screen or on a hidden tab rather than burning battery
 * behind another window.
 */

const LAT_STEP = 20; // degrees between latitude rings
const LON_COUNT = 12; // meridians
const STAR_COUNT = 70;
const TILT = -0.42; // radians, fixed camera tilt so the poles read as poles

type Star = {
  /** orbit radius as a multiple of the globe radius */
  dist: number;
  /** orbit plane inclination */
  inc: number;
  /** longitude of the ascending node */
  node: number;
  phase: number;
  speed: number;
  size: number;
  color: string;
};

type Vec3 = { x: number; y: number; z: number };

/** Rotate about X (tilt), then about Y (spin). Orthographic: z is used only for depth cueing. */
function project(p: Vec3, yaw: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  const ct = Math.cos(TILT);
  const st = Math.sin(TILT);
  return { x: x1, y: p.y * ct - z1 * st, z: p.y * st + z1 * ct };
}

export function GlobeField() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const stars: Star[] = Array.from({ length: STAR_COUNT }, (_, i) => {
      const accent = i % 9 === 0 ? "#2196f3" : i % 13 === 0 ? "#e89b3c" : "#f2ede6";
      return {
        dist: 1.14 + Math.random() * 0.5,
        inc: (Math.random() - 0.5) * 1.5,
        node: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
        speed: 0.12 + Math.random() * 0.28,
        size: 0.7 + Math.random() * 1.1,
        color: accent,
      };
    });

    let width = 0;
    let height = 0;
    let radius = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      radius = Math.min(width, height) * 0.33;
    };

    /** Depth cue: 0 at the far side, 1 at the near side. */
    const depth = (z: number) => (z / radius + 1) / 2;

    const drawRing = (points: Vec3[], yaw: number, base: string) => {
      for (let i = 0; i < points.length - 1; i++) {
        const a = project(points[i]!, yaw);
        const b = project(points[i + 1]!, yaw);
        const d = depth((a.z + b.z) / 2);
        ctx.strokeStyle = base;
        ctx.globalAlpha = 0.06 + d * 0.36;
        ctx.beginPath();
        ctx.moveTo(width / 2 + a.x, height / 2 + a.y);
        ctx.lineTo(width / 2 + b.x, height / 2 + b.y);
        ctx.stroke();
      }
    };

    const latitudes: Vec3[][] = [];
    const meridians: Vec3[][] = [];

    const buildGeometry = () => {
      latitudes.length = 0;
      meridians.length = 0;
      for (let lat = -80; lat <= 80; lat += LAT_STEP) {
        const phi = (lat * Math.PI) / 180;
        const r = Math.cos(phi) * radius;
        const y = Math.sin(phi) * radius;
        const pts: Vec3[] = [];
        for (let t = 0; t <= 64; t++) {
          const th = (t / 64) * Math.PI * 2;
          pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r });
        }
        latitudes.push(pts);
      }
      for (let m = 0; m < LON_COUNT; m++) {
        const th = (m / LON_COUNT) * Math.PI * 2;
        const pts: Vec3[] = [];
        for (let t = 0; t <= 48; t++) {
          const phi = -Math.PI / 2 + (t / 48) * Math.PI;
          const r = Math.cos(phi) * radius;
          pts.push({ x: Math.cos(th) * r, y: Math.sin(phi) * radius, z: Math.sin(th) * r });
        }
        meridians.push(pts);
      }
    };

    const frame = (elapsed: number) => {
      const yaw = elapsed * 0.00011;
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;

      for (const ring of latitudes) drawRing(ring, yaw, "#2196f3");
      for (const mer of meridians) drawRing(mer, yaw, "#2f6f9e");

      // Orbiting points, painted back-to-front so near ones overlap far ones.
      const placed = stars.map((s) => {
        const a = s.phase + elapsed * 0.001 * s.speed;
        const r = radius * s.dist;
        const local: Vec3 = { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r };
        const ci = Math.cos(s.inc);
        const si = Math.sin(s.inc);
        const tilted: Vec3 = { x: local.x, y: local.y * ci - local.z * si, z: local.y * si + local.z * ci };
        const cn = Math.cos(s.node);
        const sn = Math.sin(s.node);
        const oriented: Vec3 = { x: tilted.x * cn + tilted.z * sn, y: tilted.y, z: -tilted.x * sn + tilted.z * cn };
        return { p: project(oriented, yaw), s };
      });
      placed.sort((a, b) => a.p.z - b.p.z);

      for (const { p, s } of placed) {
        const d = depth(p.z);
        ctx.globalAlpha = 0.18 + d * 0.8;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(width / 2 + p.x, height / 2 + p.y, s.size * (0.6 + d * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    let raf = 0;
    let running = false;
    let startedAt = performance.now();
    let pausedAt = 0;

    const loop = (now: number) => {
      frame(now - startedAt);
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running || reduced) return;
      running = true;
      startedAt += performance.now() - (pausedAt || performance.now());
      raf = requestAnimationFrame(loop);
    };

    const stop = () => {
      if (!running) return;
      running = false;
      pausedAt = performance.now();
      cancelAnimationFrame(raf);
    };

    const onResize = () => {
      resize();
      buildGeometry();
      if (reduced || !running) frame(performance.now() - startedAt);
    };

    resize();
    buildGeometry();
    frame(0);

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) (e.isIntersecting ? start : stop)();
    });
    io.observe(canvas);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);

    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="h-full w-full" />;
}
