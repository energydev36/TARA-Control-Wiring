"use client";

import { useState } from "react";
import { useEditorStore, sqmmToStroke } from "@/lib/store";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Layers,
  Pencil,
  Plus,
  Trash2,
  X,
  Zap,
} from "lucide-react";

const SQMM_PRESETS = [0.5, 1, 1.5, 2.5, 4, 6, 10, 16, 25];

export default function WireLayerPanel() {
  const [newLayerName, setNewLayerName] = useState("");
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingLayerDraft, setEditingLayerDraft] = useState("");
  /** Layer whose thickness editor is open */
  const [thicknessLayerId, setThicknessLayerId] = useState<string | null>(null);
  /** Layers whose wire list is expanded */
  const [openWireLayers, setOpenWireLayers] = useState<Set<string>>(new Set());

  const wireLayers = useEditorStore((s) => s.wireLayers);
  const activeWireLayerId = useEditorStore((s) => s.activeWireLayerId);
  const addWireLayer = useEditorStore((s) => s.addWireLayer);
  const renameWireLayer = useEditorStore((s) => s.renameWireLayer);
  const removeWireLayer = useEditorStore((s) => s.removeWireLayer);
  const setActiveWireLayer = useEditorStore((s) => s.setActiveWireLayer);
  const moveWiresToLayer = useEditorStore((s) => s.moveWiresToLayer);
  const updateWireLayer = useEditorStore((s) => s.updateWireLayer);
  const removeWire = useEditorStore((s) => s.removeWire);
  const interactionMode = useEditorStore((s) => s.interactionMode);
  const wires = useEditorStore((s) => s.wires);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const setSelected = useEditorStore((s) => s.setSelected);

  const selectedWires = wires.filter((w) => selectedIds.includes(w.id));
  const activeLayer = wireLayers.find((l) => l.id === activeWireLayerId);
  const unassignedWires = wires.filter((w) => !w.layerId || !wireLayers.find((l) => l.id === w.layerId));

  const toggleWireList = (layerId: string) =>
    setOpenWireLayers((prev) => {
      const n = new Set(prev);
      n.has(layerId) ? n.delete(layerId) : n.add(layerId);
      return n;
    });

  if (interactionMode === "view") return null;

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-l border-zinc-200 bg-white text-sm dark:border-zinc-800 dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <Layers size={14} className="text-zinc-500" />
        <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
          เลเยอร์สายไฟ
        </h2>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
          {wireLayers.length}
        </span>
      </div>

      {/* Active layer indicator */}
      <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <p className="mb-1 text-[10px] font-medium uppercase text-zinc-400">เลเยอร์ใช้งาน</p>
        {activeLayer ? (
          <div className="flex items-center gap-1.5 rounded-md border border-blue-400 bg-blue-50 px-2 py-1.5 dark:border-blue-600 dark:bg-blue-950">
            <div className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="flex-1 truncate text-xs font-medium text-blue-700 dark:text-blue-300">
              {activeLayer.name}
            </span>
            <span className="text-[10px] text-blue-500">
              {wires.filter((w) => w.layerId === activeLayer.id).length} เส้น
            </span>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-zinc-300 px-2 py-1.5 text-center text-[11px] text-zinc-400 dark:border-zinc-700">
            ไม่มีเลเยอร์ที่ใช้งาน
          </div>
        )}
      </div>

      {/* Selected wire — move layer */}
      {selectedWires.length > 0 && (
        <div className="border-b border-zinc-100 bg-blue-50 px-3 py-2 dark:border-zinc-800 dark:bg-blue-950/30">
          <p className="mb-1.5 text-[10px] font-medium uppercase text-blue-600 dark:text-blue-400">
            {selectedWires.length === 1 ? "สายไฟที่เลือก" : `สายไฟที่เลือก (${selectedWires.length})`}
          </p>
          <label className="flex items-center gap-2 text-xs">
            <span className="shrink-0 text-zinc-500">ย้ายไป</span>
            {wireLayers.length === 0 ? (
              <span className="text-[11px] italic text-zinc-400">ยังไม่มีเลเยอร์</span>
            ) : (() => {
              const firstLayer = selectedWires[0].layerId ?? "";
              const sameLayer = selectedWires.every((w) => (w.layerId ?? "") === firstLayer);
              return (
                <div className="relative flex-1">
                  <select
                    value={sameLayer ? firstLayer : ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      moveWiresToLayer(
                        selectedWires.map((w) => w.id),
                        v === "" ? null : v
                      );
                    }}
                    className="w-full appearance-none rounded border border-zinc-300 bg-white py-1 pl-2 pr-6 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {!sameLayer && <option value="">– หลากหลาย –</option>}
                    <option value="">(ไม่มีเลเยอร์)</option>
                    {wireLayers.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={11} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                </div>
              );
            })()}
          </label>
        </div>
      )}

      {/* Layer list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {wireLayers.length === 0 && (
          <div className="m-2 rounded border border-dashed border-zinc-300 p-3 text-center text-[11px] text-zinc-400 dark:border-zinc-700">
            ยังไม่มีเลเยอร์ · เพิ่มด้านล่าง
          </div>
        )}

        {wireLayers.map((layer) => {
          const isActive = layer.id === activeWireLayerId;
          const isEditing = editingLayerId === layer.id;
          const isThicknessOpen = thicknessLayerId === layer.id;
          const isWiresOpen = openWireLayers.has(layer.id);
          const layerWires = wires.filter((w) => w.layerId === layer.id);
          const layerThickness = layer.thickness ?? 1.5;

          return (
            <div
              key={layer.id}
              className={`border-b transition-colors ${
                isActive
                  ? "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/50"
                  : "border-zinc-100 dark:border-zinc-800"
              }`}
            >
              {/* Layer header row */}
              <div className="flex items-center gap-1 px-2 py-1.5">
                <button
                  onClick={() => toggleWireList(layer.id)}
                  className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                  title={isWiresOpen ? "ซ่อนรายการสายไฟ" : "แสดงรายการสายไฟ"}
                >
                  {isWiresOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>

                {isEditing ? (
                  <>
                    <input
                      autoFocus
                      value={editingLayerDraft}
                      onChange={(e) => setEditingLayerDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { renameWireLayer(layer.id, editingLayerDraft); setEditingLayerId(null); }
                        else if (e.key === "Escape") setEditingLayerId(null);
                      }}
                      className="flex-1 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <button onClick={() => { renameWireLayer(layer.id, editingLayerDraft); setEditingLayerId(null); }}
                      className="rounded p-0.5 text-green-600 hover:bg-green-100" title="บันทึก">
                      <Check size={12} />
                    </button>
                    <button onClick={() => setEditingLayerId(null)}
                      className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100" title="ยกเลิก">
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setActiveWireLayer(layer.id)}
                      className="flex min-w-0 flex-1 flex-col text-left"
                    >
                      <span className={`text-xs ${isActive ? "font-semibold text-blue-700 dark:text-blue-300" : "text-zinc-700 dark:text-zinc-300"}`}>
                        {layer.name}
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        {layerThickness} sq.mm · {layerWires.length} เส้น
                      </span>
                    </button>
                    <button
                      onClick={() => setThicknessLayerId(isThicknessOpen ? null : layer.id)}
                      className={`rounded p-0.5 transition-colors ${isThicknessOpen ? "text-orange-500" : "text-zinc-400 hover:text-zinc-600"} hover:bg-zinc-100 dark:hover:bg-zinc-800`}
                      title="ตั้งค่าขนาดสาย"
                    >
                      <Zap size={11} />
                    </button>
                    <button
                      onClick={() => { setEditingLayerId(layer.id); setEditingLayerDraft(layer.name); }}
                      className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                      title="เปลี่ยนชื่อ"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={() => {
                        const msg = layerWires.length > 0
                          ? `เลเยอร์นี้มีสายไฟ ${layerWires.length} เส้น จะถูกย้ายไปเลเยอร์อื่น ยืนยันลบ "${layer.name}"?`
                          : `ลบเลเยอร์ "${layer.name}"?`;
                        if (confirm(msg)) removeWireLayer(layer.id);
                      }}
                      className="rounded p-0.5 text-zinc-400 hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900"
                      title="ลบเลเยอร์"
                    >
                      <Trash2 size={11} />
                    </button>
                  </>
                )}
              </div>

              {/* Thickness editor */}
              {isThicknessOpen && !isEditing && (
                <div className="border-t border-zinc-200 bg-orange-50 px-3 py-2 dark:border-zinc-700 dark:bg-orange-950/20">
                  <p className="mb-1.5 text-[10px] font-medium text-orange-700 dark:text-orange-400">ขนาดสายค่าเริ่มต้น (sq.mm)</p>
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {SQMM_PRESETS.map((v) => (
                      <button
                        key={v}
                        onClick={() => updateWireLayer(layer.id, { thickness: v })}
                        className={`rounded px-1.5 py-0.5 text-[10px] tabular-nums transition-colors ${
                          layerThickness === v
                            ? "bg-orange-500 text-white"
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range" min={0.5} max={50} step={0.5}
                      value={Math.min(layerThickness, 50)}
                      onChange={(e) => updateWireLayer(layer.id, { thickness: parseFloat(e.target.value) })}
                      className="flex-1"
                    />
                    <input
                      type="number" min={0.1} max={240} step={0.1}
                      value={layerThickness}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v > 0) updateWireLayer(layer.id, { thickness: v });
                      }}
                      className="w-14 rounded border border-zinc-300 bg-white px-1 py-0.5 text-right text-[11px] tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </div>
                </div>
              )}

              {/* Wire list */}
              {isWiresOpen && (
                <div className="border-t border-zinc-100 dark:border-zinc-800">
                  {layerWires.length === 0 ? (
                    <p className="px-8 py-2 text-[11px] italic text-zinc-400">ยังไม่มีสายไฟในเลเยอร์นี้</p>
                  ) : (
                    <ul>
                      {layerWires.map((w, i) => {
                        const isSelected = selectedIds.includes(w.id);
                        const wireName = w.label?.trim() || `${layer.name} ${i + 1}`;
                        const dotSize = Math.min(14, Math.max(3, sqmmToStroke(w.thickness)));
                        return (
                          <li
                            key={w.id}
                            className={`group flex cursor-pointer items-center gap-2 px-4 py-1 transition-colors ${
                              isSelected
                                ? "bg-blue-100 dark:bg-blue-900/40"
                                : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                            }`}
                            onClick={() => setSelected([w.id])}
                            title={`${wireName} — ${w.thickness} sq.mm`}
                          >
                            <div className="flex w-4 shrink-0 items-center justify-center">
                              <div
                                className="rounded-full"
                                style={{ width: dotSize, height: dotSize, backgroundColor: w.color }}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={`truncate text-xs ${isSelected ? "font-medium text-blue-700 dark:text-blue-300" : "text-zinc-700 dark:text-zinc-300"}`}>
                                {wireName}
                              </p>
                              <p className="text-[10px] text-zinc-400">{w.thickness} sq.mm</p>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); removeWire(w.id); }}
                              className="hidden rounded p-0.5 text-zinc-400 hover:bg-red-100 hover:text-red-500 group-hover:block dark:hover:bg-red-900"
                              title="ลบสายไฟ"
                            >
                              <X size={11} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Unassigned wires */}
        {unassignedWires.length > 0 && (
          <div className="border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button
                onClick={() => toggleWireList("__unassigned__")}
                className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100"
              >
                {openWireLayers.has("__unassigned__") ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              <div className="flex-1">
                <span className="text-xs text-zinc-500">ไม่มีเลเยอร์</span>
                <span className="ml-1 text-[10px] text-zinc-400">({unassignedWires.length} เส้น)</span>
              </div>
            </div>
            {openWireLayers.has("__unassigned__") && (
              <div className="border-t border-zinc-100 dark:border-zinc-800">
                <ul>
                  {unassignedWires.map((w, i) => {
                    const isSelected = selectedIds.includes(w.id);
                    const wireName = w.label?.trim() || `สายไฟ ${i + 1}`;
                    const dotSize = Math.min(14, Math.max(3, sqmmToStroke(w.thickness)));
                    return (
                      <li
                        key={w.id}
                        className={`group flex cursor-pointer items-center gap-2 px-4 py-1 transition-colors ${
                          isSelected ? "bg-blue-100 dark:bg-blue-900/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                        }`}
                        onClick={() => setSelected([w.id])}
                      >
                        <div className="flex w-4 shrink-0 items-center justify-center">
                          <div
                            className="rounded-full"
                            style={{ width: dotSize, height: dotSize, backgroundColor: w.color }}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-xs ${isSelected ? "font-medium text-blue-700 dark:text-blue-300" : "text-zinc-600 dark:text-zinc-400"}`}>
                            {wireName}
                          </p>
                          <p className="text-[10px] text-zinc-400">{w.thickness} sq.mm</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeWire(w.id); }}
                          className="hidden rounded p-0.5 text-zinc-400 hover:bg-red-100 hover:text-red-500 group-hover:block dark:hover:bg-red-900"
                          title="ลบสายไฟ"
                        >
                          <X size={11} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add layer */}
      <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        <div className="flex gap-1">
          <input
            value={newLayerName}
            onChange={(e) => setNewLayerName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newLayerName.trim()) {
                const id = addWireLayer(newLayerName);
                if (id) setActiveWireLayer(id);
                setNewLayerName("");
              }
            }}
            placeholder="ชื่อเลเยอร์ใหม่..."
            className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            onClick={() => {
              if (!newLayerName.trim()) return;
              const id = addWireLayer(newLayerName);
              if (id) setActiveWireLayer(id);
              setNewLayerName("");
            }}
            disabled={!newLayerName.trim()}
            className="flex items-center gap-0.5 rounded border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            title="เพิ่มเลเยอร์"
          >
            <Plus size={12} />
            เพิ่ม
          </button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-400">
          คลิกเลเยอร์เพื่อตั้งเป็นเลเยอร์ใช้งาน
          <br />
          สายไฟใหม่จะวาดในเลเยอร์ที่เลือก
        </p>
      </div>
    </aside>
  );
}
