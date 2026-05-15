"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Image as KImage,
  Text as KText,
  Line,
  Rect,
  Circle,
  Transformer,
  Group,
  Path as KPath,
} from "react-konva";
import type Konva from "konva";
import {
  useEditorStore,
  uid,
  type CanvasLabel,
  type Device,
  type DeviceTemplate,
  type Wire,
} from "@/lib/store";
import {
  Map as MapIcon,
  Minus,
  Plus,
  LocateFixed,
} from "lucide-react";

type SnapResult = { x: number; y: number; deviceId: string; terminalId: string };
type WireBind = { deviceId: string; terminalId: string };

/** Remove consecutive duplicate points (cleans legacy data that had end-duplicates) */
function cleanWirePoints(pts: number[]): number[] {
  if (pts.length < 4) return pts;
  const out: number[] = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const lx = out[out.length - 2];
    const ly = out[out.length - 1];
    if (Math.abs(pts[i] - lx) < 0.5 && Math.abs(pts[i + 1] - ly) < 0.5) continue;
    out.push(pts[i], pts[i + 1]);
  }
  return out;
}

function recalcBoundWiresCore(
  deviceId: string,
  device: Device,
  prevDevice: Device | null,
  templates: DeviceTemplate[],
  wires: Wire[],
  applyPatch: (id: string, patch: Partial<Wire>) => void
) {
  const tpl = templates.find((t) => t.id === device.templateId);
  const prevTpl = prevDevice ? templates.find((t) => t.id === prevDevice.templateId) : null;
  const EPS = 0.5;
  const REATTACH_RADIUS = 2;

  const nearestTerminalId = (x: number, y: number, dev: Device, _tpl: DeviceTemplate | null | undefined) => {
    if (!_tpl) return null;
    let best: { id: string; d: number } | null = null;
    for (const t of _tpl.terminals) {
      const p = terminalWorld(dev, t.fx, t.fy);
      const d = Math.hypot(p.x - x, p.y - y);
      if (!best || d < best.d) best = { id: t.id, d };
    }
    if (!best || best.d > REATTACH_RADIUS) return null;
    return best.id;
  };

  for (const wire of wires) {
    let startTerminalId: string | null = null;
    let endTerminalId: string | null = null;
    const inferredStartBind = !wire.startBind;
    const inferredEndBind = !wire.endBind;

    if (wire.startBind?.deviceId === deviceId) {
      startTerminalId = wire.startBind.terminalId;
    } else if (!wire.startBind && prevDevice && prevTpl) {
      startTerminalId = nearestTerminalId(wire.points[0], wire.points[1], prevDevice, prevTpl);
    }

    if (wire.endBind?.deviceId === deviceId) {
      endTerminalId = wire.endBind.terminalId;
    } else if (!wire.endBind && prevDevice && prevTpl) {
      const n = wire.points.length;
      endTerminalId = nearestTerminalId(wire.points[n - 2], wire.points[n - 1], prevDevice, prevTpl);
    }

    const hitsStart = !!startTerminalId;
    const hitsEnd = !!endTerminalId;
    if (!hitsStart && !hitsEnd) continue;
    let pts = cleanWirePoints(wire.points);
    if (pts.length < 4) continue;

    if (hitsStart) {
      const t = tpl?.terminals.find((x) => x.id === startTerminalId);
      if (t) {
        const p = terminalWorld(device, t.fx, t.fy);
        pts[0] = p.x;
        pts[1] = p.y;
        // Fix first elbow pts[2,3] using neighbour segment pts[2,3]→pts[4,5]
        if (pts.length >= 6) {
          const ex = pts[2], ey = pts[3];
          const nx = pts[4], ny = pts[5];
          const seg2Vert = Math.abs(ex - nx) < EPS;
          const seg2Horiz = Math.abs(ey - ny) < EPS;
          if (seg2Vert) {
            // 2nd segment vertical → 1st must be horizontal → ey=p.y, keep ex (=nx)
            pts[3] = p.y;
          } else if (seg2Horiz) {
            // 2nd horizontal → 1st must be vertical → ex=p.x, keep ey (=ny)
            pts[2] = p.x;
          } else {
            // fallback by stored vFirst
            if (wire.vFirst) { pts[2] = p.x; pts[3] = ny; }
            else { pts[2] = nx; pts[3] = p.y; }
          }
        } else {
          // length === 4: no elbow, direct line. Nothing to fix.
        }
      }
    }

    if (hitsEnd) {
      const t = tpl?.terminals.find((x) => x.id === endTerminalId);
      if (t) {
        const p = terminalWorld(device, t.fx, t.fy);
        const n = pts.length;
        pts[n - 2] = p.x;
        pts[n - 1] = p.y;
        if (n >= 6) {
          // Last elbow at pts[n-4, n-3], prev at pts[n-6, n-5]
          const ex = pts[n - 4], ey = pts[n - 3];
          const px = pts[n - 6], py = pts[n - 5];
          const segPrevVert = Math.abs(ex - px) < EPS;
          const segPrevHoriz = Math.abs(ey - py) < EPS;
          if (segPrevVert) {
            // prev seg vertical → last seg must be horizontal → ey = p.y, keep ex (=px)
            pts[n - 3] = p.y;
          } else if (segPrevHoriz) {
            pts[n - 4] = p.x;
          } else {
            if (wire.vFirst) { pts[n - 4] = px; pts[n - 3] = p.y; }
            else { pts[n - 4] = p.x; pts[n - 3] = py; }
          }
        }
      }
    }
    // Ensure no segment becomes diagonal (e.g. when wire was straight & device moved off-axis)
    const finalPts = mergeCollinear(ensureOrthogonal(pts));
    const patch: Partial<Wire> = { points: finalPts };
    if (startTerminalId && inferredStartBind) {
      patch.startBind = { deviceId, terminalId: startTerminalId };
    }
    if (endTerminalId && inferredEndBind) {
      patch.endBind = { deviceId, terminalId: endTerminalId };
    }
    applyPatch(wire.id, patch);
  }
}

/** Recalculate endpoints of all wires bound to a moved/resized device.
 *  Maintains orthogonality of the first/last segment by inspecting the neighbour segment. */
function recalcBoundWires(
  deviceId: string,
  device: Device,
  prevDevice: Device | null,
  templates: DeviceTemplate[],
  wires: Wire[],
  updateWire: (id: string, patch: Partial<Wire>) => void
) {
  recalcBoundWiresCore(deviceId, device, prevDevice, templates, wires, updateWire);
}

function recalcBoundWiresOnList(
  deviceId: string,
  device: Device,
  prevDevice: Device | null,
  templates: DeviceTemplate[],
  wires: Wire[]
) {
  const next = wires.slice();
  recalcBoundWiresCore(deviceId, device, prevDevice, templates, next, (id, patch) => {
    const idx = next.findIndex((wire) => wire.id === id);
    if (idx >= 0) next[idx] = { ...next[idx], ...patch };
  });
  return next;
}

// World position of a terminal accounting for device rotation
function terminalWorld(device: Device, fx: number, fy: number) {
  const lx = fx * device.width;
  const ly = fy * device.height;
  const r = (device.rotation * Math.PI) / 180;
  return {
    x: device.x + Math.cos(r) * lx - Math.sin(r) * ly,
    y: device.y + Math.sin(r) * lx + Math.cos(r) * ly,
  };
}

// Compute orthogonal elbow corner from (lx,ly) to (tx,ty). Returns ONLY the elbow point [ex, ey].
function orthogonalPts(lx: number, ly: number, tx: number, ty: number, vFirst = false): [number, number] {
  if (vFirst) return [lx, ty];
  return [tx, ly];
}

function lockWireEndpointsToBoundTerminals(
  points: number[],
  wire: Wire,
  devices: Device[],
  templates: DeviceTemplate[]
) {
  const pts = [...points];
  if (pts.length < 4) return pts;

  if (wire.startBind) {
    const d = devices.find((x) => x.id === wire.startBind!.deviceId);
    const tpl = d ? templates.find((t) => t.id === d.templateId) : null;
    const t = tpl?.terminals.find((x) => x.id === wire.startBind!.terminalId);
    if (d && t) {
      const p = terminalWorld(d, t.fx, t.fy);
      pts[0] = p.x;
      pts[1] = p.y;
    }
  }

  if (wire.endBind) {
    const d = devices.find((x) => x.id === wire.endBind!.deviceId);
    const tpl = d ? templates.find((t) => t.id === d.templateId) : null;
    const t = tpl?.terminals.find((x) => x.id === wire.endBind!.terminalId);
    if (d && t) {
      const p = terminalWorld(d, t.fx, t.fy);
      const n = pts.length;
      pts[n - 2] = p.x;
      pts[n - 1] = p.y;
    }
  }

  return pts;
}

function nearestTerminalBind(
  x: number,
  y: number,
  devices: Device[],
  templates: DeviceTemplate[],
  maxDist = 10
): WireBind | null {
  let best: { bind: WireBind; d: number } | null = null;
  for (const d of devices) {
    const tpl = templates.find((t) => t.id === d.templateId);
    for (const t of tpl?.terminals ?? []) {
      const p = terminalWorld(d, t.fx, t.fy);
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist <= maxDist && (!best || dist < best.d)) {
        best = { bind: { deviceId: d.id, terminalId: t.id }, d: dist };
      }
    }
  }
  return best ? best.bind : null;
}

function resolveAndLockWireEndpoints(
  points: number[],
  wire: Wire,
  devices: Device[],
  templates: DeviceTemplate[]
) {
  if (points.length < 4) {
    return {
      points,
      startBind: wire.startBind,
      endBind: wire.endBind,
    };
  }

  const n = points.length;
  const startBind = wire.startBind ?? nearestTerminalBind(points[0], points[1], devices, templates);
  const endBind = wire.endBind ?? nearestTerminalBind(points[n - 2], points[n - 1], devices, templates);
  const effectiveWire: Wire = {
    ...wire,
    startBind: startBind ?? undefined,
    endBind: endBind ?? undefined,
  };
  const locked = lockWireEndpointsToBoundTerminals(points, effectiveWire, devices, templates);
  return {
    points: locked,
    startBind: startBind ?? undefined,
    endBind: endBind ?? undefined,
  };
}

function keepEndpointOrthogonal(
  pts: number[],
  endpoint: "start" | "end",
  vFirst?: boolean
) {
  const out = pts.slice();
  const n = out.length;
  const EPS = 0.5;
  if (n < 4) return out;

  if (endpoint === "start") {
    if (n >= 6) {
      const nx = out[4], ny = out[5];
      const ex = out[2], ey = out[3];
      const seg2Vert = Math.abs(ex - nx) < EPS;
      const seg2Horiz = Math.abs(ey - ny) < EPS;
      if (seg2Vert) out[3] = out[1];
      else if (seg2Horiz) out[2] = out[0];
      else if (vFirst) out[2] = out[0];
      else out[3] = out[1];
    } else {
      const dx = Math.abs(out[2] - out[0]);
      const dy = Math.abs(out[3] - out[1]);
      if (dx < dy) out[2] = out[0];
      else out[3] = out[1];
    }
    return out;
  }

  if (n >= 6) {
    const px = out[n - 6], py = out[n - 5];
    const ex = out[n - 4], ey = out[n - 3];
    const segPrevVert = Math.abs(ex - px) < EPS;
    const segPrevHoriz = Math.abs(ey - py) < EPS;
    if (segPrevVert) out[n - 3] = out[n - 1];
    else if (segPrevHoriz) out[n - 4] = out[n - 2];
    else if (vFirst) out[n - 3] = out[n - 1];
    else out[n - 4] = out[n - 2];
  } else {
    const dx = Math.abs(out[n - 2] - out[n - 4]);
    const dy = Math.abs(out[n - 1] - out[n - 3]);
    if (dx < dy) out[n - 4] = out[n - 2];
    else out[n - 3] = out[n - 1];
  }
  return out;
}

function useImage(src: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return;
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.src = src;
    image.onload = () => setImg(image);
  }, [src]);
  return img;
}

function DeviceNode({
  device,
  selected,
  onSelect,
  onChange,
}: {
  device: Device;
  selected: boolean;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onChange: (patch: Partial<Device>, node?: Konva.Node) => void;
}) {
  const img = useImage(device.src);
  const tool = useEditorStore((s) => s.activeTool);
  const draggable = tool === "select";
  return (
    <KImage
      id={device.id}
      image={img ?? undefined}
      x={device.x}
      y={device.y}
      width={device.width}
      height={device.height}
      rotation={device.rotation}
      draggable={draggable}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragMove={(e) => onChange({ x: e.target.x(), y: e.target.y() }, e.target)}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() }, e.target)}
      onTransformEnd={(e) => {
        const node = e.target;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: node.x(),
          y: node.y(),
          width: Math.max(20, node.width() * scaleX),
          height: Math.max(20, node.height() * scaleY),
          rotation: node.rotation(),
        });
      }}
      stroke={selected ? "#2563eb" : undefined}
      strokeWidth={selected ? 2 : 0}
    />
  );
}

function labelMetrics(label: CanvasLabel) {
  const lines = (label.text || "").split(/\r?\n/);
  const chars = Math.max(1, ...lines.map((l) => l.length));
  const width = Math.max(16, chars * label.fontSize * 0.62);
  const height = Math.max(12, lines.length * label.fontSize * 1.2);
  return { width, height };
}

function LabelNode({
  label,
  selected,
  activeTool,
  onSelect,
  onChange,
  onEdit,
}: {
  label: CanvasLabel;
  selected: boolean;
  activeTool: import("@/lib/store").Tool;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onChange: (patch: Partial<CanvasLabel>) => void;
  onEdit: () => void;
}) {
  const { width, height } = labelMetrics(label);
  const draggable = activeTool === "select";

  return (
    <Group
      id={label.id}
      x={label.x}
      y={label.y}
      draggable={draggable}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDblClick={(e) => {
        e.cancelBubble = true;
        onEdit();
      }}
      onDragMove={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
    >
      <KText
        text={label.text}
        fontSize={label.fontSize}
        fill={label.color}
        lineHeight={1.2}
      />
      {selected && (
        <Rect
          x={-4}
          y={-4}
          width={width + 8}
          height={height + 8}
          stroke="#2563eb"
          strokeWidth={1.5}
          cornerRadius={4}
          listening={false}
        />
      )}
    </Group>
  );
}

/** Remove inner points that are collinear with their neighbours (a-b-c on same H/V line)
 *  OR duplicate points. */
function mergeCollinear(pts: number[]): number[] {
  const EPS = 0.5;
  if (pts.length < 6) return pts.slice();
  const out: number[] = [pts[0], pts[1]];
  for (let i = 1; i < pts.length / 2 - 1; i++) {
    const px = out[out.length - 2];
    const py = out[out.length - 1];
    const cx = pts[i * 2];
    const cy = pts[i * 2 + 1];
    const nx = pts[(i + 1) * 2];
    const ny = pts[(i + 1) * 2 + 1];
    // duplicate prev
    if (Math.abs(cx - px) < EPS && Math.abs(cy - py) < EPS) continue;
    const prevH = Math.abs(py - cy) < EPS;
    const prevV = Math.abs(px - cx) < EPS;
    const nextH = Math.abs(cy - ny) < EPS;
    const nextV = Math.abs(cx - nx) < EPS;
    // collinear: both segments horizontal OR both vertical
    if ((prevH && nextH) || (prevV && nextV)) continue;
    out.push(cx, cy);
  }
  // last point
  const lx = out[out.length - 2];
  const ly = out[out.length - 1];
  const ex = pts[pts.length - 2];
  const ey = pts[pts.length - 1];
  if (!(Math.abs(ex - lx) < EPS && Math.abs(ey - ly) < EPS)) out.push(ex, ey);
  return out;
}

/** Collapse very short orthogonal segments so the shape updates immediately while dragging.
 *  This allows "almost overlap" to preview the merged path before exact overlap. */
function collapseShortSegments(
  pts: number[],
  tol: number,
  lockStart: boolean,
  lockEnd: boolean
): number[] {
  let out = pts.slice();
  if (out.length < 6) return out;

  const segLen = (i: number) => {
    const ax = out[i * 2];
    const ay = out[i * 2 + 1];
    const bx = out[(i + 1) * 2];
    const by = out[(i + 1) * 2 + 1];
    return Math.abs(ax - bx) + Math.abs(ay - by);
  };

  let guard = 0;
  while (guard++ < 12) {
    let changed = false;
    const n = Math.floor(out.length / 2);
    if (n < 3) break;

    for (let i = 0; i < n - 1; i++) {
      const len = segLen(i);
      if (len > tol) continue;

      const aIdx = i;
      const bIdx = i + 1;
      const aLocked = aIdx === 0 && lockStart;
      const bLocked = bIdx === n - 1 && lockEnd;

      // Pick which point moves to the other
      let moveIdx = bIdx;
      let targetIdx = aIdx;
      if (aLocked && !bLocked) {
        moveIdx = bIdx;
        targetIdx = aIdx;
      } else if (!aLocked && bLocked) {
        moveIdx = aIdx;
        targetIdx = bIdx;
      } else if (!aLocked && !bLocked && bIdx === n - 1) {
        // Prefer moving free endpoint into previous corner for cleaner UX
        moveIdx = bIdx;
        targetIdx = aIdx;
      }

      out[moveIdx * 2] = out[targetIdx * 2];
      out[moveIdx * 2 + 1] = out[targetIdx * 2 + 1];
      out = mergeCollinear(ensureOrthogonal(out));
      changed = true;
      break;
    }

    if (!changed) break;
  }

  return out;
}

/** Ensure every segment is strictly H or V. Insert a corner for any diagonal. */
function ensureOrthogonal(pts: number[]): number[] {
  const EPS = 0.5;
  if (pts.length < 4) return pts.slice();
  const out: number[] = [pts[0], pts[1]];
  for (let i = 1; i < pts.length / 2; i++) {
    const px = out[out.length - 2];
    const py = out[out.length - 1];
    const cx = pts[i * 2];
    const cy = pts[i * 2 + 1];
    const dx = Math.abs(cx - px);
    const dy = Math.abs(cy - py);
    if (dx > EPS && dy > EPS) {
      // diagonal — insert H-first corner
      out.push(cx, py);
    }
    out.push(cx, cy);
  }
  return out;
}

// ── Wire-tap parametric helpers ─────────────────────────────────────────────
function polylineSegLens(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < pts.length; i += 2)
    out.push(Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]));
  return out;
}

/** Compute parametric t (0..1 along total polyline length) for the nearest point to (tx,ty) */
function wirePolylineT(pts: number[], tx: number, ty: number): number {
  const segLens = polylineSegLens(pts);
  const totalLen = segLens.reduce((a, b) => a + b, 0);
  if (totalLen < 0.01) return 0;
  let bestSeg = 0, bestLt = 0, bestD = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x1 = pts[i], y1 = pts[i + 1], x2 = pts[i + 2], y2 = pts[i + 3];
    const dx = x2 - x1, dy = y2 - y1, lenSq = dx * dx + dy * dy;
    const lt = lenSq < 0.01 ? 0 : Math.max(0, Math.min(1, ((tx - x1) * dx + (ty - y1) * dy) / lenSq));
    const d = Math.hypot(x1 + lt * dx - tx, y1 + lt * dy - ty);
    if (d < bestD) { bestD = d; bestSeg = i / 2; bestLt = lt; }
  }
  let cum = 0;
  for (let i = 0; i < bestSeg; i++) cum += segLens[i];
  return (cum + bestLt * segLens[bestSeg]) / totalLen;
}

/** Evaluate a point on a polyline at parametric t (0..1) */
function computePointOnWire(pts: number[], t: number): { x: number; y: number } {
  const segLens = polylineSegLens(pts);
  const totalLen = segLens.reduce((a, b) => a + b, 0);
  if (totalLen < 0.01) return { x: pts[0], y: pts[1] };
  const target = Math.max(0, Math.min(1, t)) * totalLen;
  let cum = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const sl = segLens[i / 2];
    if (cum + sl >= target - 0.001 || i + 4 >= pts.length) {
      const lt = sl > 0 ? (target - cum) / sl : 0;
      return { x: pts[i] + lt * (pts[i + 2] - pts[i]), y: pts[i + 1] + lt * (pts[i + 3] - pts[i + 1]) };
    }
    cum += sl;
  }
  return { x: pts[pts.length - 2], y: pts[pts.length - 1] };
}
// ────────────────────────────────────────────────────────────────────

// ── Wire jump helpers ─────────────────────────────────────────────────────
type Seg = { x1: number; y1: number; x2: number; y2: number };

function getSegs(pts: number[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i + 3 < pts.length; i += 2)
    out.push({ x1: pts[i], y1: pts[i + 1], x2: pts[i + 2], y2: pts[i + 3] });
  return out;
}

function segCross(a: Seg, b: Seg): { x: number; y: number } | null {
  const aH = Math.abs(a.y2 - a.y1) < 0.5;
  const bH = Math.abs(b.y2 - b.y1) < 0.5;
  if (aH === bH) return null;
  const h = aH ? a : b;
  const v = aH ? b : a;
  const hx0 = Math.min(h.x1, h.x2), hx1 = Math.max(h.x1, h.x2);
  const vy0 = Math.min(v.y1, v.y2), vy1 = Math.max(v.y1, v.y2);
  const EPS = 1.5;
  if (v.x1 > hx0 + EPS && v.x1 < hx1 - EPS && h.y1 > vy0 + EPS && h.y1 < vy1 - EPS)
    return { x: v.x1, y: h.y1 };
  return null;
}

/** Crossings where `wire` (at index `wi`) crosses OVER wires with lower index */
function computeJumpPoints(
  wire: Wire,
  wi: number,
  allWires: Wire[]
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const mySegs = getSegs(wire.points);
  for (let j = 0; j < wi; j++) {
    const otherSegs = getSegs(allWires[j].points);
    for (const ms of mySegs)
      for (const os of otherSegs) {
        const p = segCross(ms, os);
        if (p) pts.push(p);
      }
  }
  return pts;
}

const JUMP_R = 7;
const WIRE_CORNER_R = 8; // กำหนดเส้นโค้ง

function buildWirePathData(
  points: number[],
  jumps: { x: number; y: number }[]
): string {
  let d = "";
  for (let i = 0; i + 3 < points.length; i += 2) {
    const x1 = points[i], y1 = points[i + 1];
    const x2 = points[i + 2], y2 = points[i + 3];
    if (i === 0) d += `M ${x1} ${y1}`;
    const isH = Math.abs(y2 - y1) < 0.5;
    const r = JUMP_R;
    const onSeg = jumps.filter((c) =>
      isH
        ? Math.abs(c.y - y1) < 1 && c.x > Math.min(x1, x2) + r && c.x < Math.max(x1, x2) - r
        : Math.abs(c.x - x1) < 1 && c.y > Math.min(y1, y2) + r && c.y < Math.max(y1, y2) - r
    ).sort((a, b) =>
      isH ? (x1 < x2 ? a.x - b.x : b.x - a.x) : (y1 < y2 ? a.y - b.y : b.y - a.y)
    );
    for (const c of onSeg) {
      if (isH) {
        const dir = x2 >= x1 ? 1 : -1;
        d += ` L ${c.x - dir * r} ${y1} A ${r} ${r} 0 0 ${dir > 0 ? 0 : 1} ${c.x + dir * r} ${y1}`;
      } else {
        const dir = y2 >= y1 ? 1 : -1;
        d += ` L ${x1} ${c.y - dir * r} A ${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${x1} ${c.y + dir * r}`;
      }
    }
    d += ` L ${x2} ${y2}`;
  }
  return d;
}

function buildRoundedPolylinePathData(points: number[], cornerRadius = WIRE_CORNER_R): string {
  const count = Math.floor(points.length / 2);
  if (count < 2) return "";

  const get = (i: number) => ({ x: points[i * 2], y: points[i * 2 + 1] });
  const p0 = get(0);
  let d = `M ${p0.x} ${p0.y}`;

  if (count === 2) {
    const p1 = get(1);
    return `${d} L ${p1.x} ${p1.y}`;
  }

  for (let i = 1; i < count - 1; i++) {
    const prev = get(i - 1);
    const curr = get(i);
    const next = get(i + 1);

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 0.001 || len2 < 0.001) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const cut = Math.min(cornerRadius, len1 / 2, len2 / 2);
    const u1x = v1x / len1;
    const u1y = v1y / len1;
    const u2x = v2x / len2;
    const u2y = v2y / len2;

    const inX = curr.x - u1x * cut;
    const inY = curr.y - u1y * cut;
    const outX = curr.x + u2x * cut;
    const outY = curr.y + u2y * cut;

    d += ` L ${inX} ${inY}`;
    d += ` Q ${curr.x} ${curr.y} ${outX} ${outY}`;
  }

  const last = get(count - 1);
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function buildRoundedPolylinePathDataWithSharpCorners(
  points: number[],
  sharpCorners: { x: number; y: number }[] = [],
  cornerRadius = WIRE_CORNER_R
): string {
  const count = Math.floor(points.length / 2);
  if (count < 2) return "";

  const get = (i: number) => ({ x: points[i * 2], y: points[i * 2 + 1] });
  const p0 = get(0);
  let d = `M ${p0.x} ${p0.y}`;

  if (count === 2) {
    const p1 = get(1);
    return `${d} L ${p1.x} ${p1.y}`;
  }

  const EPS = 1.5;
  const isSharpCorner = (x: number, y: number) =>
    sharpCorners.some((p) => Math.hypot(p.x - x, p.y - y) <= EPS);

  for (let i = 1; i < count - 1; i++) {
    const prev = get(i - 1);
    const curr = get(i);
    const next = get(i + 1);

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 0.001 || len2 < 0.001) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    if (isSharpCorner(curr.x, curr.y)) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const cut = Math.min(cornerRadius, len1 / 2, len2 / 2);
    const u1x = v1x / len1;
    const u1y = v1y / len1;
    const u2x = v2x / len2;
    const u2y = v2y / len2;

    const inX = curr.x - u1x * cut;
    const inY = curr.y - u1y * cut;
    const outX = curr.x + u2x * cut;
    const outY = curr.y + u2y * cut;

    d += ` L ${inX} ${inY}`;
    d += ` Q ${curr.x} ${curr.y} ${outX} ${outY}`;
  }

  const last = get(count - 1);
  d += ` L ${last.x} ${last.y}`;
  return d;
}
// ────────────────────────────────────────────────────────────────────

function WireNode({
  wire,
  selected,
  jumpPoints,
  sharpCorners,
  onSelect,
}: {
  wire: Wire;
  selected: boolean;
  jumpPoints?: { x: number; y: number }[];
  sharpCorners?: { x: number; y: number }[];
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
}) {
  const hasJumps = jumpPoints && jumpPoints.length > 0;
  const visualThickness = Math.max(1, wire.thickness + 0.6);
  const shadowProps = {
    shadowColor: selected ? "#2563eb" : undefined,
    shadowBlur: selected ? 8 : 0,
    shadowOpacity: selected ? 0.7 : 0,
  };
  return (
    <>
      {hasJumps ? (
        <>
          {/* Transparent wide line for hit-testing */}
          <Line
            points={wire.points}
            stroke="transparent"
            strokeWidth={Math.max(wire.thickness + 8, 12)}
            hitStrokeWidth={Math.max(wire.thickness + 8, 12)}
            onMouseDown={onSelect}
            onTap={onSelect}
            listening
          />
          {/* Visual path with arcs */}
          <KPath
            id={wire.id}
            data={buildWirePathData(wire.points, jumpPoints!)}
            stroke={wire.color}
            strokeWidth={visualThickness}
            fill="transparent"
            lineCap="round"
            lineJoin="round"
            listening={false}
            {...shadowProps}
          />
        </>
      ) : (
        <>
          {/* Transparent wide line for hit-testing */}
          <Line
            points={wire.points}
            stroke="transparent"
            strokeWidth={Math.max(wire.thickness + 8, 12)}
            hitStrokeWidth={Math.max(wire.thickness + 8, 12)}
            onMouseDown={onSelect}
            onTap={onSelect}
            listening
          />
          {/* Rounded-corner visual path */}
          <KPath
            id={wire.id}
            data={buildRoundedPolylinePathDataWithSharpCorners(wire.points, sharpCorners ?? [])}
            stroke={wire.color}
            strokeWidth={visualThickness}
            fill="transparent"
            lineCap="round"
            lineJoin="round"
            listening={false}
            {...shadowProps}
          />
        </>
      )}
    </>
  );
}

/** Drag a whole segment perpendicular to its orientation. Endpoints bound to terminals
 *  cause insertion of a new corner so the bound point stays put. */
function WireSegmentHandles({
  wire,
  allWires,
  scale,
  devices,
  templates,
  onCommit,
  onDeleteCorner,
  onEndpointDragStateChange,
}: {
  wire: Wire;
  allWires: Wire[];
  scale: number;
  devices: Device[];
  templates: DeviceTemplate[];
  onCommit: (
    pts: number[],
    bindPatch?: Partial<
      Pick<
        Wire,
        "startBind" | "endBind" | "startWireBind" | "endWireBind"
      >
    >
  ) => void;
  onDeleteCorner: (idx: number) => void;
  onEndpointDragStateChange?: (dragging: boolean) => void;
}) {
  const pts = wire.points;
  const count = Math.floor(pts.length / 2);
  const dragRef = useRef<{ origPts: number[]; segIdx: number; orient: "H" | "V"; aBound: boolean; bBound: boolean } | null>(null);
  const endpointDragRef = useRef<{ origPts: number[]; endpoint: "start" | "end" } | null>(null);
  const [endpointSnapHint, setEndpointSnapHint] = useState<{ x: number; y: number } | null>(null);
  if (count < 2) return null;
  const r = 5 / scale;
  const stroke = 1.5 / scale;
  const hit = Math.max(wire.thickness + 12, 16) / scale;
  const mergeTol = 16 / scale;
  const endpointMergeTol = 40 / scale;
  const EPS = 0.5;
  const startBound = !!wire.startBind;
  const endBound = !!wire.endBind;

  const normalizeDraggedWire = (
    inPts: number[],
    lockStart: boolean,
    lockEnd: boolean,
    tol = mergeTol
  ) =>
    collapseShortSegments(
      mergeCollinear(ensureOrthogonal(inPts)),
      tol,
      lockStart,
      lockEnd
    );

  const snapEndpointCoord = (
    curWirePts: number[],
    endpoint: "start" | "end",
    orient: "H" | "V",
    coord: number,
    tol: number
  ) => {
    const EPS2 = 0.5;
    let best: { v: number; d: number } | null = null;
    for (const w of allWires) {
      const wPts = w.id === wire.id ? curWirePts : w.points;
      const wCount = Math.floor(wPts.length / 2);
      const excludedSelfSeg =
        endpoint === "start" ? 0 : Math.max(0, wCount - 2);
      for (let j = 0; j < wCount - 1; j++) {
        if (w.id === wire.id && j === excludedSelfSeg) continue;
        const ax = wPts[j * 2];
        const ay = wPts[j * 2 + 1];
        const bx = wPts[(j + 1) * 2];
        const by = wPts[(j + 1) * 2 + 1];
        if (orient === "H") {
          const isH = Math.abs(ay - by) < EPS2 && Math.abs(ax - bx) > EPS2;
          if (!isH) continue;
          const d = Math.abs(coord - ay);
          if (d <= tol && (!best || d < best.d)) best = { v: ay, d };
        } else {
          const isV = Math.abs(ax - bx) < EPS2 && Math.abs(ay - by) > EPS2;
          if (!isV) continue;
          const d = Math.abs(coord - ax);
          if (d <= tol && (!best || d < best.d)) best = { v: ax, d };
        }
      }

      // Also snap to point coordinates (endpoints/corners), useful when target is
      // a corner or wire endpoint rather than a long parallel segment.
      for (let j = 0; j < wCount; j++) {
        // Avoid immediate self-lock to the endpoint currently being dragged
        if (w.id === wire.id) {
          const selfEndpointIdx = endpoint === "start" ? 0 : wCount - 1;
          if (j === selfEndpointIdx) continue;
        }
        const target = orient === "H" ? wPts[j * 2 + 1] : wPts[j * 2];
        const d = Math.abs(coord - target);
        if (d <= tol && (!best || d < best.d)) best = { v: target, d };
      }
    }
    return best ? best.v : coord;
  };

  const moveEndpoint = (
    origPts: number[],
    endpoint: "start" | "end",
    x: number,
    y: number
  ) => {
    const n = origPts.length;
    const snapY = snapEndpointCoord(origPts, endpoint, "H", y, endpointMergeTol);
    const snapX = snapEndpointCoord(origPts, endpoint, "V", x, endpointMergeTol);
    const hasHSnap = Math.abs(snapY - y) > 0.001;
    const hasVSnap = Math.abs(snapX - x) > 0.001;

    const ex = hasVSnap ? snapX : x;
    const ey = hasHSnap ? snapY : y;

    let candH: number[];
    let candV: number[];
    if (endpoint === "start") {
      if (n >= 4) {
        const ax = origPts[2];
        const ay = origPts[3];
        const rest = origPts.slice(2);
        candH = [ex, ey, ax, ey, ...rest];
        candV = [ex, ey, ex, ay, ...rest];
      } else {
        const ax = origPts[n - 2];
        const ay = origPts[n - 1];
        candH = [ex, ey, ax, ey, ax, ay];
        candV = [ex, ey, ex, ay, ax, ay];
      }
    } else {
      if (n >= 4) {
        const ax = origPts[n - 4];
        const ay = origPts[n - 3];
        const head = origPts.slice(0, n - 2);
        candH = [...head, ax, ey, ex, ey];
        candV = [...head, ex, ay, ex, ey];
      } else {
        const ax = origPts[0];
        const ay = origPts[1];
        candH = [ax, ay, ax, ey, ex, ey];
        candV = [ax, ay, ex, ay, ex, ey];
      }
    }

    // Keep actively dragged endpoint fixed so short-segment collapse cannot
    // pull it away from the current snap target.
    const lockStart = endpoint === "start" ? true : startBound;
    const lockEnd = endpoint === "end" ? true : endBound;
    const normH = normalizeDraggedWire(candH, lockStart, lockEnd, endpointMergeTol);
    const normV = normalizeDraggedWire(candV, lockStart, lockEnd, endpointMergeTol);

    const polyLen = (arr: number[]) => {
      let s = 0;
      for (let i = 0; i + 3 < arr.length; i += 2) {
        s += Math.abs(arr[i + 2] - arr[i]) + Math.abs(arr[i + 3] - arr[i + 1]);
      }
      return s;
    };
    const score = (arr: number[]) => arr.length * 100000 + polyLen(arr);

    if (hasHSnap && !hasVSnap) return normH;
    if (!hasHSnap && hasVSnap) return normV;
    return score(normH) <= score(normV) ? normH : normV;
  };

  const snapBindToPoint = (bind: WireBind | null, wx: number, wy: number) => {
    if (!bind) return { x: wx, y: wy };
    const dev = devices.find((d) => d.id === bind.deviceId);
    if (!dev) return { x: wx, y: wy };
    const tpl = templates.find((t) => t.id === dev.templateId);
    const term = tpl?.terminals.find((t) => t.id === bind.terminalId);
    if (!term) return { x: wx, y: wy };
    return terminalWorld(dev, term.fx, term.fy);
  };

  const snapToWirePoint = (
    wx: number,
    wy: number,
    excludeIds?: string[]
  ): { x: number; y: number; wireId: string; t: number } | null => {
    const segRadius = 14 / scale;
    const cornerRadius = 20 / scale;
    let bestCorner: { x: number; y: number; wireId: string; t: number; d: number } | null = null;
    let bestSeg: { x: number; y: number; wireId: string; t: number; d: number } | null = null;
    for (const w of allWires) {
      if (excludeIds?.includes(w.id)) continue;
      const wPts = w.points;

      for (let i = 0; i < wPts.length; i += 2) {
        const cx = wPts[i];
        const cy = wPts[i + 1];
        const d = Math.hypot(cx - wx, cy - wy);
        if (d <= cornerRadius && (!bestCorner || d < bestCorner.d)) {
          const tPoly = wirePolylineT(wPts, cx, cy);
          bestCorner = { x: cx, y: cy, wireId: w.id, t: tPoly, d };
        }
      }

      for (let i = 0; i + 3 < wPts.length; i += 2) {
        const x1 = wPts[i], y1 = wPts[i + 1], x2 = wPts[i + 2], y2 = wPts[i + 3];
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 0.01) continue;
        const tSeg = Math.max(0, Math.min(1, ((wx - x1) * dx + (wy - y1) * dy) / lenSq));
        const cx = x1 + tSeg * dx, cy = y1 + tSeg * dy;
        const d = Math.hypot(cx - wx, cy - wy);
        if (d <= segRadius && (!bestSeg || d < bestSeg.d)) {
          const tPoly = wirePolylineT(wPts, cx, cy);
          bestSeg = { x: cx, y: cy, wireId: w.id, t: tPoly, d };
        }
      }
    }
    const best = bestCorner ?? bestSeg;
    return best ? { x: best.x, y: best.y, wireId: best.wireId, t: best.t } : null;
  };

  return (
    <Group>
      {/* Segment drag handles (move H seg vertically / V seg horizontally) */}
      {Array.from({ length: count - 1 }, (_, i) => {
        const ax = pts[i * 2];
        const ay = pts[i * 2 + 1];
        const bx = pts[(i + 1) * 2];
        const by = pts[(i + 1) * 2 + 1];
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const isH = Math.abs(ay - by) < EPS && Math.abs(ax - bx) > EPS;
        const isV = Math.abs(ax - bx) < EPS && Math.abs(ay - by) > EPS;
        if (!isH && !isV) return null;
        const aBound = i === 0 && startBound;
        const bBound = i + 1 === count - 1 && endBound;
        const lockedBoth = aBound && bBound;
        const badgeW = (isV ? 10 : 18) / scale;
        const badgeH = (isV ? 18 : 10) / scale;
        const glyph = 4 / scale;

        return (
          <Group key={`seg:${i}`}>
            <Line
              points={[ax, ay, bx, by]}
              stroke="#2563eb"
              opacity={0.0001}
              strokeWidth={hit}
              hitStrokeWidth={hit}
              draggable={!lockedBoth}
              onMouseEnter={(e) => {
                const stage = e.target.getStage();
                if (stage && !lockedBoth) {
                  stage.container().style.cursor = isH ? "ns-resize" : "ew-resize";
                }
              }}
              onMouseLeave={(e) => {
                const stage = e.target.getStage();
                if (stage) stage.container().style.cursor = "default";
              }}
              onMouseDown={(e) => {
                e.cancelBubble = true;
              }}
              onDragStart={() => {
                dragRef.current = {
                  origPts: [...pts],
                  segIdx: i,
                  orient: isH ? "H" : "V",
                  aBound,
                  bBound,
                };
              }}
              onDragMove={(e) => {
                const node = e.target;
                const stage = node.getStage();
                if (!stage || !dragRef.current) return;
                const ptr = stage.getPointerPosition();
                if (!ptr) return;
                const sc = stage.scaleX();
                const wx = (ptr.x - stage.x()) / sc;
                const wy = (ptr.y - stage.y()) / sc;
                const snap = dragRef.current;
                const np = [...snap.origPts];
                if (snap.orient === "H") {
                  const sy = snapCoordToParallel(
                    snap.origPts,
                    snap.segIdx,
                    "H",
                    wy,
                    10 / scale
                  );
                  applySegMove(np, snap.segIdx, "H", sy, snap.aBound, snap.bBound);
                } else {
                  const sx = snapCoordToParallel(
                    snap.origPts,
                    snap.segIdx,
                    "V",
                    wx,
                    10 / scale
                  );
                  applySegMove(np, snap.segIdx, "V", sx, snap.aBound, snap.bBound);
                }
                // Commit live with immediate merge after snap-to-parallel
                const live = normalizeDraggedWire(np, startBound, endBound);
                onCommit(live);
                // Reset Konva offset so Line follows committed pts only
                node.position({ x: 0, y: 0 });
              }}
              onDragEnd={(e) => {
                e.target.position({ x: 0, y: 0 });
                dragRef.current = null;
                // Finalize from latest store points (avoid overwriting with stale pre-drag props)
                const latest = useEditorStore.getState().wires.find((x) => x.id === wire.id);
                if (!latest) return;
                onCommit(
                  normalizeDraggedWire(
                    [...latest.points],
                    !!latest.startBind,
                    !!latest.endBind
                  )
                );
              }}
            />

            {/* Visual move badge at segment center */}
            <Group x={mx} y={my} listening={false} opacity={lockedBoth ? 0.55 : 0.95}>
              <Rect
                x={-badgeW / 2}
                y={-badgeH / 2}
                width={badgeW}
                height={badgeH}
                cornerRadius={badgeH / 2}
                fill="#ffffff"
                stroke={lockedBoth ? "#9ca3af" : "#64748b"}
                strokeWidth={1 / scale}
              />
              {isH ? (
                <Line
                  points={[-glyph, 0, glyph, 0]}
                  stroke={lockedBoth ? "#9ca3af" : "#475569"}
                  strokeWidth={1.4 / scale}
                  lineCap="round"
                  listening={false}
                />
              ) : (
                <Line
                  points={[0, -glyph, 0, glyph]}
                  stroke={lockedBoth ? "#9ca3af" : "#475569"}
                  strokeWidth={1.4 / scale}
                  lineCap="round"
                  listening={false}
                />
              )}
            </Group>
          </Group>
        );
      })}

      {/* Corner handles: only at points that are actual corners or endpoints */}
      {Array.from({ length: count }, (_, i) => {
        const x = pts[i * 2];
        const y = pts[i * 2 + 1];
        const isStart = i === 0;
        const isEnd = i === count - 1;
        const isEndpoint = isStart || isEnd;
        const bound = (isStart && startBound) || (isEnd && endBound);
        return (
          <Circle
            key={`pt:${i}`}
            x={x}
            y={y}
            radius={r}
            fill={bound ? "#9ca3af" : "#ffffff"}
            stroke="#2563eb"
            strokeWidth={stroke}
            draggable={isEndpoint}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) {
                stage.container().style.cursor =
                  !isStart && !isEnd ? "not-allowed" : "move";
              }
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "default";
            }}
            onMouseDown={(e) => {
              e.cancelBubble = true;
              // Shift+click on a non-endpoint corner = delete it
              if (e.evt.shiftKey && !isStart && !isEnd) {
                onDeleteCorner(i);
              }
            }}
            onDragStart={(e) => {
              if (!isEndpoint) return;
              e.cancelBubble = true;
              setEndpointSnapHint(null);
              endpointDragRef.current = {
                origPts: [...pts],
                endpoint: isStart ? "start" : "end",
              };
              onEndpointDragStateChange?.(true);
            }}
            onDragMove={(e) => {
              const node = e.target;
              const stage = node.getStage();
              if (!stage || !endpointDragRef.current) return;
              const ptr = stage.getPointerPosition();
              if (!ptr) return;
              const sc = stage.scaleX();
              const wx = (ptr.x - stage.x()) / sc;
              const wy = (ptr.y - stage.y()) / sc;
              const terminalSnap = nearestTerminalBind(wx, wy, devices, templates, 14 / scale);
              const wireSnap = terminalSnap ? null : snapToWirePoint(wx, wy, [wire.id]);
              setEndpointSnapHint(terminalSnap ? null : wireSnap ? { x: wireSnap.x, y: wireSnap.y } : null);
              const snappedPoint = terminalSnap
                ? snapBindToPoint(terminalSnap, wx, wy)
                : wireSnap
                ? { x: wireSnap.x, y: wireSnap.y }
                : { x: wx, y: wy };
              const endpoint = endpointDragRef.current.endpoint;
              const livePts = moveEndpoint(
                endpointDragRef.current.origPts,
                endpoint,
                snappedPoint.x,
                snappedPoint.y
              );
              const bindPatch: Partial<
                Pick<Wire, "startBind" | "endBind" | "startWireBind" | "endWireBind">
              > = endpoint === "start"
                ? {
                    startBind: terminalSnap ?? undefined,
                    startWireBind: terminalSnap
                      ? undefined
                      : wireSnap
                      ? { wireId: wireSnap.wireId, t: wireSnap.t }
                      : undefined,
                  }
                : {
                    endBind: terminalSnap ?? undefined,
                    endWireBind: terminalSnap
                      ? undefined
                      : wireSnap
                      ? { wireId: wireSnap.wireId, t: wireSnap.t }
                      : undefined,
                  };
              onCommit(livePts, bindPatch);
              node.position({ x: 0, y: 0 });
            }}
            onDragEnd={(e) => {
              e.target.position({ x: 0, y: 0 });
              setEndpointSnapHint(null);
              const latest = useEditorStore.getState().wires.find((x) => x.id === wire.id);
              if (latest) {
                onCommit(
                  normalizeDraggedWire(
                    [...latest.points],
                    !!latest.startBind,
                    !!latest.endBind,
                    endpointMergeTol
                  )
                );
              }
              endpointDragRef.current = null;
              onEndpointDragStateChange?.(false);
            }}
          />
        );
      })}

      {endpointSnapHint && (
        <Circle
          x={endpointSnapHint.x}
          y={endpointSnapHint.y}
          radius={6 / scale}
          fill="rgba(37,99,235,0.18)"
          stroke="#2563eb"
          strokeWidth={1.5 / scale}
          listening={false}
        />
      )}
    </Group>
  );
}

/** Mutates `pts` in place: shifts segment [segIdx, segIdx+1] perpendicular to `newCoord`.
 *  If a side is bound, inserts a new corner so the bound endpoint stays. */
function applySegMove(
  pts: number[],
  segIdx: number,
  orient: "H" | "V",
  newCoord: number,
  aBound: boolean,
  bBound: boolean
) {
  const a = segIdx;
  const b = segIdx + 1;
  // axis: H = change y, V = change x
  const idxA = orient === "H" ? a * 2 + 1 : a * 2;
  const idxB = orient === "H" ? b * 2 + 1 : b * 2;

  if (!aBound && !bBound) {
    pts[idxA] = newCoord;
    pts[idxB] = newCoord;
    return;
  }
  if (aBound && !bBound) {
    // Insert new corner after a: (a.x, newY) for H  / (newX, a.y) for V
    const newPx = orient === "H" ? pts[a * 2] : newCoord;
    const newPy = orient === "H" ? newCoord : pts[a * 2 + 1];
    pts.splice((a + 1) * 2, 0, newPx, newPy);
    // b shifted by +1 index → its perp coord
    const bShifted = b + 1;
    const idxBShift = orient === "H" ? bShifted * 2 + 1 : bShifted * 2;
    pts[idxBShift] = newCoord;
    return;
  }
  if (!aBound && bBound) {
    // a moves freely
    pts[idxA] = newCoord;
    // Insert new corner before b at (b.x, newY) for H  / (newX, b.y) for V
    const newPx = orient === "H" ? pts[b * 2] : newCoord;
    const newPy = orient === "H" ? newCoord : pts[b * 2 + 1];
    pts.splice(b * 2, 0, newPx, newPy);
    return;
  }
  // both bound: caller blocked
}

function snapCoordToParallel(
  pts: number[],
  segIdx: number,
  orient: "H" | "V",
  coord: number,
  tol: number
) {
  const EPS = 0.5;
  const count = Math.floor(pts.length / 2);
  let best: { v: number; d: number } | null = null;
  for (let j = 0; j < count - 1; j++) {
    if (j === segIdx) continue;
    const ax = pts[j * 2];
    const ay = pts[j * 2 + 1];
    const bx = pts[(j + 1) * 2];
    const by = pts[(j + 1) * 2 + 1];
    if (orient === "H") {
      const isH = Math.abs(ay - by) < EPS && Math.abs(ax - bx) > EPS;
      if (!isH) continue;
      const d = Math.abs(coord - ay);
      if (d <= tol && (!best || d < best.d)) best = { v: ay, d };
    } else {
      const isV = Math.abs(ax - bx) < EPS && Math.abs(ay - by) > EPS;
      if (!isV) continue;
      const d = Math.abs(coord - ax);
      if (d <= tol && (!best || d < best.d)) best = { v: ax, d };
    }
  }
  for (let j = 0; j < count; j++) {
    const isAdjToDraggedSeg = j === segIdx || j === segIdx + 1;
    const isGlobalEndpoint = j === 0 || j === count - 1;
    // Keep anti-self-stick for interior adjacent points, but allow snapping to
    // global endpoints (start/end) even when dragged segment is first/last.
    if (isAdjToDraggedSeg && !isGlobalEndpoint) continue;
    const target = orient === "H" ? pts[j * 2 + 1] : pts[j * 2];
    const d = Math.abs(coord - target);
    if (d <= tol && (!best || d < best.d)) best = { v: target, d };
  }
  return best ? best.v : coord;
}

function shiftPoints(points: number[], dx: number, dy: number) {
  const out = [...points];
  for (let i = 0; i < out.length; i += 2) {
    out[i] += dx;
    out[i + 1] += dy;
  }
  return out;
}

export default function DeviceCanvas() {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [selBox, setSelBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const selStart = useRef<{ x: number; y: number } | null>(null);
  // Local visual path for the orthogonal draft wire (includes elbow preview)
  const [draftVisual, setDraftVisual] = useState<number[] | null>(null);
  const [dragGuides, setDragGuides] = useState<number[][]>([]);
  const [showTerminalTargets, setShowTerminalTargets] = useState(false);
  const [pinPreviewSize, setPinPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [pinGuideRect, setPinGuideRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const vFirstRef = useRef(false); // Shift = vertical-first routing
  const draftStartBindRef = useRef<WireBind | null>(null); // terminal the wire starts from
  const draftStartWireBindRef = useRef<{ wireId: string; t: number } | null>(null); // wire tap start
  const exportFrameSnapshotRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const {
    devices,
    wires,
    labels,
    templates,
    selectedIds,
    activeTool,
    activeTemplateId,
    draftFixed,
    addDevice,
    addLabel,
    updateDevice,
    updateLabel,
    setSelected,
    toggleSelected,
    clearSelected,
    setActiveTemplate,
    startDraftWire,
    appendDraftPoints,
    finishDraftWire,
    cancelDraftWire,
    removeDevice,
    removeWire,
    removeLabel,
    wireJumps,
    exportPreview,
    exportFrame,
    setExportFrame,
  } = useEditorStore();
  const prevToolRef = useRef(activeTool);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Keyboard: ESC cancels wire, Delete removes selected, Space = temp pan
  useEffect(() => {
    let spaceHeld = false;

    const onKeyDown = (e: KeyboardEvent) => {
      // skip hotkeys when typing in inputs
      const tgt = e.target as HTMLElement | null;
      const inInput = tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable);

      if (e.key === "Escape") {
        if (!inInput && activeTool === "exportFrame") {
          e.preventDefault();
          const snapshot = exportFrameSnapshotRef.current;
          useEditorStore.getState().setExportFrame(snapshot ?? null);
          useEditorStore.getState().setExportPreview(null);
          useEditorStore.getState().setTool("select");
          return;
        }
        cancelDraftWire();
        setDraftVisual(null);
        clearSelected();
      }

      if (!inInput && e.key === "Enter" && activeTool === "exportFrame") {
        e.preventDefault();
        useEditorStore.getState().setExportPreview(null);
        useEditorStore.getState().setTool("select");
        return;
      }

      if (!inInput && !e.ctrlKey && !e.metaKey) {
        // Use e.code (physical key) so shortcuts work regardless of input language (e.g. Thai)
        if (e.code === "KeyV") {
          useEditorStore.getState().setTool("select");
        } else if (e.code === "KeyW") {
          useEditorStore.getState().setTool("wire");
        } else if (e.code === "KeyT") {
          useEditorStore.getState().setTool("text");
        } else if (e.code === "Space" && !spaceHeld) {
          e.preventDefault();
          spaceHeld = true;
          const before = useEditorStore.getState().activeTool;
          if (before !== "pan") {
            // store previous tool in a closure var captured below
            (onKeyUp as { _prev?: string })._prev = before;
            useEditorStore.getState().setTool("pan");
          }
        }
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.length === 0) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        selectedIds.forEach((id) => {
          if (devices.find((d) => d.id === id)) removeDevice(id);
          if (wires.find((w) => w.id === id)) removeWire(id);
          if (labels.find((l) => l.id === id)) removeLabel(id);
        });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        spaceHeld = false;
        const prev = (onKeyUp as { _prev?: string })._prev ?? "select";
        (onKeyUp as { _prev?: string })._prev = undefined;
        useEditorStore.getState().setTool(prev as import("@/lib/store").Tool);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    activeTool,
    cancelDraftWire,
    clearSelected,
    selectedIds,
    devices,
    wires,
    labels,
    removeDevice,
    removeWire,
    removeLabel,
  ]);

  // Keep a snapshot only once when entering export-frame mode for ESC cancel/restore
  useEffect(() => {
    const prev = prevToolRef.current;
    if (activeTool === "exportFrame" && prev !== "exportFrame") {
      exportFrameSnapshotRef.current = exportFrame ? { ...exportFrame } : null;
    }
    if (activeTool !== "exportFrame" && prev === "exportFrame") {
      exportFrameSnapshotRef.current = null;
    }
    prevToolRef.current = activeTool;
  }, [activeTool, exportFrame]);

  // Tool switch cleanup: prevent stale guide overlays from previous tool
  useEffect(() => {
    setDragGuides([]);
    if (activeTool !== "select") setShowTerminalTargets(false);
    if (activeTool !== "pin") {
      setPinGuideRect(null);
      setPinPreviewSize(null);
    }
    if (activeTool !== "wire") {
      setDraftVisual(null);
      draftStartBindRef.current = null;
      draftStartWireBindRef.current = null;
      cancelDraftWire();
    }
    if (activeTool !== "select") {
      setSelBox(null);
      selStart.current = null;
    }
  }, [activeTool, cancelDraftWire]);

  // Prepare pin preview size from selected template image
  useEffect(() => {
    if (activeTool !== "pin" || !activeTemplateId) {
      setPinPreviewSize(null);
      setPinGuideRect(null);
      return;
    }
    const tpl = templates.find((t) => t.id === activeTemplateId);
    if (!tpl) {
      setPinPreviewSize(null);
      setPinGuideRect(null);
      return;
    }
    const img = new window.Image();
    img.src = tpl.src;
    img.onload = () => {
      const maxDim = 160;
      const ratio = img.width / img.height || 1;
      const width = ratio >= 1 ? maxDim : maxDim * ratio;
      const height = ratio >= 1 ? maxDim / ratio : maxDim;
      setPinPreviewSize({ width, height });
    };
  }, [activeTool, activeTemplateId, templates]);

  // Attach transformer to selected device nodes
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const nodes = selectedIds
      .map((id) => stage.findOne<Konva.Node>(`#${CSS.escape(id)}`))
      .filter((n): n is Konva.Node => !!n)
      .filter((n) => n.getClassName() === "Image");
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, devices]);

  // Convert pointer to world coords
  const getWorld = () => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const p = stage.getPointerPosition();
    if (!p) return { x: 0, y: 0 };
    return {
      x: (p.x - view.x) / view.scale,
      y: (p.y - view.y) / view.scale,
    };
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const scaleBy = 1.08;
    const oldScale = view.scale;
    const stage = stageRef.current;
    if (!stage) return;
    const p = stage.getPointerPosition();
    if (!p) return;
    const mousePointTo = {
      x: (p.x - view.x) / oldScale,
      y: (p.y - view.y) / oldScale,
    };
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = Math.min(
      4,
      Math.max(0.2, direction > 0 ? oldScale * scaleBy : oldScale / scaleBy)
    );
    setView({
      scale: newScale,
      x: p.x - mousePointTo.x * newScale,
      y: p.y - mousePointTo.y * newScale,
    });
  };

  const zoomAtCenter = (nextScale: number) => {
    const clamped = Math.min(4, Math.max(0.2, nextScale));
    const cx = size.w / 2;
    const cy = size.h / 2;
    const wx = (cx - view.x) / view.scale;
    const wy = (cy - view.y) / view.scale;
    setView({
      scale: clamped,
      x: cx - wx * clamped,
      y: cy - wy * clamped,
    });
  };

  const getObjectsBounds = () => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const d of devices) {
      minX = Math.min(minX, d.x);
      minY = Math.min(minY, d.y);
      maxX = Math.max(maxX, d.x + d.width);
      maxY = Math.max(maxY, d.y + d.height);
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
      const m = labelMetrics(l);
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + m.width);
      maxY = Math.max(maxY, l.y + m.height);
    }

    if (!isFinite(minX)) return null;
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  };

  const centerAllObjects = () => {
    const b = getObjectsBounds();
    if (!b) return;
    const worldCx = (b.minX + b.maxX) / 2;
    const worldCy = (b.minY + b.maxY) / 2;
    const screenCx = size.w / 2;
    const screenCy = size.h / 2;
    setView((prev) => ({
      ...prev,
      x: screenCx - worldCx * prev.scale,
      y: screenCy - worldCy * prev.scale,
    }));
  };

  const miniMapData = useMemo(() => {
    const viewport = {
      minX: -view.x / view.scale,
      minY: -view.y / view.scale,
      maxX: (-view.x + size.w) / view.scale,
      maxY: (-view.y + size.h) / view.scale,
    };

    const b = getObjectsBounds();
    const minX = Math.min(b?.minX ?? viewport.minX, viewport.minX);
    const minY = Math.min(b?.minY ?? viewport.minY, viewport.minY);
    const maxX = Math.max(b?.maxX ?? viewport.maxX, viewport.maxX);
    const maxY = Math.max(b?.maxY ?? viewport.maxY, viewport.maxY);

    const width = Math.max(200, maxX - minX);
    const height = Math.max(120, maxY - minY);
    const pad = 20;

    return {
      minX: minX - pad,
      minY: minY - pad,
      width: width + pad * 2,
      height: height + pad * 2,
      viewport,
    };
  }, [devices, wires, labels, view, size]);

  // Ensure export frame tool is always usable (even with no objects selected/available)
  useEffect(() => {
    const wantsExportFrame = activeTool === "exportFrame" || !!exportPreview;
    if (!wantsExportFrame || exportFrame) return;

    const b = getObjectsBounds();
    if (b) {
      const pad = 20;
      setExportFrame({
        x: b.minX - pad,
        y: b.minY - pad,
        width: Math.max(120, b.width + pad * 2),
        height: Math.max(80, b.height + pad * 2),
      });
      return;
    }

    // Fallback: center a default frame in current viewport
    const vw = size.w / view.scale;
    const vh = size.h / view.scale;
    const wx0 = -view.x / view.scale;
    const wy0 = -view.y / view.scale;
    const fw = Math.max(160, vw * 0.5);
    const fh = Math.max(100, vh * 0.5);
    setExportFrame({
      x: wx0 + (vw - fw) / 2,
      y: wy0 + (vh - fh) / 2,
      width: fw,
      height: fh,
    });
  }, [activeTool, exportPreview, exportFrame, size, view, setExportFrame, devices, wires, labels]);

  const snapDevicePosition = (device: Device, x: number, y: number) => {
    const threshold = 8 / view.scale;
    const others = devices.filter((od) => od.id !== device.id);
    const topWorld = -view.y / view.scale;
    const leftWorld = -view.x / view.scale;
    const bottomWorld = topWorld + size.h / view.scale;
    const rightWorld = leftWorld + size.w / view.scale;

    const myX = [
      { kind: "l" as const, v: x },
      { kind: "c" as const, v: x + device.width / 2 },
      { kind: "r" as const, v: x + device.width },
    ];
    const myY = [
      { kind: "t" as const, v: y },
      { kind: "c" as const, v: y + device.height / 2 },
      { kind: "b" as const, v: y + device.height },
    ];

    const targetX: number[] = [];
    const targetY: number[] = [];
    for (const od of others) {
      targetX.push(od.x, od.x + od.width / 2, od.x + od.width);
      targetY.push(od.y, od.y + od.height / 2, od.y + od.height);
    }

    let bestX: { kind: "l" | "c" | "r"; target: number; d: number } | null = null;
    for (const m of myX) {
      for (const t of targetX) {
        const d = Math.abs(m.v - t);
        if (d <= threshold && (!bestX || d < bestX.d)) {
          bestX = { kind: m.kind, target: t, d };
        }
      }
    }

    let bestY: { kind: "t" | "c" | "b"; target: number; d: number } | null = null;
    for (const m of myY) {
      for (const t of targetY) {
        const d = Math.abs(m.v - t);
        if (d <= threshold && (!bestY || d < bestY.d)) {
          bestY = { kind: m.kind, target: t, d };
        }
      }
    }

    let sx = x;
    let sy = y;
    const guides: number[][] = [];

    if (bestX) {
      if (bestX.kind === "l") sx = bestX.target;
      if (bestX.kind === "c") sx = bestX.target - device.width / 2;
      if (bestX.kind === "r") sx = bestX.target - device.width;
      guides.push([bestX.target, topWorld, bestX.target, bottomWorld]);
    }
    if (bestY) {
      if (bestY.kind === "t") sy = bestY.target;
      if (bestY.kind === "c") sy = bestY.target - device.height / 2;
      if (bestY.kind === "b") sy = bestY.target - device.height;
      guides.push([leftWorld, bestY.target, rightWorld, bestY.target]);
    }

    return { x: sx, y: sy, guides };
  };

  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const target = e.target;
    const isStageHit = target === target.getStage();
    const w = getWorld();

    // Fallback selection path (robust for line selection)
    if (activeTool === "select" && !isStageHit) {
      const tid = (typeof (target as unknown as { id?: () => string }).id === "function")
        ? (target as unknown as { id: () => string }).id()
        : (target as unknown as { attrs?: { id?: string } }).attrs?.id;
      if (tid && wires.some((x) => x.id === tid)) {
        if (e.evt.shiftKey) toggleSelected(tid);
        else setSelected([tid]);
        return;
      }
      if (tid && labels.some((x) => x.id === tid)) {
        if (e.evt.shiftKey) toggleSelected(tid);
        else setSelected([tid]);
        return;
      }
    }

    if (activeTool === "text" && isStageHit) {
      const id = uid();
      addLabel({
        id,
        text: "Label",
        x: w.x,
        y: w.y,
        fontSize: 18,
        color: "#111827",
      });
      setSelected([id]);
      return;
    }

    if (activeTool === "pin" && activeTemplateId && isStageHit) {
      const tpl = templates.find((t) => t.id === activeTemplateId);
      if (!tpl) return;
      const img = new window.Image();
      img.src = tpl.src;
      img.onload = () => {
        const maxDim = 160;
        const ratio = img.width / img.height || 1;
        const width = ratio >= 1 ? maxDim : maxDim * ratio;
        const height = ratio >= 1 ? maxDim / ratio : maxDim;
        addDevice({
          id: uid(),
          templateId: tpl.id,
          src: tpl.src,
          x: w.x - width / 2,
          y: w.y - height / 2,
          width,
          height,
          rotation: 0,
        });
      };
      // exit pin mode after one placement (user can re-pick from sidebar)
      setActiveTemplate(null);
      return;
    }

    if (activeTool === "wire") {
      const snap = snapToTerminal(w.x, w.y);
      // Wire snap only when not already snapping to terminal
      const wireSnap = snap ? null : snapToWire(w.x, w.y);
      const px = snap ? snap.x : wireSnap ? wireSnap.x : w.x;
      const py = snap ? snap.y : wireSnap ? wireSnap.y : w.y;
      if (!draftFixed) {
        // จุดที่ 1: เริ่มต้นสาย
        draftStartBindRef.current = snap ? { deviceId: snap.deviceId, terminalId: snap.terminalId } : null;
        draftStartWireBindRef.current = wireSnap ? { wireId: wireSnap.wireId, t: wireSnap.t } : null;
        startDraftWire(px, py);
        setDraftVisual([px, py]);
      } else {
        const lx = draftFixed[draftFixed.length - 2];
        const ly = draftFixed[draftFixed.length - 1];
        const elbow = orthogonalPts(lx, ly, px, py, vFirstRef.current);
        appendDraftPoints([...elbow, px, py]);
        if (snap || wireSnap) {
          // สิ้นสุดที่ terminal หรือ wire → จบสาย
          const endBind = snap ? { deviceId: snap.deviceId, terminalId: snap.terminalId } : undefined;
          const endWireBind = wireSnap ? { wireId: wireSnap.wireId, t: wireSnap.t } : undefined;
          const savedStartBind = draftStartBindRef.current ?? undefined;
          const savedStartWireBind = draftStartWireBindRef.current ?? undefined;
          setTimeout(() => {
            useEditorStore.getState().finishDraftWire(savedStartBind, endBind, vFirstRef.current);
            if (savedStartWireBind || endWireBind) {
              const latest = useEditorStore.getState().wires;
              const justCreated = latest[latest.length - 1];
              if (justCreated) useEditorStore.getState().updateWire(justCreated.id, { startWireBind: savedStartWireBind, endWireBind });
            }
          }, 0);
          draftStartBindRef.current = null;
          draftStartWireBindRef.current = null;
          setDraftVisual(null);
        }
        // ไม่ snap → เพิ่มจุดหักเส้น ยังลากต่อได้
      }
      return;
    }

    if (activeTool === "select") {
      if (isStageHit) {
        // start selection rectangle
        clearSelected();
        selStart.current = w;
        setSelBox({ x: w.x, y: w.y, w: 0, h: 0 });
      }
    }

    if (activeTool === "pan") {
      // handled via stage draggable
    }
  };

  const onStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const w = getWorld();
    if (activeTool === "pin" && activeTemplateId && pinPreviewSize) {
      setPinGuideRect({
        x: w.x - pinPreviewSize.width / 2,
        y: w.y - pinPreviewSize.height / 2,
        width: pinPreviewSize.width,
        height: pinPreviewSize.height,
      });
    }
    if (activeTool === "wire" && draftFixed && draftFixed.length >= 2) {
      const snap = snapToTerminal(w.x, w.y);
      const wireSnap = snap ? null : snapToWire(w.x, w.y);
      const mx = snap ? snap.x : wireSnap ? wireSnap.x : w.x;
      const my = snap ? snap.y : wireSnap ? wireSnap.y : w.y;
      const lx = draftFixed[draftFixed.length - 2];
      const ly = draftFixed[draftFixed.length - 1];
      const dx = Math.abs(mx - lx);
      const dy = Math.abs(my - ly);
      let vFirst = dy > dx;
      if (e.evt.shiftKey) vFirst = !vFirst;
      vFirstRef.current = vFirst;
      const elbow = orthogonalPts(lx, ly, mx, my, vFirst);
      setDraftVisual([...draftFixed, ...elbow, mx, my]);
    }
    if (activeTool === "select" && selStart.current) {
      const s = selStart.current;
      setSelBox({
        x: Math.min(s.x, w.x),
        y: Math.min(s.y, w.y),
        w: Math.abs(w.x - s.x),
        h: Math.abs(w.y - s.y),
      });
    }
  };

  const onStageMouseUp = () => {
    setDragGuides([]);
    setShowTerminalTargets(false);
    if (activeTool === "select" && selBox && selStart.current) {
      // pick devices + wires intersecting the box
      if (selBox.w > 3 && selBox.h > 3) {
        const deviceIds = devices
          .filter(
            (d) =>
              d.x < selBox.x + selBox.w &&
              d.x + d.width > selBox.x &&
              d.y < selBox.y + selBox.h &&
              d.y + d.height > selBox.y
          )
          .map((d) => d.id);

        const wireIds = wires
          .filter((w) => {
            if (w.points.length < 2) return false;
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (let i = 0; i < w.points.length; i += 2) {
              const x = w.points[i];
              const y = w.points[i + 1];
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
            const pad = Math.max(2, w.thickness / 2);
            return (
              minX - pad < selBox.x + selBox.w &&
              maxX + pad > selBox.x &&
              minY - pad < selBox.y + selBox.h &&
              maxY + pad > selBox.y
            );
          })
          .map((w) => w.id);

        const labelIds = labels
          .filter((l) => {
            const m = labelMetrics(l);
            return (
              l.x < selBox.x + selBox.w &&
              l.x + m.width > selBox.x &&
              l.y < selBox.y + selBox.h &&
              l.y + m.height > selBox.y
            );
          })
          .map((l) => l.id);

        setSelected([...deviceIds, ...wireIds, ...labelIds]);
      }
      setSelBox(null);
      selStart.current = null;
    }
  };

  const onStageDblClick = () => {
    if (activeTool === "wire" && draftFixed) {
      finishDraftWire(
        draftStartBindRef.current ?? undefined,
        undefined,
        vFirstRef.current
      );
      draftStartBindRef.current = null;
      setDraftVisual(null);
    }
  };

  // Find nearest terminal within snap radius (in world units)
  const snapToTerminal = useMemo(
    () => (wx: number, wy: number): SnapResult | null => {
      const radius = 14 / view.scale;
      let best: (SnapResult & { d: number }) | null = null;
      for (const d of devices) {
        const tpl = templates.find((t) => t.id === d.templateId);
        for (const t of tpl?.terminals ?? []) {
          const p = terminalWorld(d, t.fx, t.fy);
          const dist = Math.hypot(p.x - wx, p.y - wy);
          if (dist <= radius && (!best || dist < best.d)) {
            best = { x: p.x, y: p.y, deviceId: d.id, terminalId: t.id, d: dist };
          }
        }
      }
      return best ? { x: best.x, y: best.y, deviceId: best.deviceId, terminalId: best.terminalId } : null;
    },
    [devices, templates, view.scale]
  );

  /** Snap to nearest point on any wire segment; returns wireId + parametric t */
  const snapToWire = useMemo(
    () => (wx: number, wy: number, excludeIds?: string[]): { x: number; y: number; wireId: string; t: number } | null => {
      const segRadius = 10 / view.scale;
      const cornerRadius = 16 / view.scale;
      let bestCorner: { x: number; y: number; wireId: string; t: number; d: number } | null = null;
      let bestSeg: { x: number; y: number; wireId: string; t: number; d: number } | null = null;
      for (const w of wires) {
        if (excludeIds?.includes(w.id)) continue;
        const pts = w.points;

        for (let i = 0; i < pts.length; i += 2) {
          const cx = pts[i], cy = pts[i + 1];
          const d = Math.hypot(cx - wx, cy - wy);
          if (d <= cornerRadius && (!bestCorner || d < bestCorner.d)) {
            const tPoly = wirePolylineT(pts, cx, cy);
            bestCorner = { x: cx, y: cy, wireId: w.id, t: tPoly, d };
          }
        }

        for (let i = 0; i + 3 < pts.length; i += 2) {
          const x1 = pts[i], y1 = pts[i + 1], x2 = pts[i + 2], y2 = pts[i + 3];
          const dx = x2 - x1, dy = y2 - y1;
          const lenSq = dx * dx + dy * dy;
          if (lenSq < 0.01) continue;
          const tSeg = Math.max(0, Math.min(1, ((wx - x1) * dx + (wy - y1) * dy) / lenSq));
          const cx = x1 + tSeg * dx, cy = y1 + tSeg * dy;
          const d = Math.hypot(cx - wx, cy - wy);
          if (d <= segRadius && (!bestSeg || d < bestSeg.d)) {
            const tPoly = wirePolylineT(pts, cx, cy);
            bestSeg = { x: cx, y: cy, wireId: w.id, t: tPoly, d };
          }
        }
      }
      const best = bestCorner ?? bestSeg;
      return best ? { x: best.x, y: best.y, wireId: best.wireId, t: best.t } : null;
    },
    [wires, view.scale]
  );

  const cursor =
    activeTool === "pan"
      ? "grab"
      : activeTool === "pin"
      ? "copy"
      : activeTool === "wire"
      ? "crosshair"
      : activeTool === "text"
      ? "crosshair"
      : activeTool === "exportFrame"
      ? "crosshair"
      : activeTool === "terminal"
      ? "cell"
      : "default";

  const renderedWires = useMemo(() => {
    const map = new Map<string, Wire>();
    for (const w of wires) {
      map.set(w.id, { ...w, points: [...w.points] });
    }

    // Multi-pass so chained wire-binds settle to stable display points.
    for (let pass = 0; pass < 3; pass++) {
      for (const w of wires) {
        let pts = [...(map.get(w.id)?.points ?? w.points)];

        if (w.startWireBind) {
          const src = map.get(w.startWireBind.wireId);
          if (src) {
            const p = computePointOnWire(src.points, w.startWireBind.t);
            pts = [p.x, p.y, ...pts.slice(2)];
            pts = keepEndpointOrthogonal(pts, "start", w.vFirst);
          }
        }

        if (w.endWireBind) {
          const src = map.get(w.endWireBind.wireId);
          if (src) {
            const p = computePointOnWire(src.points, w.endWireBind.t);
            pts = [...pts.slice(0, -2), p.x, p.y];
            pts = keepEndpointOrthogonal(pts, "end", w.vFirst);
          }
        }

        map.set(w.id, { ...w, points: pts });
      }
    }

    return wires.map((w) => map.get(w.id) ?? w);
  }, [wires]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-white dark:bg-zinc-900"
      style={{ cursor }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        scaleX={view.scale}
        scaleY={view.scale}
        x={view.x}
        y={view.y}
        draggable={activeTool === "pan"}
        onDragEnd={(e) => {
          if (activeTool === "pan") {
            setView({ ...view, x: e.target.x(), y: e.target.y() });
          }
        }}
        onWheel={onWheel}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onMouseUp={onStageMouseUp}
        onDblClick={onStageDblClick}
        onMouseLeave={() => {
          if (activeTool === "pin") setPinGuideRect(null);
        }}
      >
        {/* Background grid */}
        <Layer id="grid-layer" listening={false}>
          <Grid view={view} size={size} />
        </Layer>

        <Layer>
          {dragGuides.map((pts, i) => (
            <Line
              key={`guide:${i}`}
              points={pts}
              stroke="#22c55e"
              strokeWidth={1.5 / view.scale}
              dash={[6 / view.scale, 6 / view.scale]}
              listening={false}
            />
          ))}

          {devices.map((d) => (
            <DeviceNode
              key={d.id}
              device={d}
              selected={selectedIds.includes(d.id)}
              onSelect={(e) => {
                if (activeTool === "terminal") {
                  e.cancelBubble = true;
                  return;
                }
                if (activeTool === "pan") {
                  // allow Stage draggable to pan even when clicking on a device
                  return;
                }
                if (activeTool === "wire") {
                  // ปล่อยให้ stage จัดการ — คลิกบนตัวรูป = เพิ่ม waypoint, ไม่จบสาย
                  return;
                }
                e.cancelBubble = true;
                if (activeTool !== "select") return;
                if (!e.evt.shiftKey && selectedIds.length > 1 && selectedIds.includes(d.id)) {
                  // keep current multi-selection when clicking one of selected items
                  return;
                }
                if (e.evt.shiftKey) toggleSelected(d.id);
                else setSelected([d.id]);
              }}
              onChange={(patch, dragNode) => {
                let nextPatch = patch;
                const dragOnly =
                  typeof patch.x === "number" &&
                  typeof patch.y === "number" &&
                  !("width" in patch) &&
                  !("height" in patch) &&
                  !("rotation" in patch);

                const movingMulti =
                  dragOnly &&
                  activeTool === "select" &&
                  selectedIds.length > 1 &&
                  selectedIds.includes(d.id);

                if (dragOnly) {
                  if (movingMulti) {
                    // Group move: avoid per-item snapping to prevent jitter/overshoot.
                    nextPatch = patch;
                    setDragGuides([]);
                  } else {
                    const snapped = snapDevicePosition(d, patch.x as number, patch.y as number);
                    nextPatch = { ...patch, x: snapped.x, y: snapped.y };
                    if (dragNode) {
                      dragNode.position({ x: snapped.x, y: snapped.y });
                    }
                    setDragGuides(snapped.guides);
                  }
                } else {
                  setDragGuides([]);
                }

                if (!movingMulti) {
                  updateDevice(d.id, nextPatch);
                  // ย้ายปลายสายที่ผูกกับ device นี้
                  const updated = { ...d, ...nextPatch };
                  const { wires, updateWire, templates } = useEditorStore.getState();
                  recalcBoundWires(d.id, updated, d, templates, wires, updateWire);
                  return;
                }

                const targetX = nextPatch.x as number;
                const targetY = nextPatch.y as number;

                const sel = new Set(selectedIds);
                useEditorStore.setState((state) => {
                  const currentDragged = state.devices.find((device) => device.id === d.id);
                  if (!currentDragged) return state;

                  const dx = targetX - currentDragged.x;
                  const dy = targetY - currentDragged.y;
                  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return state;

                  const movedDevices = state.devices.filter((device) => sel.has(device.id));
                  const nextDevices = state.devices.map((device) =>
                    sel.has(device.id)
                      ? { ...device, x: device.x + dx, y: device.y + dy }
                      : device
                  );

                  let nextWires = state.wires.map((wire) =>
                    sel.has(wire.id)
                      ? { ...wire, points: shiftPoints(wire.points, dx, dy) }
                      : wire
                  );

                  for (const prevDevice of movedDevices) {
                    const updatedDevice = nextDevices.find((device) => device.id === prevDevice.id);
                    if (!updatedDevice) continue;
                    nextWires = recalcBoundWiresOnList(
                      prevDevice.id,
                      updatedDevice,
                      prevDevice,
                      state.templates,
                      nextWires
                    );
                  }

                  return {
                    devices: nextDevices,
                    wires: nextWires,
                  };
                });
              }}
            />
          ))}

          {labels.map((l) => (
            <LabelNode
              key={l.id}
              label={l}
              activeTool={activeTool}
              selected={selectedIds.includes(l.id)}
              onSelect={(e) => {
                if (activeTool === "pan") return;
                if (activeTool !== "select") {
                  e.cancelBubble = true;
                  return;
                }
                e.cancelBubble = true;
                if (!e.evt.shiftKey && selectedIds.length > 1 && selectedIds.includes(l.id)) {
                  return;
                }
                if (e.evt.shiftKey) toggleSelected(l.id);
                else setSelected([l.id]);
              }}
              onChange={(patch) => updateLabel(l.id, patch)}
              onEdit={() => {
                const next = window.prompt("ข้อความ Label", l.text);
                if (next === null) return;
                updateLabel(l.id, { text: next || "Label" });
              }}
            />
          ))}

          {/* Wires อยู่เหนือรูปอุปกรณ์ */}
          {/* Wires อยู่เหนือรูปอุปกรณ์ */}
          {renderedWires.map((w, wi) => {
            const sharpCorners = renderedWires.flatMap((ow) => {
              if (ow.id === w.id) return [] as { x: number; y: number }[];
              const out: { x: number; y: number }[] = [];
              if (ow.startWireBind?.wireId === w.id) {
                out.push(computePointOnWire(w.points, ow.startWireBind.t));
              }
              if (ow.endWireBind?.wireId === w.id) {
                out.push(computePointOnWire(w.points, ow.endWireBind.t));
              }
              return out;
            });
            return (
              <WireNode
                key={w.id}
                wire={w}
                selected={selectedIds.includes(w.id)}
                jumpPoints={wireJumps ? computeJumpPoints(w, wi, renderedWires) : undefined}
                sharpCorners={sharpCorners}
                onSelect={(e) => {
                  if (activeTool === "pan") {
                    // allow Stage draggable to pan even when clicking on a wire
                    return;
                  }
                  if (activeTool === "wire") {
                    // ไม่ cancelBubble — ปล่อยให้ stage.onMouseDown จัดการผ่าน snapToWire
                    return;
                  }
                  e.cancelBubble = true;
                  if (activeTool !== "select") return;
                  if (!e.evt.shiftKey && selectedIds.length > 1 && selectedIds.includes(w.id)) {
                    return;
                  }
                  if (e.evt.shiftKey) toggleSelected(w.id);
                  else setSelected([w.id]);
                }}
              />
            );
          })}

          {/* Terminals overlay on top (wire mode or endpoint dragging) */}
          {(activeTool === "wire" || showTerminalTargets) && devices.flatMap((d) => {
            const tpl = templates.find((t) => t.id === d.templateId);
            return (tpl?.terminals ?? []).flatMap((t) => {
              const p = terminalWorld(d, t.fx, t.fy);
              const r = 6 / view.scale;
              const interactive = activeTool === "wire";
              return [
                <Circle
                  key={`${d.id}:${t.id}:dot`}
                  x={p.x}
                  y={p.y}
                  radius={r}
                  fill="#ffffff"
                  stroke={interactive ? "#dc2626" : "#2563eb"}
                  strokeWidth={2 / view.scale}
                  listening={interactive}
                  onMouseEnter={(e) => {
                    if (!interactive) return;
                    const stage = e.target.getStage();
                    if (stage) stage.container().style.cursor = "pointer";
                  }}
                  onMouseLeave={(e) => {
                    if (!interactive) return;
                    const stage = e.target.getStage();
                    if (stage) stage.container().style.cursor = cursor;
                  }}
                  onMouseDown={(e) => {
                    if (!interactive) return;
                    e.cancelBubble = true;
                    if (!draftFixed) {
                      draftStartBindRef.current = { deviceId: d.id, terminalId: t.id };
                      startDraftWire(p.x, p.y);
                      setDraftVisual([p.x, p.y]);
                    } else {
                      const lx = draftFixed[draftFixed.length - 2];
                      const ly = draftFixed[draftFixed.length - 1];
                      const elbow = orthogonalPts(lx, ly, p.x, p.y, vFirstRef.current);
                      appendDraftPoints([...elbow, p.x, p.y]);
                      const endBind = { deviceId: d.id, terminalId: t.id };
                      setTimeout(() => { useEditorStore.getState().finishDraftWire(draftStartBindRef.current ?? undefined, endBind, vFirstRef.current); }, 0);
                      draftStartBindRef.current = null;
                      setDraftVisual(null);
                    }
                  }}
                />,
              ];
            });
          })}

          {/* T-junction & endpoint dots */}
          {(() => {
            const dots: { x: number; y: number; color: string }[] = [];
            for (const w of renderedWires) {
              // startWireBind dot
              if (w.startWireBind) {
                const src = renderedWires.find((x) => x.id === w.startWireBind!.wireId);
                if (src) {
                  const p = computePointOnWire(src.points, w.startWireBind.t);
                  dots.push({ x: p.x, y: p.y, color: w.color });
                }
              }
              // endWireBind dot
              if (w.endWireBind) {
                const src = renderedWires.find((x) => x.id === w.endWireBind!.wireId);
                if (src) {
                  const p = computePointOnWire(src.points, w.endWireBind.t);
                  dots.push({ x: p.x, y: p.y, color: w.color });
                }
              }
            }
            return dots.map((d, i) => (
              <Circle
                key={`tjunc:${i}`}
                x={d.x}
                y={d.y}
                radius={5 / view.scale}
                fill={d.color}
                stroke="#fff"
                strokeWidth={1.5 / view.scale}
                listening={false}
              />
            ));
          })()}

          {/* Wire waypoint handles (only when selected + select tool) */}
          {activeTool === "select" &&
            renderedWires
              .filter((w) => selectedIds.includes(w.id))
              .map((w) => (
                <WireSegmentHandles
                  key={`h:${w.id}`}
                  wire={w}
                  allWires={renderedWires}
                  scale={view.scale}
                  devices={devices}
                  templates={templates}
                  onEndpointDragStateChange={setShowTerminalTargets}
                  onCommit={(pts, bindPatch) => {
                    const baseWire =
                      useEditorStore.getState().wires.find((x) => x.id === w.id) ?? w;
                    const draftWire = bindPatch ? { ...baseWire, ...bindPatch } : baseWire;
                    const resolved = resolveAndLockWireEndpoints(
                      pts,
                      draftWire,
                      useEditorStore.getState().devices,
                      useEditorStore.getState().templates
                    );
                    useEditorStore.getState().updateWire(w.id, {
                      points: mergeCollinear(ensureOrthogonal(resolved.points)),
                      startBind: resolved.startBind,
                      endBind: resolved.endBind,
                      startWireBind: draftWire.startWireBind,
                      endWireBind: draftWire.endWireBind,
                    });
                  }}
                  onDeleteCorner={(idx) => {
                    const pts = [...w.points];
                    pts.splice(idx * 2, 2);
                    const resolved = resolveAndLockWireEndpoints(
                      pts,
                      w,
                      useEditorStore.getState().devices,
                      useEditorStore.getState().templates
                    );
                    const cleaned = mergeCollinear(ensureOrthogonal(resolved.points));
                    useEditorStore.getState().updateWire(w.id, {
                      points: cleaned,
                      startBind: resolved.startBind,
                      endBind: resolved.endBind,
                    });
                  }}
                />
              ))}

          {draftVisual && draftVisual.length >= 2 && (
            <Line
              points={draftVisual}
              stroke={useEditorStore.getState().wireColor}
              strokeWidth={useEditorStore.getState().wireThickness}
              dash={[8, 6]}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          )}
          {draftFixed && draftFixed.length >= 2 && (
            <Group listening={false}>
              {Array.from(
                { length: Math.floor(draftFixed.length / 2) },
                (_, i) => (
                  <Circle
                    key={i}
                    x={draftFixed[i * 2]}
                    y={draftFixed[i * 2 + 1]}
                    radius={3 / view.scale}
                    fill="#2563eb"
                  />
                )
              )}
            </Group>
          )}

          {selBox && (
            <Rect
              x={selBox.x}
              y={selBox.y}
              width={selBox.w}
              height={selBox.h}
              fill="rgba(37,99,235,0.08)"
              stroke="#2563eb"
              strokeWidth={1}
              dash={[4, 4]}
              listening={false}
            />
          )}

          {activeTool === "pin" && pinGuideRect && (
            <Rect
              x={pinGuideRect.x}
              y={pinGuideRect.y}
              width={pinGuideRect.width}
              height={pinGuideRect.height}
              fill="rgba(37,99,235,0.08)"
              stroke="#2563eb"
              strokeWidth={1 / view.scale}
              dash={[6 / view.scale, 4 / view.scale]}
              listening={false}
            />
          )}

          <Transformer
            ref={transformerRef}
            rotateEnabled
            keepRatio={false}
            anchorSize={8}
            borderStroke="#2563eb"
            anchorStroke="#2563eb"
          />
        </Layer>

        {/* Export preview / frame bounding box */}
        {(exportPreview || activeTool === "exportFrame" || !!exportFrame) && (() => {
          const ids = exportPreview?.ids ?? [...devices.map((d) => d.id), ...wires.map((w) => w.id), ...labels.map((l) => l.id)];
          const padding = exportPreview?.padding ?? 0;
          const canEditFrame = activeTool === "exportFrame" || !!exportPreview;
          const initialFrame = (() => {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const id of ids) {
              const dev = devices.find((d) => d.id === id);
              if (dev) {
                minX = Math.min(minX, dev.x); minY = Math.min(minY, dev.y);
                maxX = Math.max(maxX, dev.x + dev.width); maxY = Math.max(maxY, dev.y + dev.height);
                continue;
              }
              const wire = wires.find((w) => w.id === id);
              if (wire) {
                for (let i = 0; i < wire.points.length; i += 2) {
                  minX = Math.min(minX, wire.points[i]); maxX = Math.max(maxX, wire.points[i]);
                  minY = Math.min(minY, wire.points[i + 1]); maxY = Math.max(maxY, wire.points[i + 1]);
                }
                continue;
              }
              const label = labels.find((l) => l.id === id);
              if (label) {
                const m = labelMetrics(label);
                minX = Math.min(minX, label.x); minY = Math.min(minY, label.y);
                maxX = Math.max(maxX, label.x + m.width); maxY = Math.max(maxY, label.y + m.height);
              }
            }
            if (!isFinite(minX)) return null;
            return {
              x: minX - padding,
              y: minY - padding,
              width: maxX - minX + padding * 2,
              height: maxY - minY + padding * 2,
            };
          })();

          const frame = exportFrame ?? initialFrame;
          if (!frame) return null;
          const bx = frame.x, by = frame.y;
          const bw = frame.width, bh = frame.height;
          const sw = 1.5 / view.scale;
          const ds = 6 / view.scale;
          const dg = 4 / view.scale;
          const hs = 8 / view.scale;
          const edgeHit = 12 / view.scale;
          const minW = 24 / view.scale;
          const minH = 24 / view.scale;

          const setStageCursor = (e: Konva.KonvaEventObject<MouseEvent>, next: string) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = next;
          };

          const resetStageCursor = (e: Konva.KonvaEventObject<MouseEvent>) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = cursor;
          };

          const setFrameSafe = (next: { x: number; y: number; width: number; height: number }) => {
            setExportFrame({
              x: next.x,
              y: next.y,
              width: Math.max(minW, next.width),
              height: Math.max(minH, next.height),
            });
          };

          return (
            <Layer id="export-frame-layer" listening={canEditFrame}>
              {/* dim overlay outside bbox - 4 rects */}
              <Rect x={-99999} y={-99999} width={bx + 99999} height={99999 * 2} fill="rgba(80,80,80,0.40)" listening={false} />
              <Rect x={bx + bw} y={-99999} width={99999} height={99999 * 2} fill="rgba(80,80,80,0.40)" listening={false} />
              <Rect x={bx} y={-99999} width={bw} height={by + 99999} fill="rgba(80,80,80,0.40)" listening={false} />
              <Rect x={bx} y={by + bh} width={bw} height={99999} fill="rgba(80,80,80,0.40)" listening={false} />
              {/* dashed border */}
              <Rect
                x={bx} y={by} width={bw} height={bh}
                stroke="#2563eb" strokeWidth={sw}
                dash={[ds, dg]}
                fill="transparent"
                draggable={canEditFrame}
                onMouseEnter={(e) => setStageCursor(e, "move")}
                onMouseLeave={resetStageCursor}
                onDragMove={(e) => {
                  setFrameSafe({ x: e.target.x(), y: e.target.y(), width: bw, height: bh });
                }}
              />
              {/* corner handles */}
              {canEditFrame && (
                <>
                  {/* edge handles */}
                  <Rect
                    x={bx + bw / 2 - hs}
                    y={by - hs / 2}
                    width={hs * 2}
                    height={hs}
                    fill="#ffffff"
                    stroke="#2563eb"
                    strokeWidth={1 / view.scale}
                    cornerRadius={1 / view.scale}
                    draggable
                    onMouseEnter={(e) => setStageCursor(e, "ns-resize")}
                    onMouseLeave={resetStageCursor}
                    onDragMove={(e) => {
                      const bottom = by + bh;
                      const ny = Math.min(e.target.y() + hs / 2, bottom - minH);
                      setFrameSafe({ x: bx, y: ny, width: bw, height: bottom - ny });
                    }}
                  />
                  <Rect
                    x={bx + bw / 2 - hs}
                    y={by + bh - hs / 2}
                    width={hs * 2}
                    height={hs}
                    fill="#ffffff"
                    stroke="#2563eb"
                    strokeWidth={1 / view.scale}
                    cornerRadius={1 / view.scale}
                    draggable
                    onMouseEnter={(e) => setStageCursor(e, "ns-resize")}
                    onMouseLeave={resetStageCursor}
                    onDragMove={(e) => {
                      const top = by;
                      const ny = Math.max(e.target.y() + hs / 2, top + minH);
                      setFrameSafe({ x: bx, y: top, width: bw, height: ny - top });
                    }}
                  />
                  <Rect
                    x={bx - hs / 2}
                    y={by + bh / 2 - hs}
                    width={hs}
                    height={hs * 2}
                    fill="#ffffff"
                    stroke="#2563eb"
                    strokeWidth={1 / view.scale}
                    cornerRadius={1 / view.scale}
                    draggable
                    onMouseEnter={(e) => setStageCursor(e, "ew-resize")}
                    onMouseLeave={resetStageCursor}
                    onDragMove={(e) => {
                      const right = bx + bw;
                      const nx = Math.min(e.target.x() + hs / 2, right - minW);
                      setFrameSafe({ x: nx, y: by, width: right - nx, height: bh });
                    }}
                  />
                  <Rect
                    x={bx + bw - hs / 2}
                    y={by + bh / 2 - hs}
                    width={hs}
                    height={hs * 2}
                    fill="#ffffff"
                    stroke="#2563eb"
                    strokeWidth={1 / view.scale}
                    cornerRadius={1 / view.scale}
                    draggable
                    onMouseEnter={(e) => setStageCursor(e, "ew-resize")}
                    onMouseLeave={resetStageCursor}
                    onDragMove={(e) => {
                      const left = bx;
                      const nx = Math.max(e.target.x() + hs / 2, left + minW);
                      setFrameSafe({ x: left, y: by, width: nx - left, height: bh });
                    }}
                  />

                  {/* invisible wider hit zones on edges for easier pointer targeting */}
                  <Rect
                    x={bx}
                    y={by - edgeHit / 2}
                    width={bw}
                    height={edgeHit}
                    fill="rgba(0,0,0,0.001)"
                    draggable
                    onMouseEnter={(e) => setStageCursor(e, "ns-resize")}
                    onMouseLeave={resetStageCursor}
                    onDragMove={(e) => {
                      const bottom = by + bh;
                      const ny = Math.min(e.target.y() + edgeHit / 2, bottom - minH);
                      setFrameSafe({ x: bx, y: ny, width: bw, height: bottom - ny });
                    }}
                  />
                  <Rect
                    x={bx}
                    y={by + bh - edgeHit / 2}
                    width={bw}
                    height={edgeHit}
                    fill="rgba(0,0,0,0.001)"
                    draggable
                    onMouseEnter={(e) => setStageCursor(e, "ns-resize")}
                    onMouseLeave={resetStageCursor}
                    onDragMove={(e) => {
                      const top = by;
                      const ny = Math.max(e.target.y() + edgeHit / 2, top + minH);
                      setFrameSafe({ x: bx, y: top, width: bw, height: ny - top });
                    }}
                  />
                  <Rect
                    x={bx - edgeHit / 2}
                    y={by}
                    width={edgeHit}
                    height={bh}
                    fill="rgba(0,0,0,0.001)"
                    draggable
                    onMouseEnter={(e) => setStageCursor(e, "ew-resize")}
                    onMouseLeave={resetStageCursor}
                    onDragMove={(e) => {
                      const right = bx + bw;
                      const nx = Math.min(e.target.x() + edgeHit / 2, right - minW);
                      setFrameSafe({ x: nx, y: by, width: right - nx, height: bh });
                    }}
                  />
                  <Rect
                    x={bx + bw - edgeHit / 2}
                    y={by}
                    width={edgeHit}
                    height={bh}
                    fill="rgba(0,0,0,0.001)"
                    draggable
                    onMouseEnter={(e) => setStageCursor(e, "ew-resize")}
                    onMouseLeave={resetStageCursor}
                    onDragMove={(e) => {
                      const left = bx;
                      const nx = Math.max(e.target.x() + edgeHit / 2, left + minW);
                      setFrameSafe({ x: left, y: by, width: nx - left, height: bh });
                    }}
                  />

                  <Rect
                    x={bx - hs / 2}
                    y={by - hs / 2}
                    width={hs}
                    height={hs}
                    fill="#2563eb"
                    cornerRadius={1 / view.scale}
                    draggable
                    onMouseEnter={(e) => setStageCursor(e, "nwse-resize")}
                    onMouseLeave={resetStageCursor}
                    onDragMove={(e) => {
                      const right = bx + bw;
                      const bottom = by + bh;
                      const nx = Math.min(e.target.x() + hs / 2, right - minW);
                      const ny = Math.min(e.target.y() + hs / 2, bottom - minH);
                      setFrameSafe({ x: nx, y: ny, width: right - nx, height: bottom - ny });
                    }}
                  />
                  <Rect
                    x={bx + bw - hs / 2}
                    y={by - hs / 2}
                    width={hs}
                    height={hs}
                    fill="#2563eb"
                    cornerRadius={1 / view.scale}
                    draggable
                    onMouseEnter={(e) => setStageCursor(e, "nesw-resize")}
                    onMouseLeave={resetStageCursor}
                    onDragMove={(e) => {
                      const left = bx;
                      const bottom = by + bh;
                      const nx = Math.max(e.target.x() + hs / 2, left + minW);
                      const ny = Math.min(e.target.y() + hs / 2, bottom - minH);
                      setFrameSafe({ x: left, y: ny, width: nx - left, height: bottom - ny });
                    }}
                  />
                  <Rect
                    x={bx - hs / 2}
                    y={by + bh - hs / 2}
                    width={hs}
                    height={hs}
                    fill="#2563eb"
                    cornerRadius={1 / view.scale}
                    draggable
                    onMouseEnter={(e) => setStageCursor(e, "nesw-resize")}
                    onMouseLeave={resetStageCursor}
                    onDragMove={(e) => {
                      const right = bx + bw;
                      const top = by;
                      const nx = Math.min(e.target.x() + hs / 2, right - minW);
                      const ny = Math.max(e.target.y() + hs / 2, top + minH);
                      setFrameSafe({ x: nx, y: top, width: right - nx, height: ny - top });
                    }}
                  />
                  <Rect
                    x={bx + bw - hs / 2}
                    y={by + bh - hs / 2}
                    width={hs}
                    height={hs}
                    fill="#2563eb"
                    cornerRadius={1 / view.scale}
                    draggable
                    onMouseEnter={(e) => setStageCursor(e, "nwse-resize")}
                    onMouseLeave={resetStageCursor}
                    onDragMove={(e) => {
                      const left = bx;
                      const top = by;
                      const nx = Math.max(e.target.x() + hs / 2, left + minW);
                      const ny = Math.max(e.target.y() + hs / 2, top + minH);
                      setFrameSafe({ x: left, y: top, width: nx - left, height: ny - top });
                    }}
                  />
                </>
              )}
            </Layer>
          );
        })()}
      </Stage>

      {/* Alignment toolbar for multi-selected devices */}
      <AlignmentToolbar
        devices={devices.filter((d) => selectedIds.includes(d.id))}
        onApply={(updates) => {
          const { updateWire, templates: tpls } = useEditorStore.getState();
          const prevById = new Map(useEditorStore.getState().devices.map((d) => [d.id, d] as const));
          updates.forEach(({ id, patch }) => {
            updateDevice(id, patch);
          });
          const latestDevices = useEditorStore.getState().devices;
          updates.forEach(({ id }) => {
            const d = latestDevices.find((x) => x.id === id);
            if (d) recalcBoundWires(d.id, d, prevById.get(id) ?? null, tpls, useEditorStore.getState().wires, updateWire);
          });
        }}
      />

      {/* Hint overlay */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-3 py-1.5 text-xs text-white">
        {activeTool === "wire" && "คลิกพื้นที่ว่าง = เพิ่มจุดหัก · คลิก Terminal = จบสาย · Double-click = จบลอย · Shift = สลับแนว · ESC ยกเลิก"}
        {activeTool === "pin" && "คลิกบน Canvas เพื่อวางอุปกรณ์"}
        {activeTool === "text" && "คลิกบน Canvas เพื่อเพิ่ม Label · เลือกแล้วลากเพื่อย้าย · ดับเบิลคลิกเพื่อแก้ข้อความ"}
        {activeTool === "terminal" &&
          "คลิกบนอุปกรณ์เพื่อเพิ่มจุดต่อสาย · คลิกจุดเดิมเพื่อลบ"}
        {activeTool === "select" &&
          "ลากเพื่อเลือกหลายชิ้น · Shift+คลิก เพิ่ม/ลบ · Del ลบ · ลากเส้นเพื่อย้าย · Shift+คลิกมุม = ลบมุม"}
        {activeTool === "pan" && "ลากเพื่อเลื่อน Canvas"}
        {activeTool === "exportFrame" && "ลากกรอบเพื่อย้าย · ลากขอบ/มุมเพื่อปรับขนาดกรอบส่งออก · ใช้เคอร์เซอร์เมาส์ช่วยชี้จุด · Enter ยืนยัน · Esc ยกเลิก"}
      </div>

      {/* Bottom-right navigation controls */}
      <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2">
        <button
          onClick={() => setShowMiniMap((v) => !v)}
          className="flex h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          title="เปิด/ปิด Mini Map"
        >
          <MapIcon size={16} />
        </button>
        <div className="flex overflow-hidden rounded-md border border-zinc-300 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <button
            onClick={() => zoomAtCenter(view.scale / 1.2)}
            className="flex h-9 w-10 items-center justify-center text-lg text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="Zoom Out"
          >
            <Minus size={16} />
          </button>
          <button
            onClick={centerAllObjects}
            className="flex h-9 w-10 items-center justify-center border-x border-zinc-300 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="จัดกึ่งกลาง Object ทั้งหมด"
          >
            <LocateFixed size={16} />
          </button>
          <button
            onClick={() => zoomAtCenter(view.scale * 1.2)}
            className="flex h-9 w-10 items-center justify-center text-xl text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="Zoom In"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Mini map */}
      {showMiniMap && (
        <div className="absolute bottom-16 right-3 z-20 h-36 w-56 overflow-hidden rounded-md border border-zinc-300 bg-white/95 shadow-md dark:border-zinc-700 dark:bg-zinc-900/95">
          <svg
            className="h-full w-full"
            viewBox={`${miniMapData.minX} ${miniMapData.minY} ${miniMapData.width} ${miniMapData.height}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <rect
              x={miniMapData.minX}
              y={miniMapData.minY}
              width={miniMapData.width}
              height={miniMapData.height}
              fill="#f8fafc"
            />
            {wires.map((w) => (
              <polyline
                key={`mm-w:${w.id}`}
                points={w.points.join(" ")}
                fill="none"
                stroke={w.color || "#3b82f6"}
                strokeWidth={Math.max(2, w.thickness)}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.75"
              />
            ))}
            {devices.map((d) => (
              <rect
                key={`mm-d:${d.id}`}
                x={d.x}
                y={d.y}
                width={d.width}
                height={d.height}
                fill="#64748b"
                fillOpacity="0.35"
                stroke="#334155"
                strokeOpacity="0.6"
              />
            ))}
            <rect
              x={miniMapData.viewport.minX}
              y={miniMapData.viewport.minY}
              width={miniMapData.viewport.maxX - miniMapData.viewport.minX}
              height={miniMapData.viewport.maxY - miniMapData.viewport.minY}
              fill="none"
              stroke="#2563eb"
              strokeWidth="3"
            />
          </svg>
        </div>
      )}

      {/* expose stage to window for export */}
      <StageBridge stageRef={stageRef} viewRef={view} />
    </div>
  );
}

type AlignUpdate = { id: string; patch: Partial<Device> };

function AlignLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 2V14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="4" y="3" width="8" height="2.4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="6.8" width="5.5" height="2.4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="10.6" width="7" height="2.4" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function AlignCenterHIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2V14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="4" y="3" width="8" height="2.4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5.3" y="6.8" width="5.4" height="2.4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4.5" y="10.6" width="7" height="2.4" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function AlignRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M14 2V14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="4" y="3" width="8" height="2.4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6.5" y="6.8" width="5.5" height="2.4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5" y="10.6" width="7" height="2.4" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function AlignTopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 2H14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="3" y="4" width="2.4" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6.8" y="4" width="2.4" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10.6" y="4" width="2.4" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function AlignCenterVIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8H14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="3" y="4" width="2.4" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6.8" y="5.3" width="2.4" height="5.4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10.6" y="4.5" width="2.4" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function AlignBottomIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 14H14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="3" y="4" width="2.4" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6.8" y="6.5" width="2.4" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10.6" y="5" width="2.4" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function DistributeHIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 2V14M14 2V14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="4.2" y="4" width="2.4" height="8" rx="0.9" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.4" y="5.2" width="2.4" height="5.6" rx="0.9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function DistributeVIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 2H14M2 14H14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="4" y="4.2" width="8" height="2.4" rx="0.9" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5.2" y="9.4" width="5.6" height="2.4" rx="0.9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function AlignmentToolbar({
  devices,
  onApply,
}: {
  devices: Device[];
  onApply: (updates: AlignUpdate[]) => void;
}) {
  if (devices.length < 2) return null;
  const lefts = devices.map((d) => d.x);
  const rights = devices.map((d) => d.x + d.width);
  const tops = devices.map((d) => d.y);
  const bottoms = devices.map((d) => d.y + d.height);
  const minLeft = Math.min(...lefts);
  const maxRight = Math.max(...rights);
  const minTop = Math.min(...tops);
  const maxBottom = Math.max(...bottoms);
  const cx = (minLeft + maxRight) / 2;
  const cy = (minTop + maxBottom) / 2;

  const alignLeft = () =>
    onApply(devices.map((d) => ({ id: d.id, patch: { x: minLeft } })));
  const alignRight = () =>
    onApply(devices.map((d) => ({ id: d.id, patch: { x: maxRight - d.width } })));
  const alignCenterH = () =>
    onApply(devices.map((d) => ({ id: d.id, patch: { x: cx - d.width / 2 } })));
  const alignTop = () =>
    onApply(devices.map((d) => ({ id: d.id, patch: { y: minTop } })));
  const alignBottom = () =>
    onApply(devices.map((d) => ({ id: d.id, patch: { y: maxBottom - d.height } })));
  const alignCenterV = () =>
    onApply(devices.map((d) => ({ id: d.id, patch: { y: cy - d.height / 2 } })));

  const distributeH = () => {
    if (devices.length < 3) return;
    const sorted = [...devices].sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalSpan = last.x + last.width / 2 - (first.x + first.width / 2);
    const step = totalSpan / (sorted.length - 1);
    const startCx = first.x + first.width / 2;
    onApply(
      sorted.map((d, i) => ({
        id: d.id,
        patch: { x: startCx + step * i - d.width / 2 },
      }))
    );
  };
  const distributeV = () => {
    if (devices.length < 3) return;
    const sorted = [...devices].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalSpan = last.y + last.height / 2 - (first.y + first.height / 2);
    const step = totalSpan / (sorted.length - 1);
    const startCy = first.y + first.height / 2;
    onApply(
      sorted.map((d, i) => ({
        id: d.id,
        patch: { y: startCy + step * i - d.height / 2 },
      }))
    );
  };

  const btn = "flex h-7 w-7 items-center justify-center rounded text-xs hover:bg-zinc-200 dark:hover:bg-zinc-700";

  return (
    <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white px-1.5 py-1 shadow-md dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center gap-0.5 text-zinc-700 dark:text-zinc-200">
        <button onClick={alignLeft} className={btn} title="ชิดซ้าย"><AlignLeftIcon /></button>
        <button onClick={alignCenterH} className={btn} title="จัดกึ่งกลางแนวนอน"><AlignCenterHIcon /></button>
        <button onClick={alignRight} className={btn} title="ชิดขวา"><AlignRightIcon /></button>
        <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-zinc-700" />
        <button onClick={alignTop} className={btn} title="ชิดบน"><AlignTopIcon /></button>
        <button onClick={alignCenterV} className={btn} title="จัดกึ่งกลางแนวตั้ง"><AlignCenterVIcon /></button>
        <button onClick={alignBottom} className={btn} title="ชิดล่าง"><AlignBottomIcon /></button>
        {devices.length >= 3 && (
          <>
            <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-zinc-700" />
            <button onClick={distributeH} className={btn} title="เฉลี่ยแนวนอน"><DistributeHIcon /></button>
            <button onClick={distributeV} className={btn} title="เฉลี่ยแนวตั้ง"><DistributeVIcon /></button>
          </>
        )}
      </div>
    </div>
  );
}

function Grid({
  view,
  size,
}: {
  view: { x: number; y: number; scale: number };
  size: { w: number; h: number };
}) {
  const step = 20;
  const lines: React.ReactElement[] = [];
  const x0 = -view.x / view.scale;
  const y0 = -view.y / view.scale;
  const x1 = x0 + size.w / view.scale;
  const y1 = y0 + size.h / view.scale;
  const startX = Math.floor(x0 / step) * step;
  const startY = Math.floor(y0 / step) * step;
  for (let x = startX; x < x1; x += step) {
    lines.push(
      <Line
        key={`v${x}`}
        points={[x, y0, x, y1]}
        stroke="#e5e7eb"
        strokeWidth={1 / view.scale}
      />
    );
  }
  for (let y = startY; y < y1; y += step) {
    lines.push(
      <Line
        key={`h${y}`}
        points={[x0, y, x1, y]}
        stroke="#e5e7eb"
        strokeWidth={1 / view.scale}
      />
    );
  }
  return <>{lines}</>;
}

// Bridge: register stage ref on a global so ExportButton can access it
function StageBridge({
  stageRef,
  viewRef,
}: {
  stageRef: React.RefObject<Konva.Stage | null>;
  viewRef: { x: number; y: number; scale: number };
}) {
  useEffect(() => {
    (
      window as unknown as { __taraStage?: Konva.Stage | null }
    ).__taraStage = stageRef.current;
    (
      window as unknown as {
        __taraView?: { x: number; y: number; scale: number };
      }
    ).__taraView = viewRef;
  });
  return null;
}
