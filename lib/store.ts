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
};

export type Wire = {
  id: string;
  points: number[]; // [x1,y1,x2,y2,...]
  color: string;
  thickness: number;
  label?: string;
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

export type CanvasLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
};

type State = {
  templates: DeviceTemplate[];
  devices: Device[];
  wires: Wire[];
  labels: CanvasLabel[];
  categories: string[];

  activeTool: Tool;
  activeTemplateId: string | null;
  selectedIds: string[];

  wireColor: string;
  wireThickness: number;
  /** Committed points of the wire being drawn (orthogonal path) */
  draftFixed: number[] | null;

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
  setWireColor: (c: string) => void;
  setWireThickness: (n: number) => void;
  wireJumps: boolean;
  setWireJumps: (v: boolean) => void;
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
};

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const useEditorStore = create<State>()(
  persist(
    (set, get) => ({
  templates: [],
  devices: [],
  wires: [],
  labels: [],
  categories: [],

  activeTool: "select",
  activeTemplateId: null,
  selectedIds: [],

  wireColor: "#dc2626",
  wireThickness: 2,
  draftFixed: null,

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

  addDevice: (d) => set((s) => ({ devices: [...s.devices, d] })),
  updateDevice: (id, patch) =>
    set((s) => ({
      devices: s.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })),
  removeDevice: (id) =>
    set((s) => ({
      devices: s.devices.filter((d) => d.id !== id),
      selectedIds: s.selectedIds.filter((sid) => sid !== id),
    })),

  startDraftWire: (x, y) => set({ draftFixed: [x, y] }),
  appendDraftPoints: (pts) =>
    set((s) => (s.draftFixed ? { draftFixed: [...s.draftFixed, ...pts] } : s)),
  finishDraftWire: (startBind?, endBind?, vFirst?) => {
    const { draftFixed, wireColor, wireThickness } = get();
    if (!draftFixed || draftFixed.length < 4) { set({ draftFixed: null }); return; }
    // Merge consecutive collinear points (a-b-c on the same H or V line)
    const cleaned = mergeCollinearStore(draftFixed);
    if (cleaned.length < 4) { set({ draftFixed: null }); return; }
    const wire: Wire = {
      id: uid(),
      points: cleaned,
      color: wireColor,
      thickness: wireThickness,
      startBind,
      endBind,
      vFirst,
    };
    set((s) => ({ wires: [...s.wires, wire], draftFixed: null }));
  },
  cancelDraftWire: () => set({ draftFixed: null }),
  updateWire: (id, patch) =>
    set((s) => ({
      wires: s.wires.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    })),
  removeWire: (id) =>
    set((s) => ({
      wires: s.wires.filter((w) => w.id !== id),
      selectedIds: s.selectedIds.filter((sid) => sid !== id),
    })),

  addLabel: (l) => set((s) => ({ labels: [...s.labels, l] })),
  updateLabel: (id, patch) =>
    set((s) => ({
      labels: s.labels.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),
  removeLabel: (id) =>
    set((s) => ({
      labels: s.labels.filter((l) => l.id !== id),
      selectedIds: s.selectedIds.filter((sid) => sid !== id),
    })),

  setTool: (t) =>
    set({
      activeTool: t,
      activeTemplateId: t === "pin" ? get().activeTemplateId : null,
      draftFixed: t === "wire" ? get().draftFixed : null,
    }),
  setWireColor: (c) => set({ wireColor: c }),
  setWireThickness: (n) => set({ wireThickness: n }),
  wireJumps: false,
  setWireJumps: (v) => set({ wireJumps: v }),
  exportPreview: null,
  setExportPreview: (v) => set({ exportPreview: v }),
  exportFrame: null,
  setExportFrame: (v) => set({ exportFrame: v }),
  setField: (key, value) => set({ [key]: value } as Partial<State>),
  dbStatus: "idle",
  setDbStatus: (s) => set({ dbStatus: s }),
  currentProjectId: "default",
  currentProjectName: "Untitled",
  setCurrentProject: (id, name) => set({ currentProjectId: id, currentProjectName: name }),
  clearCanvas: () =>
    set({
      devices: [],
      wires: [],
      labels: [],
      selectedIds: [],
      activeTemplateId: null,
      draftFixed: null,
    }),
  setSelected: (ids) => set({ selectedIds: ids }),
  toggleSelected: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  clearSelected: () => set({ selectedIds: [] }),
    }),
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
        exportFrame: s.exportFrame,
        currentProjectId: s.currentProjectId,
        currentProjectName: s.currentProjectName,
      }),
    }
  )
);

export { uid };
