import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Merge consecutive collinear / duplicate points (a-b-c on same H or V line) */
function mergeCollinearStore(pts: number[]): number[] {
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
    if (Math.abs(cx - px) < EPS && Math.abs(cy - py) < EPS) continue;
    const prevH = Math.abs(py - cy) < EPS;
    const prevV = Math.abs(px - cx) < EPS;
    const nextH = Math.abs(cy - ny) < EPS;
    const nextV = Math.abs(cx - nx) < EPS;
    if ((prevH && nextH) || (prevV && nextV)) continue;
    out.push(cx, cy);
  }
  const lx = out[out.length - 2];
  const ly = out[out.length - 1];
  const ex = pts[pts.length - 2];
  const ey = pts[pts.length - 1];
  if (!(Math.abs(ex - lx) < EPS && Math.abs(ey - ly) < EPS)) out.push(ex, ey);
  return out;
}

export type Tool = "select" | "pin" | "wire" | "text" | "pan" | "terminal" | "exportFrame";
export type InteractionMode = "edit" | "view";

export type Terminal = {
  id: string;
  fx: number; // 0..1 fraction of device width
  fy: number; // 0..1 fraction of device height
  label: string;
};

export type DeviceTemplate = {
  id: string;
  name: string;
  src: string;
  publicId?: string; // Cloudinary public_id for deletion
  category?: string; // e.g. "Breaker", "Contactor", etc.
  terminals: Terminal[]; // defined once, shared by all device instances
};

export type Device = {
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

export type Wire = {
  id: string;
  points: number[]; // [x1,y1,x2,y2,...]
  color: string;
  thickness: number;
  label?: string;
  /** Wire layer ID (e.g. main-power, control). undefined = default/legacy */
  layerId?: string;
  /** Terminal the wire starts from */
  startBind?: { deviceId: string; terminalId: string };
  /** Terminal the wire ends at */
  endBind?: { deviceId: string; terminalId: string };
  /** Tap on another wire (start): parametric t=0..1 along that wire */
  startWireBind?: { wireId: string; t: number };
  /** Tap on another wire (end): parametric t=0..1 along that wire */
  endWireBind?: { wireId: string; t: number };
  /** Routing direction: false = H-first (default), true = V-first */
  vFirst?: boolean;
};

export type WireLayer = {
  id: string;
  name: string;
  /** Default wire cross-section in sq.mm for wires in this layer */
  thickness?: number;
};

/** Built-in default wire layers (used when project has none yet). */
export const DEFAULT_WIRE_LAYERS: WireLayer[] = [
  { id: "main-power", name: "เมนพาวเวอร์", thickness: 4 },
  { id: "control", name: "คอนโทรล", thickness: 1.5 },
];

export type CanvasLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  rotation?: number;
};

/** Snapshot of canvas content used by undo/redo */
type HistorySnapshot = {
  devices: Device[];
  wires: Wire[];
  labels: CanvasLabel[];
};

/** Max number of undo steps kept in memory */
const HISTORY_LIMIT = 50;
/** Continuous updates (e.g. while dragging) within this window collapse into a single history entry */
const HISTORY_COALESCE_MS = 500;

/** Module-scoped coalescing state for update-style mutations */
let _lastCoalesceAt = 0;
let _lastCoalesceKey = "";
/**
 * Depth of the active history "transaction". While > 0 the auto-snapshot helpers
 * become no-ops — the caller is expected to have already pushed exactly one
 * snapshot via `beginHistory()` before mutating state. Used to batch drag /
 * transform operations into a single undo entry.
 */
let _txDepth = 0;

type State = {
  templates: DeviceTemplate[];
  devices: Device[];
  wires: Wire[];
  labels: CanvasLabel[];
  categories: string[];

  /** Undo/redo history (canvas content only) */
  past: HistorySnapshot[];
  future: HistorySnapshot[];

  activeTool: Tool;
  interactionMode: InteractionMode;
  activeTemplateId: string | null;
  selectedIds: string[];

  wireColor: string;
  wireThickness: number;
  /** Committed points of the wire being drawn (orthogonal path) */
  draftFixed: number[] | null;

  /** Wire layers (project-scoped) */
  wireLayers: WireLayer[];
  /** Active layer for newly-drawn wires */
  activeWireLayerId: string | null;

  // Wire layers
  addWireLayer: (name: string) => string;
  renameWireLayer: (id: string, name: string) => void;
  updateWireLayer: (id: string, patch: Partial<Omit<WireLayer, "id">>) => void;
  removeWireLayer: (id: string) => void;
  setActiveWireLayer: (id: string | null) => void;
  moveWiresToLayer: (wireIds: string[], layerId: string | null) => void;

  // Templates
  addTemplate: (t: Omit<DeviceTemplate, "terminals">) => void;
  updateTemplate: (id: string, patch: Partial<Omit<DeviceTemplate, "id">>) => void;
  removeTemplate: (id: string) => void;
  setActiveTemplate: (id: string | null) => void;
  addTemplateTerminal: (templateId: string, t: Terminal) => void;
  updateTemplateTerminal: (templateId: string, tid: string, patch: Partial<Terminal>) => void;
  removeTemplateTerminal: (templateId: string, tid: string) => void;

  // Categories
  addCategory: (name: string) => void;
  renameCategory: (oldName: string, newName: string) => void;
  removeCategory: (name: string) => void;

  // Devices
  addDevice: (d: Device) => void;
  updateDevice: (id: string, patch: Partial<Device>) => void;
  removeDevice: (id: string) => void;

  // Wires
  startDraftWire: (x: number, y: number) => void;
  /** Append committed orthogonal points (elbow computed by canvas) */
  appendDraftPoints: (pts: number[]) => void;
  finishDraftWire: (
    startBind?: Wire["startBind"],
    endBind?: Wire["endBind"],
    vFirst?: boolean
  ) => void;
  cancelDraftWire: () => void;
  updateWire: (id: string, patch: Partial<Wire>) => void;
  removeWire: (id: string) => void;

  // Labels
  addLabel: (l: CanvasLabel) => void;
  updateLabel: (id: string, patch: Partial<CanvasLabel>) => void;
  removeLabel: (id: string) => void;

  // Tool / selection
  setTool: (t: Tool) => void;
  setInteractionMode: (mode: InteractionMode) => void;
  setWireColor: (c: string) => void;
  setWireThickness: (n: number) => void;
  wireJumps: boolean;
  setWireJumps: (v: boolean) => void;
  textFontSize: number;
  setTextFontSize: (n: number) => void;
  textColor: string;
  setTextColor: (c: string) => void;
  exportPreview: { ids: string[]; padding: number } | null;
  setExportPreview: (v: { ids: string[]; padding: number } | null) => void;
  exportFrame: { x: number; y: number; width: number; height: number } | null;
  setExportFrame: (v: { x: number; y: number; width: number; height: number } | null) => void;
  // Bulk hydrate from DB
  setField: <K extends keyof State>(key: K, value: State[K]) => void;
  dbStatus: "idle" | "saving" | "saved" | "error";
  setDbStatus: (s: "idle" | "saving" | "saved" | "error") => void;
  // Project management
  currentProjectId: string;
  currentProjectName: string;
  setCurrentProject: (id: string, name: string) => void;
  clearCanvas: () => void;
  setSelected: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  clearSelected: () => void;

  // Undo / Redo
  pushHistory: () => void;
  /** Begin a batched history transaction (pushes one snapshot, suppresses auto-snapshots until endHistory). */
  beginHistory: () => void;
  /** Close a transaction opened by beginHistory. Calls must be balanced. */
  endHistory: () => void;
  /**
   * Force-close any open transaction without clearing history.
   * Call on window mouseup to recover from cases where onDragEnd never fires
   * (e.g. mouse released outside the browser window).
   */
  flushHistory: () => void;
  undo: () => void;
  redo: () => void;
  resetHistory: () => void;
};

/**
 * Convert a cable cross-section area (sq.mm) to a visual stroke-width in canvas pixels.
 * Uses a square-root scale so large cables remain visually distinct without being huge.
 */
export function sqmmToStroke(sqmm: number): number {
  return Math.max(1, 1 + Math.sqrt(Math.max(0, sqmm)) * 1.2);
}

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const useEditorStore = create<State>()(
  persist(
    (set, get) => {
      /** Capture current canvas content into the past stack (clears redo future). */
      const snapshot = (): void => {
        if (_txDepth > 0) return; // already captured at transaction begin
        const s = get();
        const snap: HistorySnapshot = {
          devices: s.devices,
          wires: s.wires,
          labels: s.labels,
        };
        const past = s.past.length >= HISTORY_LIMIT
          ? [...s.past.slice(s.past.length - HISTORY_LIMIT + 1), snap]
          : [...s.past, snap];
        set({ past, future: [] });
      };

      /** Coalesced snapshot for high-frequency updates (drag/transform). */
      const snapshotCoalesced = (key: string): void => {
        if (_txDepth > 0) return; // a drag/transform owns the snapshot
        const now = Date.now();
        if (now - _lastCoalesceAt > HISTORY_COALESCE_MS || _lastCoalesceKey !== key) {
          snapshot();
        }
        _lastCoalesceAt = now;
        _lastCoalesceKey = key;
      };

      return ({
  templates: [],
  devices: [],
  wires: [],
  labels: [],
  categories: [],

  past: [],
  future: [],

  activeTool: "select",
  interactionMode: "edit",
  activeTemplateId: null,
  selectedIds: [],

  wireColor: "#dc2626",
  wireThickness: 1.5,
  draftFixed: null,
  textFontSize: 18,
  textColor: "#111827",

  wireLayers: [...DEFAULT_WIRE_LAYERS],
  activeWireLayerId: DEFAULT_WIRE_LAYERS[0]?.id ?? null,

  addWireLayer: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return "";
    const id = uid();
    set((s) => ({
      wireLayers: [...s.wireLayers, { id, name: trimmed }],
      activeWireLayerId: s.activeWireLayerId ?? id,
    }));
    return id;
  },
  renameWireLayer: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((s) => ({
      wireLayers: s.wireLayers.map((l) => (l.id === id ? { ...l, name: trimmed } : l)),
    }));
  },
  updateWireLayer: (id, patch) => {
    set((s) => ({
      wireLayers: s.wireLayers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      // propagate new thickness to all wires in this layer
      wires: typeof patch.thickness === "number"
        ? s.wires.map((w) => (w.layerId === id ? { ...w, thickness: patch.thickness as number } : w))
        : s.wires,
    }));
  },
  removeWireLayer: (id) => {
    snapshot();
    set((s) => {
      const remaining = s.wireLayers.filter((l) => l.id !== id);
      const fallback = remaining[0]?.id ?? null;
      return {
        wireLayers: remaining,
        wires: s.wires.map((w) => (w.layerId === id ? { ...w, layerId: fallback ?? undefined } : w)),
        activeWireLayerId: s.activeWireLayerId === id ? fallback : s.activeWireLayerId,
      };
    });
  },
  setActiveWireLayer: (id) => set({ activeWireLayerId: id }),
  moveWiresToLayer: (wireIds, layerId) => {
    if (wireIds.length === 0) return;
    snapshot();
    const ids = new Set(wireIds);
    set((s) => {
      const layer = layerId ? s.wireLayers.find((l) => l.id === layerId) : undefined;
      return {
        wires: s.wires.map((w) => {
          if (!ids.has(w.id)) return w;
          const updated: typeof w = { ...w, layerId: layerId ?? undefined };
          if (layer?.thickness !== undefined) updated.thickness = layer.thickness;
          return updated;
        }),
      };
    });
  },

  addTemplate: (t) =>
    set((s) => ({ templates: [...s.templates, { ...t, terminals: [] }] })),
  updateTemplate: (id, patch) =>
    set((s) => ({
      templates: s.templates.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  removeTemplate: (id) =>
    set((s) => ({
      templates: s.templates.filter((t) => t.id !== id),
      activeTemplateId: s.activeTemplateId === id ? null : s.activeTemplateId,
    })),
  setActiveTemplate: (id) =>
    set({ activeTemplateId: id, activeTool: id ? "pin" : "select" }),

  addTemplateTerminal: (templateId, t) =>
    set((s) => ({
      templates: s.templates.map((tpl) =>
        tpl.id === templateId ? { ...tpl, terminals: [...tpl.terminals, t] } : tpl
      ),
    })),
  updateTemplateTerminal: (templateId, tid, patch) =>
    set((s) => ({
      templates: s.templates.map((tpl) =>
        tpl.id === templateId
          ? { ...tpl, terminals: tpl.terminals.map((t) => t.id === tid ? { ...t, ...patch } : t) }
          : tpl
      ),
    })),
  removeTemplateTerminal: (templateId, tid) =>
    set((s) => ({
      templates: s.templates.map((tpl) =>
        tpl.id === templateId
          ? { ...tpl, terminals: tpl.terminals.filter((t) => t.id !== tid) }
          : tpl
      ),
    })),

  addCategory: (name) =>
    set((s) =>
      s.categories.includes(name) ? s : { categories: [...s.categories, name] }
    ),
  renameCategory: (oldName, newName) =>
    set((s) => ({
      categories: s.categories.map((c) => (c === oldName ? newName : c)),
      templates: s.templates.map((t) =>
        t.category === oldName ? { ...t, category: newName } : t
      ),
    })),
  removeCategory: (name) =>
    set((s) => ({
      categories: s.categories.filter((c) => c !== name),
      templates: s.templates.map((t) =>
        t.category === name ? { ...t, category: undefined } : t
      ),
    })),

  addDevice: (d) => {
    snapshot();
    set((s) => ({ devices: [...s.devices, d] }));
  },
  updateDevice: (id, patch) => {
    snapshotCoalesced(`device:${id}`);
    set((s) => ({
      devices: s.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
  },
  removeDevice: (id) => {
    snapshot();
    set((s) => {
      const wireIdsToRemove = new Set(
        s.wires
          .filter((w) => w.startBind?.deviceId === id || w.endBind?.deviceId === id)
          .map((w) => w.id)
      );

      // Also remove wires that are tapped onto removed wires (recursive cascade)
      let changed = true;
      while (changed) {
        changed = false;
        for (const w of s.wires) {
          if (wireIdsToRemove.has(w.id)) continue;
          const linkedToRemovedWire =
            (w.startWireBind && wireIdsToRemove.has(w.startWireBind.wireId)) ||
            (w.endWireBind && wireIdsToRemove.has(w.endWireBind.wireId));
          if (linkedToRemovedWire) {
            wireIdsToRemove.add(w.id);
            changed = true;
          }
        }
      }

      return {
        devices: s.devices.filter((d) => d.id !== id),
        wires: s.wires.filter((w) => !wireIdsToRemove.has(w.id)),
        selectedIds: s.selectedIds.filter((sid) => sid !== id && !wireIdsToRemove.has(sid)),
      };
    });
  },

  startDraftWire: (x, y) => set({ draftFixed: [x, y] }),
  appendDraftPoints: (pts) =>
    set((s) => (s.draftFixed ? { draftFixed: [...s.draftFixed, ...pts] } : s)),
  finishDraftWire: (startBind?, endBind?, vFirst?) => {
    const { draftFixed, wireColor, wireThickness, activeWireLayerId, wireLayers } = get();
    if (!draftFixed || draftFixed.length < 4) { set({ draftFixed: null }); return; }
    // Merge consecutive collinear points (a-b-c on the same H or V line)
    const cleaned = mergeCollinearStore(draftFixed);
    if (cleaned.length < 4) { set({ draftFixed: null }); return; }
    const activeLayer = activeWireLayerId ? wireLayers.find((l) => l.id === activeWireLayerId) : undefined;
    const thickness = activeLayer?.thickness ?? wireThickness;
    const wire: Wire = {
      id: uid(),
      points: cleaned,
      color: wireColor,
      thickness,
      startBind,
      endBind,
      vFirst,
      layerId: activeWireLayerId ?? undefined,
    };
    snapshot();
    set((s) => ({ wires: [...s.wires, wire], draftFixed: null }));
  },
  cancelDraftWire: () => set({ draftFixed: null }),
  updateWire: (id, patch) => {
    snapshotCoalesced(`wire:${id}`);
    set((s) => ({
      wires: s.wires.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    }));
  },
  removeWire: (id) => {
    snapshot();
    set((s) => ({
      wires: s.wires.filter((w) => w.id !== id),
      selectedIds: s.selectedIds.filter((sid) => sid !== id),
    }));
  },

  addLabel: (l) => {
    snapshot();
    set((s) => ({ labels: [...s.labels, l] }));
  },
  updateLabel: (id, patch) => {
    snapshotCoalesced(`label:${id}`);
    set((s) => ({
      labels: s.labels.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
  },
  removeLabel: (id) => {
    snapshot();
    set((s) => ({
      labels: s.labels.filter((l) => l.id !== id),
      selectedIds: s.selectedIds.filter((sid) => sid !== id),
    }));
  },

  setTool: (t) =>
    set({
      activeTool: t,
      activeTemplateId: t === "pin" ? get().activeTemplateId : null,
      draftFixed: t === "wire" ? get().draftFixed : null,
    }),
  setInteractionMode: (mode) =>
    set((s) => ({
      interactionMode: mode,
      activeTool: mode === "view" ? "select" : s.activeTool,
      activeTemplateId: mode === "view" ? null : s.activeTemplateId,
      draftFixed: mode === "view" ? null : s.draftFixed,
    })),
  setWireColor: (c) => set({ wireColor: c }),
  setWireThickness: (n) => set({ wireThickness: n }),
  setTextFontSize: (n) => set({ textFontSize: n }),
  setTextColor: (c) => set({ textColor: c }),
  wireJumps: false,
  setWireJumps: (v) => set({ wireJumps: v }),
  exportPreview: null,
  setExportPreview: (v) => set({ exportPreview: v }),
  exportFrame: null,
  setExportFrame: (v) => set({ exportFrame: v }),
  setField: (key, value) => {
    set({ [key]: value } as Partial<State>);
    if (key === "devices" || key === "wires" || key === "labels") {
      _lastCoalesceAt = 0;
      _lastCoalesceKey = "";
      set({ past: [], future: [] });
    }
  },
  dbStatus: "idle",
  setDbStatus: (s) => set({ dbStatus: s }),
  currentProjectId: "default",
  currentProjectName: "Untitled",
  setCurrentProject: (id, name) => {
    _lastCoalesceAt = 0;
    _lastCoalesceKey = "";
    set({ currentProjectId: id, currentProjectName: name, past: [], future: [] });
  },
  clearCanvas: () => {
    snapshot();
    set({
      devices: [],
      wires: [],
      labels: [],
      selectedIds: [],
      activeTemplateId: null,
      draftFixed: null,
    });
  },
  setSelected: (ids) => set({ selectedIds: ids }),
  toggleSelected: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  clearSelected: () => set({ selectedIds: [] }),

  pushHistory: () => snapshot(),
  beginHistory: () => {
    if (_txDepth === 0) {
      // Take exactly one snapshot at the boundary of the transaction.
      // Bypass coalescing so the entry isn't merged with a stale prior burst.
      _lastCoalesceAt = 0;
      _lastCoalesceKey = "";
      snapshot();
    }
    _txDepth++;
  },
  endHistory: () => {
    if (_txDepth > 0) _txDepth--;
    if (_txDepth === 0) {
      // Reset coalesce so the next discrete edit always pushes.
      _lastCoalesceAt = 0;
      _lastCoalesceKey = "";
    }
  },
  flushHistory: () => {
    if (_txDepth > 0) {
      _txDepth = 0;
      _lastCoalesceAt = 0;
      _lastCoalesceKey = "";
    }
  },
  resetHistory: () => {
    _lastCoalesceAt = 0;
    _lastCoalesceKey = "";
    _txDepth = 0;
    set({ past: [], future: [] });
  },
  undo: () => {
    const s = get();
    if (s.past.length === 0) return;
    const prev = s.past[s.past.length - 1];
    const current: HistorySnapshot = {
      devices: s.devices,
      wires: s.wires,
      labels: s.labels,
    };
    _lastCoalesceAt = 0;
    _lastCoalesceKey = "";
    _txDepth = 0;
    set({
      past: s.past.slice(0, -1),
      future: [...s.future, current],
      devices: prev.devices,
      wires: prev.wires,
      labels: prev.labels,
      selectedIds: [],
      draftFixed: null,
    });
  },
  redo: () => {
    const s = get();
    if (s.future.length === 0) return;
    const next = s.future[s.future.length - 1];
    const current: HistorySnapshot = {
      devices: s.devices,
      wires: s.wires,
      labels: s.labels,
    };
    _lastCoalesceAt = 0;
    _lastCoalesceKey = "";
    _txDepth = 0;
    set({
      future: s.future.slice(0, -1),
      past: [...s.past, current],
      devices: next.devices,
      wires: next.wires,
      labels: next.labels,
      selectedIds: [],
      draftFixed: null,
    });
  },
    });
    },
    {
      name: "tara-editor-v1",
      partialize: (s) => ({
        devices: s.devices,
        wires: s.wires,
        labels: s.labels,
        categories: s.categories,
        wireColor: s.wireColor,
        wireThickness: s.wireThickness,
        wireJumps: s.wireJumps,
        wireLayers: s.wireLayers,
        activeWireLayerId: s.activeWireLayerId,
        exportFrame: s.exportFrame,
        currentProjectId: s.currentProjectId,
        currentProjectName: s.currentProjectName,
      }),
    }
  )
);
