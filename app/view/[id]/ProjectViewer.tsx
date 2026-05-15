"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { sqmmToStroke } from "@/lib/store";

export type ViewerTerminal = {
  id: string;
  fx: number;
  fy: number;
  label: string;
};

export type ViewerTemplate = {
  id: string;
  name: string;
  src: string;
  category?: string;
  terminals: ViewerTerminal[];
};

export type ViewerDevice = {
  id: string;
  templateId: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX?: boolean;
  flipY?: boolean;
};

export type ViewerWire = {
  id: string;
  points: number[];
  color: string;
  thickness: number;
  label?: string;
  layerId?: string;
};

export type ViewerLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  rotation?: number;
};

export type ViewerWireLayer = {
  id: string;
  name: string;
  thickness?: number;
};

type Selection =
  | { kind: "device"; id: string }
  | { kind: "wire"; id: string }
  | null;

const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const TAP_THRESHOLD_PX = 8;
const TAP_THRESHOLD_MS = 350;

function computeBounds(
  devices: ViewerDevice[],
  wires: ViewerWire[],
  labels: ViewerLabel[]
) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const d of devices) {
    // Approximate AABB of rotated rectangle
    const r = (d.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(r));
    const sin = Math.abs(Math.sin(r));
    const bw = d.width * cos + d.height * sin;
    const bh = d.width * sin + d.height * cos;
    minX = Math.min(minX, d.x - bw);
    minY = Math.min(minY, d.y - bh);
    maxX = Math.max(maxX, d.x + bw);
    maxY = Math.max(maxY, d.y + bh);
  }
  for (const w of wires) {
    for (let i = 0; i < w.points.length; i += 2) {
      minX = Math.min(minX, w.points[i]);
      minY = Math.min(minY, w.points[i + 1]);
      maxX = Math.max(maxX, w.points[i]);
      maxY = Math.max(maxY, w.points[i + 1]);
    }
  }
  for (const l of labels) {
    minX = Math.min(minX, l.x);
    minY = Math.min(minY, l.y);
    maxX = Math.max(maxX, l.x + l.fontSize * 4);
    maxY = Math.max(maxY, l.y + l.fontSize);
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return { minX: -200, minY: -200, width: 400, height: 400 };
  }

  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function deviceTransform(d: ViewerDevice) {
  let t = `translate(${d.x} ${d.y}) rotate(${d.rotation})`;
  if (d.flipX) t += ` translate(${d.width} 0) scale(-1 1)`;
  if (d.flipY) t += ` translate(0 ${d.height}) scale(1 -1)`;
  return t;
}

function wireLength(points: number[]) {
  let len = 0;
  for (let i = 2; i < points.length; i += 2) {
    len += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  }
  return len;
}

export default function ProjectViewer({
  templates,
  devices,
  wires,
  labels,
  wireLayers,
}: {
  templates: ViewerTemplate[];
  devices: ViewerDevice[];
  wires: ViewerWire[];
  labels: ViewerLabel[];
  wireLayers: ViewerWireLayer[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [container, setContainer] = useState({ w: 1, h: 1 });
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [selection, setSelection] = useState<Selection>(null);

  const bounds = useMemo(
    () => computeBounds(devices, wires, labels),
    [devices, wires, labels]
  );

  const templateMap = useMemo(() => {
    const m = new Map<string, ViewerTemplate>();
    for (const t of templates) m.set(t.id, t);
    return m;
  }, [templates]);

  const wireLayerMap = useMemo(() => {
    const m = new Map<string, ViewerWireLayer>();
    for (const l of wireLayers) m.set(l.id, l);
    return m;
  }, [wireLayers]);

  // Track container size
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setContainer({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit content on mount / when bounds or container change (only initial / when no interaction yet)
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    if (container.w <= 1 || container.h <= 1) return;
    const pad = 40;
    const scale = Math.min(
      (container.w - pad * 2) / bounds.width,
      (container.h - pad * 2) / bounds.height
    );
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale || 1));
    const cx = bounds.minX + bounds.width / 2;
    const cy = bounds.minY + bounds.height / 2;
    setView({
      x: container.w / 2 - cx * s,
      y: container.h / 2 - cy * s,
      scale: s,
    });
    initRef.current = true;
  }, [bounds, container]);

  const fitToContent = useCallback(() => {
    if (container.w <= 1 || container.h <= 1) return;
    const pad = 40;
    const scale = Math.min(
      (container.w - pad * 2) / bounds.width,
      (container.h - pad * 2) / bounds.height
    );
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale || 1));
    const cx = bounds.minX + bounds.width / 2;
    const cy = bounds.minY + bounds.height / 2;
    setView({
      x: container.w / 2 - cx * s,
      y: container.h / 2 - cy * s,
      scale: s,
    });
  }, [bounds, container]);

  // ---------------- Pointer / touch gestures ----------------
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    mode: "none" | "pan" | "pinch";
    startX: number;
    startY: number;
    startView: { x: number; y: number; scale: number };
    startDist: number;
    startMid: { x: number; y: number };
    moved: boolean;
    startedAt: number;
  }>({
    mode: "none",
    startX: 0,
    startY: 0,
    startView: { x: 0, y: 0, scale: 1 },
    startDist: 0,
    startMid: { x: 0, y: 0 },
    moved: false,
    startedAt: 0,
  });

  const getLocal = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = getLocal(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      gestureRef.current = {
        mode: "pan",
        startX: p.x,
        startY: p.y,
        startView: { ...view },
        startDist: 0,
        startMid: p,
        moved: false,
        startedAt: performance.now(),
      };
    } else if (pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy) || 1;
      gestureRef.current = {
        mode: "pinch",
        startX: 0,
        startY: 0,
        startView: { ...view },
        startDist: dist,
        startMid: {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2,
        },
        moved: true,
        startedAt: performance.now(),
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // buttons===0 means no button is held (hover); clean up and ignore
    if (e.buttons === 0) {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size === 0) gestureRef.current.mode = "none";
      return;
    }
    if (!pointers.current.has(e.pointerId)) return;
    const p = getLocal(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    const g = gestureRef.current;

    if (g.mode === "pan" && pointers.current.size === 1) {
      const dx = p.x - g.startX;
      const dy = p.y - g.startY;
      if (Math.hypot(dx, dy) > TAP_THRESHOLD_PX) g.moved = true;
      setView({
        x: g.startView.x + dx,
        y: g.startView.y + dy,
        scale: g.startView.scale,
      });
    } else if (g.mode === "pinch" && pointers.current.size >= 2) {
      const pts = Array.from(pointers.current.values()).slice(0, 2);
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy) || 1;
      const mid = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
      const ratio = dist / (g.startDist || 1);
      let newScale = g.startView.scale * ratio;
      newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
      // Anchor zoom around the original midpoint in world space
      const worldX = (g.startMid.x - g.startView.x) / g.startView.scale;
      const worldY = (g.startMid.y - g.startView.y) / g.startView.scale;
      setView({
        x: mid.x - worldX * newScale,
        y: mid.y - worldY * newScale,
        scale: newScale,
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2 && gestureRef.current.mode === "pinch") {
      // dropped one finger; if one remains, restart pan from it
      if (pointers.current.size === 1) {
        const remaining = Array.from(pointers.current.values())[0];
        gestureRef.current = {
          mode: "pan",
          startX: remaining.x,
          startY: remaining.y,
          startView: { ...view },
          startDist: 0,
          startMid: remaining,
          moved: true,
          startedAt: performance.now(),
        };
      } else {
        gestureRef.current.mode = "none";
      }
    } else if (pointers.current.size === 0) {
      gestureRef.current.mode = "none";
    }
  };

  // Wheel zoom (desktop)
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const local = getLocal(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newScale = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, view.scale * factor)
    );
    const worldX = (local.x - view.x) / view.scale;
    const worldY = (local.y - view.y) / view.scale;
    setView({
      x: local.x - worldX * newScale,
      y: local.y - worldY * newScale,
      scale: newScale,
    });
  };

  // Helper: only count a click as a "tap" when the gesture didn't drag.
  const wasTap = () => {
    const g = gestureRef.current;
    const dur = performance.now() - g.startedAt;
    return !g.moved && dur < TAP_THRESHOLD_MS;
  };

  const onDeviceTap = (id: string) => {
    if (!wasTap()) return;
    setSelection({ kind: "device", id });
  };
  const onWireTap = (id: string) => {
    if (!wasTap()) return;
    setSelection({ kind: "wire", id });
  };
  const onBackgroundTap = () => {
    if (!wasTap()) return;
    setSelection(null);
  };

  // ---------- Info panel content ----------
  const selectedDevice =
    selection?.kind === "device"
      ? devices.find((d) => d.id === selection.id) ?? null
      : null;
  const selectedTemplate = selectedDevice
    ? templateMap.get(selectedDevice.templateId) ?? null
    : null;
  const selectedWire =
    selection?.kind === "wire"
      ? wires.find((w) => w.id === selection.id) ?? null
      : null;
  const selectedWireLayer =
    selectedWire && selectedWire.layerId
      ? wireLayerMap.get(selectedWire.layerId) ?? null
      : null;

  // Render
  const transform = `translate(${view.x} ${view.y}) scale(${view.scale})`;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-zinc-100"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <svg
        ref={svgRef}
        width={container.w}
        height={container.h}
        viewBox={`0 0 ${container.w} ${container.h}`}
        className="block h-full w-full"
      >
        {/* Background tap target */}
        <rect
          x={0}
          y={0}
          width={container.w}
          height={container.h}
          fill="#fafafa"
          onPointerUp={onBackgroundTap}
        />

        <g transform={transform}>
          {/* Wires under devices */}
          {wires.map((w) => {
            const isSelected =
              selection?.kind === "wire" && selection.id === w.id;
            const stroke = sqmmToStroke(w.thickness);
            // Hit area: invisible wider stroke
            return (
              <g key={w.id}>
                <polyline
                  points={pointsToString(w.points)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(stroke + 18 / view.scale, 14 / view.scale)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ cursor: "pointer" }}
                  onPointerUp={() => onWireTap(w.id)}
                />
                <polyline
                  points={pointsToString(w.points)}
                  fill="none"
                  stroke={w.color}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
                {isSelected ? (
                  <polyline
                    points={pointsToString(w.points)}
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth={stroke + 4 / view.scale}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeOpacity={0.45}
                    pointerEvents="none"
                  />
                ) : null}
              </g>
            );
          })}

          {/* Devices */}
          {devices.map((d) => {
            const isSelected =
              selection?.kind === "device" && selection.id === d.id;
            return (
              <g
                key={d.id}
                transform={deviceTransform(d)}
                style={{ cursor: "pointer" }}
              >
                {d.src ? (
                  <image
                    href={d.src}
                    x={0}
                    y={0}
                    width={d.width}
                    height={d.height}
                    preserveAspectRatio="none"
                    pointerEvents="none"
                  />
                ) : (
                  <rect
                    x={0}
                    y={0}
                    width={d.width}
                    height={d.height}
                    fill="#e4e4e7"
                    pointerEvents="none"
                  />
                )}
                {isSelected ? (
                  <rect
                    x={-2 / view.scale}
                    y={-2 / view.scale}
                    width={d.width + 4 / view.scale}
                    height={d.height + 4 / view.scale}
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth={2 / view.scale}
                    pointerEvents="none"
                  />
                ) : null}
                {/* Tap hit-rect */}
                <rect
                  x={0}
                  y={0}
                  width={d.width}
                  height={d.height}
                  fill="transparent"
                  onPointerUp={(e) => {
                    onDeviceTap(d.id);
                  }}
                />
              </g>
            );
          })}

          {/* Labels */}
          {labels.map((l) => (
            <g
              key={l.id}
              transform={`translate(${l.x} ${l.y}) rotate(${l.rotation ?? 0})`}
              pointerEvents="none"
            >
              <text
                x={0}
                y={l.fontSize}
                fontSize={l.fontSize}
                fill={l.color}
                style={{
                  fontFamily:
                    "var(--font-geist-sans), system-ui, -apple-system, sans-serif",
                }}
              >
                {l.text}
              </text>
            </g>
          ))}
        </g>
      </svg>

      {/* Zoom controls */}
      <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col gap-2">
        <div className="pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/80 text-zinc-100 shadow-lg backdrop-blur">
          <button
            type="button"
            aria-label="zoom in"
            className="px-3 py-2 text-lg hover:bg-zinc-800 active:bg-zinc-700"
            onClick={() => {
              const center = { x: container.w / 2, y: container.h / 2 };
              const newScale = Math.min(MAX_SCALE, view.scale * 1.25);
              const worldX = (center.x - view.x) / view.scale;
              const worldY = (center.y - view.y) / view.scale;
              setView({
                x: center.x - worldX * newScale,
                y: center.y - worldY * newScale,
                scale: newScale,
              });
            }}
          >
            +
          </button>
          <div className="h-px bg-zinc-700" />
          <button
            type="button"
            aria-label="zoom out"
            className="px-3 py-2 text-lg hover:bg-zinc-800 active:bg-zinc-700"
            onClick={() => {
              const center = { x: container.w / 2, y: container.h / 2 };
              const newScale = Math.max(MIN_SCALE, view.scale / 1.25);
              const worldX = (center.x - view.x) / view.scale;
              const worldY = (center.y - view.y) / view.scale;
              setView({
                x: center.x - worldX * newScale,
                y: center.y - worldY * newScale,
                scale: newScale,
              });
            }}
          >
            −
          </button>
          <div className="h-px bg-zinc-700" />
          <button
            type="button"
            aria-label="fit content"
            className="px-3 py-2 text-xs hover:bg-zinc-800 active:bg-zinc-700"
            onClick={fitToContent}
          >
            จัด
          </button>
        </div>
        <div className="pointer-events-auto rounded-lg bg-zinc-900/70 px-2 py-1 text-center text-[10px] text-zinc-300">
          {Math.round(view.scale * 100)}%
        </div>
      </div>

      {/* Info panel */}
      {selection ? (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 mx-auto max-w-xl rounded-t-2xl border-t border-zinc-700 bg-zinc-900/95 px-4 py-3 text-zinc-100 shadow-2xl backdrop-blur sm:inset-x-4 sm:bottom-4 sm:rounded-2xl sm:border">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-violet-300">
                {selection.kind === "device" ? "อุปกรณ์" : "สายไฟ"}
              </p>
              {selectedDevice ? (
                <h2 className="mt-0.5 truncate text-base font-semibold">
                  {selectedTemplate?.name ?? "Untitled"}
                </h2>
              ) : null}
              {selectedWire ? (
                <h2 className="mt-0.5 truncate text-base font-semibold">
                  {selectedWire.label?.trim()
                    ? selectedWire.label
                    : selectedWireLayer?.name ?? "สายไฟ"}
                </h2>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="close"
              onClick={() => setSelection(null)}
              className="rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              ✕
            </button>
          </div>

          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            {selectedDevice ? (
              <>
                {selectedTemplate?.category ? (
                  <>
                    <dt className="text-zinc-400">หมวดหมู่</dt>
                    <dd className="truncate">{selectedTemplate.category}</dd>
                  </>
                ) : null}
                <dt className="text-zinc-400">ตำแหน่ง</dt>
                <dd>
                  ({Math.round(selectedDevice.x)},{" "}
                  {Math.round(selectedDevice.y)})
                </dd>
                <dt className="text-zinc-400">ขนาด</dt>
                <dd>
                  {Math.round(selectedDevice.width)} ×{" "}
                  {Math.round(selectedDevice.height)} px
                </dd>
                <dt className="text-zinc-400">การหมุน</dt>
                <dd>{Math.round(selectedDevice.rotation)}°</dd>
                {selectedTemplate?.terminals?.length ? (
                  <>
                    <dt className="text-zinc-400">เทอร์มินัล</dt>
                    <dd>{selectedTemplate.terminals.length} จุด</dd>
                  </>
                ) : null}
              </>
            ) : null}

            {selectedWire ? (
              <>
                <dt className="text-zinc-400">เลเยอร์</dt>
                <dd className="truncate">
                  {selectedWireLayer?.name ?? "ไม่ระบุ"}
                </dd>
                <dt className="text-zinc-400">สี</dt>
                <dd className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-zinc-600"
                    style={{ background: selectedWire.color }}
                  />
                  <span className="truncate">{selectedWire.color}</span>
                </dd>
                <dt className="text-zinc-400">ขนาดสาย</dt>
                <dd>{selectedWire.thickness} sq.mm</dd>
                <dt className="text-zinc-400">ความยาว</dt>
                <dd>{Math.round(wireLength(selectedWire.points))} px</dd>
                <dt className="text-zinc-400">จำนวนจุด</dt>
                <dd>{selectedWire.points.length / 2}</dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-zinc-900/70 px-3 py-1 text-[11px] text-zinc-300 backdrop-blur">
          เลื่อนด้วยนิ้ว · บีบเพื่อซูม · แตะอุปกรณ์/สายไฟเพื่อดู
        </div>
      )}
    </div>
  );
}

function pointsToString(pts: number[]) {
  let s = "";
  for (let i = 0; i < pts.length; i += 2) {
    s += (i ? " " : "") + pts[i] + "," + pts[i + 1];
  }
  return s;
}
