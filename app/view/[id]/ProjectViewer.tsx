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
  startBind?: { deviceId: string; terminalId: string };
  endBind?: { deviceId: string; terminalId: string };
  startWireBind?: { wireId: string; t: number };
  endWireBind?: { wireId: string; t: number };
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

function terminalWorld(device: ViewerDevice, fx: number, fy: number) {
  const rawX = fx * device.width;
  const rawY = fy * device.height;
  const lx = device.flipX ? device.width - rawX : rawX;
  const ly = device.flipY ? device.height - rawY : rawY;
  const r = (device.rotation * Math.PI) / 180;
  return {
    x: device.x + Math.cos(r) * lx - Math.sin(r) * ly,
    y: device.y + Math.sin(r) * lx + Math.cos(r) * ly,
  };
}

function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const vv = vx * vx + vy * vy;
  const t = vv === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv));
  const cx = ax + vx * t;
  const cy = ay + vy * t;
  return Math.hypot(px - cx, py - cy);
}

function isPointOnWire(points: number[], x: number, y: number, tol = 3) {
  for (let i = 0; i < points.length - 2; i += 2) {
    if (
      distancePointToSegment(
        x,
        y,
        points[i],
        points[i + 1],
        points[i + 2],
        points[i + 3]
      ) <= tol
    ) {
      return true;
    }
  }
  return false;
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

  // Lazy-load device images: only set image href when device is near viewport.
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const deviceRefs = useRef<Map<string, Element | null>>(new Map());
  const [imageFailed, setImageFailed] = useState<Record<string, boolean>>({});
  const imageAttempts = useRef<Record<string, number>>({});
  const [imageKeys, setImageKeys] = useState<Record<string, number>>({});

  useEffect(() => {
    const root = containerRef.current || null;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const toLoad: string[] = [];
        for (const ent of entries) {
          const id = (ent.target as Element).getAttribute("data-device-id");
          if (!id) continue;
          if (ent.isIntersecting || ent.intersectionRatio > 0) toLoad.push(id);
        }
        if (toLoad.length) {
          setLoadedImages((prev) => {
            const next = { ...prev };
            for (const id of toLoad) next[id] = true;
            return next;
          });
          for (const id of toLoad) {
            const el = deviceRefs.current.get(id);
            if (el) obs.unobserve(el);
          }
        }
      },
      { root: null, rootMargin: "400px", threshold: 0.01 }
    );

    // observe current refs
    for (const [id, el] of deviceRefs.current.entries()) {
      if (!el) continue;
      if (loadedImages[id]) continue;
      try { obs.observe(el); } catch {}
    }

    return () => obs.disconnect();
  }, [containerRef, loadedImages]);

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

  // ---------- Canvas name tag ----------
  /** Tag floating above a selected device */
  const deviceNameTag = useMemo(() => {
    if (!selectedDevice) return null;
    const name = selectedTemplate?.name;
    if (!name) return null;
    return {
      x: selectedDevice.x + selectedDevice.width / 2,
      y: selectedDevice.y,
      text: name,
    };
  }, [selectedDevice, selectedTemplate]);

  /** Terminal labels for a selected device */
  const deviceTerminalTags = useMemo(() => {
    if (!selectedDevice || !selectedTemplate) return [];
    return selectedTemplate.terminals
      .filter((t) => t.label?.trim() || t.id)
      .map((t) => {
        const p = terminalWorld(selectedDevice, t.fx, t.fy);
        return {
          key: `${selectedDevice.id}:term:${t.id}`,
          x: p.x,
          y: p.y,
          text: t.label?.trim() || t.id,
        };
      });
  }, [selectedDevice, selectedTemplate]);

  /** Tag floating above the midpoint of a selected wire */
  const wireNameTag = useMemo(() => {
    if (!selectedWire) return null;
    const pts = selectedWire.points;
    if (pts.length < 4) return null;
    // pick midpoint segment
    const mid = Math.floor(pts.length / 4) * 2;
    const x = pts[Math.min(mid, pts.length - 2)];
    const y = pts[Math.min(mid + 1, pts.length - 1)];
    const layerName = selectedWireLayer?.name ?? "สายไฟ";
    // count wires in same layer to get ordinal (same logic as Studio)
    const layerKey = selectedWire.layerId ?? "__none__";
    let ordinal = 1;
    for (const w of wires) {
      if (w.id === selectedWire.id) break;
      if ((w.layerId ?? "__none__") === layerKey) ordinal++;
    }
    const text = selectedWire.label?.trim() || `${layerName} ${ordinal}`;
    return { x, y, text };
  }, [selectedWire, selectedWireLayer, wires]);

  const wireDisplayName = useCallback((target: ViewerWire) => {
    const layerName = target.layerId
      ? wireLayerMap.get(target.layerId)?.name ?? "สายไฟ"
      : "สายไฟ";
    const layerKey = target.layerId ?? "__none__";
    let ordinal = 1;
    for (const w of wires) {
      if (w.id === target.id) break;
      if ((w.layerId ?? "__none__") === layerKey) ordinal++;
    }
    return target.label?.trim() || `${layerName} ${ordinal}`;
  }, [wireLayerMap, wires]);

  const nearestTerminalLabelAt = useCallback((x: number, y: number) => {
    const MAX_DIST = 40;
    let best: { label: string; d: number } | null = null;
    for (const d of devices) {
      const tpl = templateMap.get(d.templateId);
      if (!tpl) continue;
      for (const t of tpl.terminals) {
        const p = terminalWorld(d, t.fx, t.fy);
        const dist = Math.hypot(p.x - x, p.y - y);
        if (dist <= MAX_DIST && (!best || dist < best.d)) {
          best = { label: t.label?.trim() || t.id, d: dist };
        }
      }
    }
    return best?.label ?? null;
  }, [devices, templateMap]);

  const resolveWireEndpointTerminalLabel = useCallback((wire: ViewerWire, endpoint: "start" | "end") => {
    const bind = endpoint === "start" ? wire.startBind : wire.endBind;
    if (bind) {
      const dev = devices.find((d) => d.id === bind.deviceId);
      const tpl = dev ? templateMap.get(dev.templateId) : null;
      const term = tpl?.terminals.find((t) => t.id === bind.terminalId);
      if (term) return term.label?.trim() || term.id;
    }
    const n = wire.points.length;
    const x = endpoint === "start" ? wire.points[0] : wire.points[n - 2];
    const y = endpoint === "start" ? wire.points[1] : wire.points[n - 1];
    return nearestTerminalLabelAt(x, y);
  }, [devices, templateMap, nearestTerminalLabelAt]);

  /** Terminal labels at start/end of the selected wire */
  const wireEndpointTags = useMemo(() => {
    if (!selectedWire || selectedWire.points.length < 4) return [];
    const pts = selectedWire.points;
    const n = pts.length;
    const tags: { key: string; x: number; y: number; text: string; kind: "endpoint" }[] = [];

    const startLabel = resolveWireEndpointTerminalLabel(selectedWire, "start");
    if (startLabel) {
      tags.push({ key: `${selectedWire.id}:start`, x: pts[0], y: pts[1], text: startLabel, kind: "endpoint" });
    }
    const endLabel = resolveWireEndpointTerminalLabel(selectedWire, "end");
    if (endLabel) {
      tags.push({ key: `${selectedWire.id}:end`, x: pts[n - 2], y: pts[n - 1], text: endLabel, kind: "endpoint" });
    }
    return tags;
  }, [selectedWire, resolveWireEndpointTerminalLabel]);

  /** Labels for tap-wires (connecting wires) on the selected wire.
   *  For each tap-wire, we render TWO endpoint labels:
   *   - "near"  side: the tap point on the selected backbone — show terminal nearby
   *   - "far"   side: the other endpoint of the tap wire — show its terminal */
  const wireJumpTags = useMemo(() => {
    if (!selectedWire) return [];
    const tags: { key: string; x: number; y: number; text: string; kind: "endpoint" }[] = [];
    const pushed = new Set<string>();
    const pushTag = (key: string, x: number, y: number, text: string | null) => {
      if (!text) return;
      // Avoid stacking identical labels at the exact same coordinate.
      const sig = `${Math.round(x)}:${Math.round(y)}:${text}`;
      if (pushed.has(sig)) return;
      pushed.add(sig);
      tags.push({ key, x, y, text, kind: "endpoint" });
    };

    // Helper: resolve a wire's endpoint terminal label (bind first, geometric fallback).
    const labelFor = (w: ViewerWire, endpoint: "start" | "end") =>
      resolveWireEndpointTerminalLabel(w, endpoint);

    // 1) Outgoing taps: selected wire's start/end binds to another wire.
    if (selectedWire.startWireBind) {
      const target = wires.find((w) => w.id === selectedWire.startWireBind!.wireId);
      if (target && target.points.length >= 4) {
        const p = computePointOnWire(target.points, selectedWire.startWireBind.t);
        // near side label = the terminal at the OTHER end of the selected wire (its anchor)
        pushTag(`${selectedWire.id}:near-start`, p.x, p.y, labelFor(selectedWire, "end"));
      }
    }
    if (selectedWire.endWireBind) {
      const target = wires.find((w) => w.id === selectedWire.endWireBind!.wireId);
      if (target && target.points.length >= 4) {
        const p = computePointOnWire(target.points, selectedWire.endWireBind.t);
        pushTag(`${selectedWire.id}:near-end`, p.x, p.y, labelFor(selectedWire, "start"));
      }
    }

    // 2) Incoming taps: other wires bind to the selected wire.
    for (const w of wires) {
      if (w.id === selectedWire.id) continue;

      if (w.startWireBind?.wireId === selectedWire.id) {
        const p = computePointOnWire(selectedWire.points, w.startWireBind.t);
        // far-side (destination) terminal at the wire's "end"
        pushTag(`tap:${w.id}:far`, w.points[w.points.length - 2], w.points[w.points.length - 1], labelFor(w, "end"));
        // near-side (source on selected backbone) — show its label at the jump point
        pushTag(`tap:${w.id}:near`, p.x, p.y, labelFor(w, "end") || labelFor(w, "start"));
      }
      if (w.endWireBind?.wireId === selectedWire.id) {
        const p = computePointOnWire(selectedWire.points, w.endWireBind.t);
        pushTag(`tap:${w.id}:far`, w.points[0], w.points[1], labelFor(w, "start"));
        pushTag(`tap:${w.id}:near`, p.x, p.y, labelFor(w, "start") || labelFor(w, "end"));
      }
    }

    // 3) Legacy geometric fallback intentionally removed — causes false positives
    // when wires cross each other without being wire-bound. Only wireBind data
    // (cases 1 & 2 above) reliably identifies actual tap connections.

    return tags;
  }, [selectedWire, wires, resolveWireEndpointTerminalLabel]);

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
          {/* Devices — rendered first (bottom layer) */}
          {devices.map((d) => {
            const isSelected =
              selection?.kind === "device" && selection.id === d.id;
            return (
              <g
                key={d.id}
                transform={deviceTransform(d)}
                style={{ cursor: "pointer" }}
                data-device-id={d.id}
                ref={(el) => { deviceRefs.current.set(d.id, el); }}
              >
                {loadedImages[d.id] ? (
                  (() => {
                    const src = d.src || templateMap.get(d.templateId)?.src;
                    if (!src || imageFailed[d.id]) {
                      return (
                        <rect
                          x={0}
                          y={0}
                          width={d.width}
                          height={d.height}
                          fill="#e4e4e7"
                          pointerEvents="none"
                        />
                      );
                    }
                    return (
                      <image
                        key={imageKeys[d.id] ?? 0}
                        href={src}
                        x={0}
                        y={0}
                        width={d.width}
                        height={d.height}
                        preserveAspectRatio="none"
                        pointerEvents="none"
                        onLoad={() => {
                          // mark loaded (no-op if already true)
                        }}
                        onError={() => {
                          const a = imageAttempts.current[d.id] ?? 0;
                          imageAttempts.current[d.id] = a + 1;
                          if (a < 2) {
                            // retry by bumping key to remount image element
                            setTimeout(() => setImageKeys((prev) => ({ ...prev, [d.id]: (prev[d.id] ?? 0) + 1 })), 800);
                          } else {
                            setImageFailed((prev) => ({ ...prev, [d.id]: true }));
                          }
                        }}
                      />
                    );
                  })()
                ) : (
                  // Placeholder until image is near viewport
                  <rect
                    x={0}
                    y={0}
                    width={d.width}
                    height={d.height}
                    fill="#f3f4f6"
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

          {/* Wires — rendered on top of devices */}
          {wires.map((w) => {
            const isSelected =
              selection?.kind === "wire" && selection.id === w.id;
            const stroke = sqmmToStroke(w.thickness);
            const d = pointsToRoundedPath(w.points);
            // Hit area: invisible wider stroke
            return (
              <g key={w.id}>
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(stroke + 18 / view.scale, 14 / view.scale)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ cursor: "pointer" }}
                  onPointerUp={() => onWireTap(w.id)}
                />
                <path
                  d={d}
                  fill="none"
                  stroke={w.color}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
                {isSelected ? (
                  <path
                    d={d}
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

          {/* Labels */}
          {labels.map((l) => {
            const approxW = l.text.length * l.fontSize * 0.6 + l.fontSize * 0.6;
            const approxH = l.fontSize * 1.3;
            const padX = l.fontSize * 0.3;
            const padY = l.fontSize * 0.15;
            return (
              <g
                key={l.id}
                transform={`translate(${l.x} ${l.y}) rotate(${l.rotation ?? 0})`}
                pointerEvents="none"
              >
                <rect
                  x={-padX}
                  y={-padY}
                  width={approxW}
                  height={approxH}
                  fill="white"
                  rx={3}
                  ry={3}
                  opacity={0.92}
                />
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
            );
          })}

          {/* Device name tag on selection */}
          {deviceNameTag ? (
            <NameTag
              x={deviceNameTag.x}
              y={deviceNameTag.y}
              text={deviceNameTag.text}
              scale={view.scale}
              kind="device"
            />
          ) : null}

          {/* Wire name tag on selection */}
          {wireNameTag ? (
            <NameTag
              x={wireNameTag.x}
              y={wireNameTag.y}
              text={wireNameTag.text}
              scale={view.scale}
              kind="wire"
            />
          ) : null}

          {/* Wire endpoint terminal tags */}
          {wireEndpointTags.map((tag) => (
            <NameTag
              key={tag.key}
              x={tag.x}
              y={tag.y}
              text={tag.text}
              scale={view.scale}
              kind="endpoint"
            />
          ))}

          {/* Wire jump-point tags */}
          {wireJumpTags.map((tag) => (
            <NameTag
              key={tag.key}
              x={tag.x}
              y={tag.y}
              text={tag.text}
              scale={view.scale}
              kind="endpoint"
            />
          ))}

          {/* Device terminal labels on selection */}
          {deviceTerminalTags.map((tag) => (
            <NameTag
              key={tag.key}
              x={tag.x}
              y={tag.y}
              text={tag.text}
              scale={view.scale}
              kind="endpoint"
            />
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

      {/* Info panel removed */}
      {!selection ? (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-zinc-900/70 px-3 py-1 text-[11px] text-zinc-300 backdrop-blur">
          เลื่อนด้วยนิ้ว · บีบเพื่อซูม · แตะอุปกรณ์/สายไฟเพื่อดู
        </div>
      ) : null}
    </div>
  );
}

/** Floating name label — matches the style of Studio's selectedDeviceTags / selectedWireNameTags */
function NameTag({
  x,
  y,
  text,
  scale,
  kind,
}: {
  x: number;
  y: number;
  text: string;
  scale: number;
  kind: "device" | "wire" | "endpoint";
}) {
  const fontSize = (kind === "device" ? 18 : kind === "endpoint" ? 13 : 15) / scale;
  const padding = (kind === "device" ? 4 : 3) / scale;
  const approxW = Math.max(16 / scale, text.length * fontSize * 0.62 + padding * 2);
  const approxH = fontSize + padding * 2;
  const rx = 2 / scale;

  // device: above device top; wire/endpoint: centred vertically then pushed up slightly
  const offsetY = kind === "device"
    ? approxH + 2 / scale
    : approxH / 2 + (kind === "endpoint" ? 14 / scale : 0);
  const rectX = x - approxW / 2;
  const rectY = y - offsetY;

  const fill = "#ffffff";
  const stroke = "#0f172a";
  const textFill = "#0f172a";

  return (
    <g pointerEvents="none">
      <rect
        x={rectX}
        y={rectY}
        width={approxW}
        height={approxH}
        fill={fill}
        stroke={stroke}
        strokeWidth={1 / scale}
        rx={rx}
        ry={rx}
        opacity={0.93}
      />
      <text
        x={x}
        y={rectY + padding + fontSize * 0.85}
        textAnchor="middle"
        fontSize={fontSize}
        fill={textFill}
        style={{ fontFamily: "var(--font-geist-sans), system-ui, -apple-system, sans-serif" }}
      >
        {text}
      </text>
    </g>
  );
}

/** Get point on polyline by normalized length parameter t (0..1). */
function computePointOnWire(points: number[], t: number): { x: number; y: number } {
  if (points.length < 4) {
    return { x: points[0] ?? 0, y: points[1] ?? 0 };
  }
  const clamped = Math.max(0, Math.min(1, t));
  const segs: { x1: number; y1: number; x2: number; y2: number; len: number }[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 2; i += 2) {
    const x1 = points[i];
    const y1 = points[i + 1];
    const x2 = points[i + 2];
    const y2 = points[i + 3];
    const len = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ x1, y1, x2, y2, len });
    total += len;
  }
  if (total <= 0) return { x: points[0], y: points[1] };

  let target = total * clamped;
  for (const s of segs) {
    if (target <= s.len) {
      const r = s.len === 0 ? 0 : target / s.len;
      return {
        x: s.x1 + (s.x2 - s.x1) * r,
        y: s.y1 + (s.y2 - s.y1) * r,
      };
    }
    target -= s.len;
  }
  const last = segs[segs.length - 1];
  return { x: last.x2, y: last.y2 };
}

function pointsToString(pts: number[]) {
  let s = "";
  for (let i = 0; i < pts.length; i += 2) {
    s += (i ? " " : "") + pts[i] + "," + pts[i + 1];
  }
  return s;
}

/** Convert flat [x,y,x,y,...] into an SVG path with quadratic-bezier rounded corners.
 *  `r` is the corner radius in canvas units. */
function pointsToRoundedPath(pts: number[], r = 12): string {
  const n = pts.length / 2;
  if (n < 2) return "";
  if (n === 2) return `M${pts[0]},${pts[1]} L${pts[2]},${pts[3]}`;

  let d = "";
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2];
    const y = pts[i * 2 + 1];
    if (i === 0) {
      d += `M${x},${y}`;
    } else if (i === n - 1) {
      d += ` L${x},${y}`;
    } else {
      // previous and next points
      const px = pts[(i - 1) * 2],  py = pts[(i - 1) * 2 + 1];
      const nx = pts[(i + 1) * 2],  ny = pts[(i + 1) * 2 + 1];
      const d1 = Math.hypot(x - px, y - py);
      const d2 = Math.hypot(nx - x, ny - y);
      const cr = Math.min(r, d1 / 2, d2 / 2);
      // point along incoming segment, cr before corner
      const ax = x - (cr / d1) * (x - px);
      const ay = y - (cr / d1) * (y - py);
      // point along outgoing segment, cr after corner
      const bx = x + (cr / d2) * (nx - x);
      const by = y + (cr / d2) * (ny - y);
      d += ` L${ax},${ay} Q${x},${y} ${bx},${by}`;
    }
  }
  return d;
}
