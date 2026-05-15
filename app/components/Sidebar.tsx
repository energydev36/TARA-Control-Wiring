"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore, uid, type Tool, type Terminal } from "@/lib/store";
import ExportButton from "./ExportButton";
import { ProjectManager } from "./ProjectManager";
import {
  MousePointer2,
  Spline,
  Crop,
  Settings2,
  Scissors,
  X,
  Check,
  FolderPlus,
  Pencil,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Type,
  Eye,
  Undo2,
  Redo2,
} from "lucide-react";

const tools: { id: Tool; label: string; icon: React.ReactNode }[] = [
  { id: "select", label: "Select", icon: <MousePointer2 size={16} /> },
  { id: "wire", label: "Wire", icon: <Spline size={16} /> },
  { id: "text", label: "Text", icon: <Type size={16} /> },
  { id: "exportFrame", label: "Export Frame", icon: <Crop size={16} /> },
];

const presetColors = [
  "#dc2626", // red - L
  "#1d4ed8", // blue - N
  "#16a34a", // green - GND
  "#f59e0b", // yellow
  "#000000", // black
  "#ffffff", // white
];

export default function Sidebar() {
  const fileRef = useRef<HTMLInputElement>(null);
  // Which template is open in the terminal editor
  const [editingTplId, setEditingTplId] = useState<string | null>(null);
  // Pending new terminal label input
  const [pendingTerminal, setPendingTerminal] = useState<{ fx: number; fy: number; id: string } | null>(null);
  const [pendingLabel, setPendingLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null); // null = All
  const [addCatInput, setAddCatInput] = useState("");
  const [showAddCat, setShowAddCat] = useState(false);
  const [editCatName, setEditCatName] = useState<string | null>(null);
  const [editCatDraft, setEditCatDraft] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const {
    templates,
    addTemplate,
    removeTemplate,
    activeTool,
    interactionMode,
    setInteractionMode,
    setTool,
    activeTemplateId,
    setActiveTemplate,
    wireColor,
    setWireColor,
    wireThickness,
    setWireThickness,
    wireJumps,
    setWireJumps,
    textFontSize,
    setTextFontSize,
    textColor,
    setTextColor,
    selectedIds,
    devices,
    wires,
    labels,
    removeDevice,
    removeWire,
    removeLabel,
    updateWire,
    updateLabel,
    addTemplateTerminal,
    updateTemplateTerminal,
    removeTemplateTerminal,
    updateTemplate,
    categories,
    addCategory,
    renameCategory,
    removeCategory,
    currentProjectName,
    setExportPreview,
  } = useEditorStore();

  const pastLen = useEditorStore((s) => s.past.length);
  const futureLen = useEditorStore((s) => s.future.length);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const handleToolClick = (tool: Tool) => {
    if (interactionMode === "view" && tool !== "select") return;
    setTool(tool);
    if (tool === "exportFrame") {
      const ids = [...devices.map((d) => d.id), ...wires.map((w) => w.id), ...labels.map((l) => l.id)];
      setExportPreview({ ids, padding: 0 });
      return;
    }
    // hide preview when leaving export tool, but keep frame for next time
    setExportPreview(null);
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      await Promise.all(
        Array.from(files).map(async (file) => {
          if (!file.type.startsWith("image/")) return;
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch("/api/cloudinary/upload", { method: "POST", body: formData });
          if (!res.ok) {
            const err = await res.json();
            alert(`อัปโหลดล้มเหลว: ${err.error}`);
            return;
          }
          const { url, publicId } = await res.json();
          addTemplate({
            id: uid(),
            name: file.name.replace(/\.[^.]+$/, ""),
            src: url,
            publicId,
            category: activeCategory ?? undefined,
          });
        })
      );
    } finally {
      setUploading(false);
    }
  };

  const deleteSelected = () => {
    selectedIds.forEach((id) => {
      if (devices.find((d) => d.id === id)) removeDevice(id);
      if (wires.find((w) => w.id === id)) removeWire(id);
      if (labels.find((l) => l.id === id)) removeLabel(id);
    });
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-zinc-200 bg-white text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold">Tara Control</h1>
          <button
            onClick={() => setShowProjectManager(true)}
            title="จัดการโปรเจค"
            className="flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <FolderOpen size={13} />
            โปรเจค
          </button>
        </div>
        <p className="mt-0.5 truncate text-xs text-zinc-500" title={currentProjectName}>
          {currentProjectName}
        </p>
      </div>
      <ProjectManager open={showProjectManager} onClose={() => setShowProjectManager(false)} />

      {/* Tools */}
      <section className="border-b border-zinc-200 p-3 dark:border-zinc-800">
        <h2 className="mb-2 text-xs font-medium uppercase text-zinc-500">
          Tools
        </h2>
        <div className="mb-2 grid grid-cols-2 gap-1">
          <button
            onClick={() => undo()}
            disabled={pastLen === 0 || interactionMode === "view"}
            title={`เลิกทำ (Ctrl/Cmd+Z)  •  ${pastLen}/50`}
            className="flex items-center justify-center gap-1 rounded-md border border-zinc-200 px-2 py-1.5 text-xs transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <Undo2 size={13} />
            เลิกทำ
            {pastLen > 0 && (
              <span className="ml-0.5 rounded bg-zinc-200 px-1 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {pastLen}
              </span>
            )}
          </button>
          <button
            onClick={() => redo()}
            disabled={futureLen === 0 || interactionMode === "view"}
            title={`ทำซ้ำ (Ctrl/Cmd+Shift+Z)  •  ${futureLen}`}
            className="flex items-center justify-center gap-1 rounded-md border border-zinc-200 px-2 py-1.5 text-xs transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <Redo2 size={13} />
            ทำซ้ำ
            {futureLen > 0 && (
              <span className="ml-0.5 rounded bg-zinc-200 px-1 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {futureLen}
              </span>
            )}
          </button>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1">
          <button
            onClick={() => setInteractionMode("edit")}
            className={`flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
              interactionMode === "edit"
                ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950"
                : "border-zinc-200 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
            }`}
            title="โหมดแก้ไข"
          >
            <Pencil size={13} />
            แก้ไข
          </button>
          <button
            onClick={() => setInteractionMode("view")}
            className={`flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
              interactionMode === "view"
                ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950"
                : "border-zinc-200 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
            }`}
            title="โหมดดูอย่างเดียว"
          >
            <Eye size={13} />
            ดูอย่างเดียว
          </button>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {tools.map((t) => (
            <button
              key={t.id}
              onClick={() => handleToolClick(t.id)}
              disabled={interactionMode === "view" && t.id !== "select"}
              className={`flex flex-col items-center justify-center rounded-md border px-1 py-2 text-xs transition-colors ${
                activeTool === t.id
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950"
                  : "border-zinc-200 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
              } ${(interactionMode === "view" && t.id !== "select") ? "cursor-not-allowed opacity-40" : ""}`}
              title={t.label}
            >
              <span className="flex items-center justify-center">{t.icon}</span>
              <span className="mt-1">{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Wire settings */}
      {interactionMode === "edit" && activeTool === "wire" && (
        <section className="border-b border-zinc-200 p-3 dark:border-zinc-800">
          <h2 className="mb-2 text-xs font-medium uppercase text-zinc-500">
            Wire
          </h2>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {presetColors.map((c) => (
              <button
                key={c}
                onClick={() => setWireColor(c)}
                className={`h-6 w-6 rounded-full border ${
                  wireColor === c
                    ? "ring-2 ring-blue-500 ring-offset-1"
                    : "border-zinc-300"
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
            <input
              type="color"
              value={wireColor}
              onChange={(e) => setWireColor(e.target.value)}
              className="h-6 w-6 cursor-pointer rounded-full border border-zinc-300 bg-transparent"
              title="Custom color"
            />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">Thickness</span>
            <input
              type="range"
              min={1}
              max={10}
              value={wireThickness}
              onChange={(e) => setWireThickness(Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-6 text-right tabular-nums">{wireThickness}</span>
          </label>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs select-none">
            <div
              onClick={() => setWireJumps(!wireJumps)}
              className={`relative h-4 w-8 rounded-full transition-colors ${
                wireJumps ? "bg-blue-500" : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                  wireJumps ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </div>
            <span className="text-zinc-600 dark:text-zinc-400">Wire Jumps</span>
          </label>
        </section>
      )}

      {/* Selected wire properties */}
      {interactionMode === "edit" && (() => {
        const selectedWires = wires.filter((w) => selectedIds.includes(w.id));
        if (selectedWires.length === 0) return null;
        const firstWire = selectedWires[0];
        const sameColor = selectedWires.every((w) => w.color === firstWire.color);
        const sameThickness = selectedWires.every((w) => w.thickness === firstWire.thickness);
        const applyColor = (c: string) => selectedWires.forEach((w) => updateWire(w.id, { color: c }));
        const applyThickness = (t: number) => selectedWires.forEach((w) => updateWire(w.id, { thickness: t }));
        return (
          <section className="border-b border-zinc-200 p-3 dark:border-zinc-800 bg-blue-50 dark:bg-blue-950">
            <h2 className="mb-2 text-xs font-medium uppercase text-blue-600 dark:text-blue-400">
              {selectedWires.length === 1 ? "Selected Wire" : `Selected Wires (${selectedWires.length})`}
            </h2>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {["#1d4ed8","#dc2626","#16a34a","#d97706","#7c3aed","#0891b2","#000000","#6b7280"].map((c) => (
                <button
                  key={c}
                  onClick={() => applyColor(c)}
                  className={`h-6 w-6 rounded-full border ${
                    sameColor && firstWire.color === c
                      ? "ring-2 ring-blue-500 ring-offset-1"
                      : "border-zinc-300"
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
              <input
                type="color"
                value={sameColor ? firstWire.color : "#000000"}
                onChange={(e) => applyColor(e.target.value)}
                className="h-6 w-6 cursor-pointer rounded-full border border-zinc-300 bg-transparent"
                title="Custom color"
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">Thickness</span>
              <input
                type="range"
                min={1}
                max={10}
                value={sameThickness ? firstWire.thickness : 2}
                onChange={(e) => applyThickness(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-6 text-right tabular-nums">
                {sameThickness ? firstWire.thickness : "–"}
              </span>
            </label>
          </section>
        );
      })()}

      {/* Text tool settings */}
      {interactionMode === "edit" && activeTool === "text" && (
        <section className="border-b border-zinc-200 p-3 dark:border-zinc-800">
          <h2 className="mb-2 text-xs font-medium uppercase text-zinc-500">Text</h2>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {["#111827","#dc2626","#1d4ed8","#16a34a","#f59e0b","#7c3aed","#6b7280","#ffffff"].map((c) => (
              <button
                key={c}
                onClick={() => setTextColor(c)}
                className={`h-6 w-6 rounded-full border ${
                  textColor === c ? "ring-2 ring-blue-500 ring-offset-1" : "border-zinc-300"
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
            <input
              type="color"
              value={textColor}
              onChange={(e) => setTextColor(e.target.value)}
              className="h-6 w-6 cursor-pointer rounded-full border border-zinc-300 bg-transparent"
              title="Custom color"
            />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">ขนาด</span>
            <input
              type="range"
              min={8}
              max={72}
              value={textFontSize}
              onChange={(e) => setTextFontSize(Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-8 text-right tabular-nums">{textFontSize}px</span>
          </label>
        </section>
      )}

      {/* Selected label properties */}
      {interactionMode === "edit" && (() => {
        const selectedLabels = labels.filter((l) => selectedIds.includes(l.id));
        if (selectedLabels.length === 0) return null;
        const first = selectedLabels[0];
        const sameColor = selectedLabels.every((l) => l.color === first.color);
        const sameFontSize = selectedLabels.every((l) => l.fontSize === first.fontSize);
        const applyColor = (c: string) => selectedLabels.forEach((l) => updateLabel(l.id, { color: c }));
        const applyFontSize = (n: number) => selectedLabels.forEach((l) => updateLabel(l.id, { fontSize: n }));
        return (
          <section className="border-b border-zinc-200 p-3 dark:border-zinc-800 bg-amber-50 dark:bg-amber-950">
            <h2 className="mb-2 text-xs font-medium uppercase text-amber-600 dark:text-amber-400">
              {selectedLabels.length === 1 ? "Selected Text" : `Selected Texts (${selectedLabels.length})`}
            </h2>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {["#111827","#dc2626","#1d4ed8","#16a34a","#f59e0b","#7c3aed","#6b7280","#ffffff"].map((c) => (
                <button
                  key={c}
                  onClick={() => applyColor(c)}
                  className={`h-6 w-6 rounded-full border ${
                    sameColor && first.color === c ? "ring-2 ring-blue-500 ring-offset-1" : "border-zinc-300"
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
              <input
                type="color"
                value={sameColor ? first.color : "#000000"}
                onChange={(e) => applyColor(e.target.value)}
                className="h-6 w-6 cursor-pointer rounded-full border border-zinc-300 bg-transparent"
                title="Custom color"
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">ขนาด</span>
              <input
                type="range"
                min={8}
                max={72}
                value={sameFontSize ? first.fontSize : 18}
                onChange={(e) => applyFontSize(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-8 text-right tabular-nums">
                {sameFontSize ? `${first.fontSize}px` : "–"}
              </span>
            </label>
          </section>
        );
      })()}

      {/* Library */}
      <section className="flex min-h-0 flex-1 flex-col border-b border-zinc-200 dark:border-zinc-800">
        {/* Header */}
        <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <span className="flex-1 text-xs font-medium uppercase text-zinc-500">Device Library</span>
          <button onClick={() => setShowAddCat((v) => !v)} className="flex items-center rounded px-1.5 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="เพิ่มหมวดหมู่">
            <FolderPlus size={13} />
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            {uploading ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
            {uploading ? "กำลังอัปโหลด…" : "+ Upload"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }} />
        </div>

        {/* Add category */}
        {showAddCat && (
          <div className="flex gap-1.5 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <input autoFocus type="text" value={addCatInput} onChange={(e) => setAddCatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && addCatInput.trim()) { addCategory(addCatInput.trim()); setAddCatInput(""); setShowAddCat(false); } if (e.key === "Escape") setShowAddCat(false); }}
              placeholder="ชื่อหมวดหมู่ เช่น Breaker"
              className="flex-1 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
            <button onClick={() => { if (addCatInput.trim()) addCategory(addCatInput.trim()); setAddCatInput(""); setShowAddCat(false); }}
              className="rounded bg-blue-600 px-2 py-1 text-white hover:bg-blue-700"><Check size={12} /></button>
            <button onClick={() => setShowAddCat(false)} className="rounded bg-zinc-100 px-2 py-1 hover:bg-zinc-200 dark:bg-zinc-800"><X size={12} /></button>
          </div>
        )}

        {/* Category filter dropdown */}
        <div className="px-3 py-2">
          <label className="mb-1 block text-[11px] font-medium text-zinc-500">หมวดหมู่</label>
          <select
            value={activeCategory ?? ""}
            onChange={(e) => setActiveCategory(e.target.value || null)}
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <option value="">ทั้งหมด ({templates.length})</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat} ({templates.filter((tpl) => tpl.category === cat).length})
              </option>
            ))}
          </select>
          <label className="mb-1 mt-2 block text-[11px] font-medium text-zinc-500">ค้นหาชื่ออุปกรณ์</label>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="พิมพ์ชื่ออุปกรณ์..."
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          />
        </div>

        {/* Template list */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {(() => {
            const q = searchTerm.trim().toLowerCase();
            const filteredByCategory = activeCategory
              ? templates.filter((tpl) => tpl.category === activeCategory)
              : templates;
            const filtered = filteredByCategory.filter(
              (tpl) => !q || tpl.name.toLowerCase().includes(q)
            );
            if (filtered.length === 0) {
              if (templates.length === 0) {
                return <div className="py-6 text-center text-xs text-zinc-400">อัปโหลดรูปอุปกรณ์เพื่อเริ่มต้น</div>;
              }
              return (
                <div className="py-6 text-center text-xs text-zinc-400">
                  ไม่พบอุปกรณ์ที่ตรงกับคำค้นหา
                </div>
              );
            }
            if (activeCategory) {
              return (
                <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                  {filtered.map((tpl) => (
                    <TemplateCard key={tpl.id} t={tpl} categories={categories} activeTemplateId={activeTemplateId}
                      editingTplId={editingTplId} setActiveTemplate={setActiveTemplate}
                      setEditingTplId={setEditingTplId} removeTemplate={removeTemplate} updateTemplate={updateTemplate} />
                  ))}
                </div>
              );
            }
            // Grouped view
            const uncategorized = filtered.filter((tpl) => !tpl.category);
            const groups: { name: string; items: typeof templates }[] = categories
              .map((c) => ({ name: c, items: filtered.filter((tpl) => tpl.category === c) }))
              .filter((g) => g.items.length > 0);
            if (uncategorized.length > 0) groups.push({ name: "__none__", items: uncategorized });
            return (
              <div className="pb-2">
                {groups.map((g) => {
                  const collapsed = collapsedCats.has(g.name);
                  const label = g.name === "__none__" ? "ไม่มีหมวดหมู่" : g.name;
                  return (
                    <div key={g.name}>
                      <div className="flex items-center gap-1 bg-zinc-50 px-3 py-1.5 dark:bg-zinc-900/60">
                        <button onClick={() => setCollapsedCats((prev) => { const n = new Set(prev); n.has(g.name) ? n.delete(g.name) : n.add(g.name); return n; })}
                          className="flex flex-1 items-center gap-1 text-left">
                          {collapsed ? <ChevronRight size={12} className="text-zinc-400" /> : <ChevronDown size={12} className="text-zinc-400" />}
                          <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">{label}</span>
                          <span className="ml-1 text-[10px] text-zinc-400">({g.items.length})</span>
                        </button>
                        {g.name !== "__none__" && (
                          editCatName === g.name ? (
                            <div className="flex gap-1">
                              <input autoFocus value={editCatDraft} onChange={(e) => setEditCatDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && editCatDraft.trim()) { renameCategory(g.name, editCatDraft.trim()); if (activeCategory === g.name) setActiveCategory(editCatDraft.trim()); setEditCatName(null); }
                                  if (e.key === "Escape") setEditCatName(null);
                                }}
                                className="w-24 rounded border border-zinc-300 px-1 py-0.5 text-[11px] dark:border-zinc-700 dark:bg-zinc-900" />
                              <button onClick={() => { if (editCatDraft.trim()) { renameCategory(g.name, editCatDraft.trim()); if (activeCategory === g.name) setActiveCategory(editCatDraft.trim()); } setEditCatName(null); }} className="text-green-600"><Check size={11} /></button>
                              <button onClick={() => setEditCatName(null)} className="text-zinc-400"><X size={11} /></button>
                            </div>
                          ) : (
                            <>
                              <button onClick={() => { setEditCatName(g.name); setEditCatDraft(g.name); }} className="rounded p-0.5 text-zinc-400 hover:text-zinc-600"><Pencil size={11} /></button>
                              <button onClick={() => { removeCategory(g.name); if (activeCategory === g.name) setActiveCategory(null); }} className="rounded p-0.5 text-zinc-400 hover:text-red-500"><X size={11} /></button>
                            </>
                          )
                        )}
                      </div>
                      {!collapsed && (
                        <div className="grid grid-cols-2 gap-2 px-3 py-2">
                          {g.items.map((tpl) => (
                            <TemplateCard key={tpl.id} t={tpl} categories={categories} activeTemplateId={activeTemplateId}
                              editingTplId={editingTplId} setActiveTemplate={setActiveTemplate}
                              setEditingTplId={setEditingTplId} removeTemplate={removeTemplate} updateTemplate={updateTemplate} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </section>

      {/* Terminal Editor Modal */}
      {editingTplId && (() => {
        const tpl = templates.find((t) => t.id === editingTplId);
        if (!tpl) return null;
        return (
          <TerminalEditorModal
            templateName={tpl.name}
            templateSrc={tpl.src}
            terminals={tpl.terminals}
            pendingTerminal={pendingTerminal}
            pendingLabel={pendingLabel}
            setPendingTerminal={setPendingTerminal}
            setPendingLabel={setPendingLabel}
            onAdd={(term) => addTemplateTerminal(tpl.id, term)}
            onUpdate={(id, patch) => updateTemplateTerminal(tpl.id, id, patch)}
            onRemove={(id) => removeTemplateTerminal(tpl.id, id)}
            onCrop={async (newSrc, mappedTerminals) => {
              try {
                const blob = await fetch(newSrc).then((r) => r.blob());
                const formData = new FormData();
                formData.append("file", new File([blob], `${tpl.id}-crop.png`, { type: "image/png" }));
                const up = await fetch("/api/cloudinary/upload", { method: "POST", body: formData });
                if (!up.ok) {
                  const err = await up.json().catch(() => ({ error: "unknown" }));
                  alert(`อัปโหลดรูปครอปล้มเหลว: ${err.error ?? "unknown"}`);
                  return;
                }
                const { url, publicId } = await up.json();
                updateTemplate(tpl.id, { src: url, publicId, terminals: mappedTerminals });

                if (tpl.publicId && tpl.publicId !== publicId) {
                  fetch("/api/cloudinary/delete", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ publicId: tpl.publicId }),
                  }).catch(() => {});
                }
              } catch {
                alert("อัปโหลดรูปครอปล้มเหลว");
              }
            }}
            onRename={(name) => updateTemplate(tpl.id, { name })}
            onClose={() => {
              setEditingTplId(null);
              setPendingTerminal(null);
              setPendingLabel("");
            }}
          />
        );
      })()}

      {/* Actions */}
      <section className="space-y-2 p-3">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Selected: {selectedIds.length}</span>
          <div className="flex items-center gap-2">
            <DbStatusBadge />
            <button
              onClick={deleteSelected}
              disabled={selectedIds.length === 0 || interactionMode === "view"}
              className="rounded-md border border-zinc-200 px-2 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              Delete
            </button>
          </div>
        </div>
        <ExportButton />
      </section>
    </aside>
  );
}

function DbStatusBadge() {
  const status = useEditorStore((s) => s.dbStatus);
  if (status === "idle") return null;
  return (
    <span className={`flex items-center gap-1 text-[10px] ${status === "saving" ? "text-zinc-400" : status === "saved" ? "text-green-600" : "text-red-500"}`}>
      {status === "saving" && <span className="h-2 w-2 animate-spin rounded-full border border-zinc-400 border-t-transparent" />}
      {status === "saved" && "✓ บันทึกแล้ว"}
      {status === "error" && "✕ บันทึกไม่สำเร็จ"}
      {status === "saving" && "กำลังบันทึก…"}
    </span>
  );
}

function TemplateCard({
  t,
  categories,
  activeTemplateId,
  editingTplId,
  setActiveTemplate,
  setEditingTplId,
  removeTemplate,
  updateTemplate,
}: {
  t: import("@/lib/store").DeviceTemplate;
  categories: string[];
  activeTemplateId: string | null;
  editingTplId: string | null;
  setActiveTemplate: (id: string | null) => void;
  setEditingTplId: (id: string | null) => void;
  removeTemplate: (id: string) => void;
  updateTemplate: (id: string, patch: Partial<import("@/lib/store").DeviceTemplate>) => void;
}) {
  return (
    <div
      className={`group relative self-start cursor-pointer rounded-md border p-1 transition-colors ${
        activeTemplateId === t.id
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
          : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800"
      }`}
    >
      <div className="flex h-20 w-full items-center justify-center rounded bg-zinc-50 dark:bg-zinc-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={t.src} alt={t.name} draggable={false}
          className="h-16 w-full cursor-pointer object-contain"
          onClick={() => setActiveTemplate(activeTemplateId === t.id ? null : t.id)} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-1">
        <span className="truncate text-[10px] text-zinc-600 dark:text-zinc-400">{t.name}</span>
        <button
          onClick={() => setEditingTplId(editingTplId === t.id ? null : t.id)}
          className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${editingTplId === t.id ? "bg-orange-500 text-white" : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300"}`}
          title="ตั้งค่า/กำหนดจุดต่อสาย"
        >
          <span className="flex items-center gap-0.5"><Settings2 size={11} /> {t.terminals.length}</span>
        </button>
      </div>
      {/* Category badge + changer */}
      {categories.length > 0 && (
        <select
          value={t.category ?? ""}
          onChange={(e) => updateTemplate(t.id, { category: e.target.value || undefined })}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 w-full rounded border border-zinc-200 bg-zinc-50 px-1 py-0.5 text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">— ไม่มีหมวด —</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
      <button
        onClick={async (e) => {
          e.stopPropagation();
          removeTemplate(t.id);
          if (t.publicId) {
            await fetch("/api/cloudinary/delete", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publicId: t.publicId }),
            });
          }
        }}
        className="absolute right-0.5 top-0.5 hidden h-5 w-5 items-center justify-center rounded-full bg-zinc-900/70 text-xs text-white group-hover:flex"
        title="Remove"
      >
        ×
      </button>
    </div>
  );
}

function TerminalRow({
  index,
  terminal,
  isFocused,
  inputRef,
  onRowClick,
  onEnter,
  onLabelChange,
  onDelete,
}: {
  index: number;
  terminal: Terminal;
  isFocused?: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
  onRowClick?: () => void;
  onEnter?: () => void;
  onLabelChange: (v: string) => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onRowClick}
      className={`flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors ${
        isFocused ? "bg-blue-50 dark:bg-blue-950/40" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
      }`}
    >
      <span className="w-4 text-right text-[10px] text-zinc-400">{index}.</span>
      <div className="h-3 w-3 shrink-0 rounded-full border-2 border-red-500 bg-white" />
      <input
        ref={inputRef}
        type="text"
        value={terminal.label}
        onChange={(e) => onLabelChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter?.();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        className="min-w-0 flex-1 rounded border border-zinc-300 px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        placeholder="Label..."
      />
      <span className="text-[9px] text-zinc-400">
        ({Math.round(terminal.fx * 100)}%, {Math.round(terminal.fy * 100)}%)
      </span>
      <button
        onClick={onDelete}
        className="flex items-center justify-center text-zinc-400 hover:text-red-500"
        title="ลบ"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function TerminalEditorModal({
  templateName,
  templateSrc,
  terminals,
  pendingTerminal,
  pendingLabel,
  setPendingTerminal,
  setPendingLabel,
  onAdd,
  onUpdate,
  onRemove,
  onCrop,
  onRename,
  onClose,
}: {
  templateName: string;
  templateSrc: string;
  terminals: Terminal[];
  pendingTerminal: { fx: number; fy: number; id: string } | null;
  pendingLabel: string;
  setPendingTerminal: (v: { fx: number; fy: number; id: string } | null) => void;
  setPendingLabel: (v: string) => void;
  onAdd: (t: Terminal) => void;
  onUpdate: (id: string, patch: Partial<Terminal>) => void;
  onRemove: (id: string) => void;
  onCrop: (newSrc: string, mappedTerminals: Terminal[]) => Promise<void>;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  const stageScrollRef = useRef<HTMLDivElement>(null);
  const imgWrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const draggingRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const suppressNextWrapClickRef = useRef(false);
  const [snapGuide, setSnapGuide] = useState<{ fx?: number; fy?: number } | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [connectPointTool, setConnectPointTool] = useState(false);
  const [nameDraft, setNameDraft] = useState(templateName);
  const [imageZoom, setImageZoom] = useState(1);
  const [baseImageSize, setBaseImageSize] = useState<{ width: number; height: number } | null>(null);
  const [focusedTerminalId, setFocusedTerminalId] = useState<string | null>(null);
  const terminalInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Crop rect in fractional coords (0..1)
  const [cropRect, setCropRect] = useState<{ fx: number; fy: number; fw: number; fh: number } | null>(null);
  const cropDragRef = useRef<{ startFx: number; startFy: number } | null>(null);
  const cropResizeRef = useRef<{
    handle: "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
    startFx: number;
    startFy: number;
    rect: { fx: number; fy: number; fw: number; fh: number };
  } | null>(null);

  useEffect(() => {
    setNameDraft(templateName);
  }, [templateName]);

  useEffect(() => {
    if (!focusedTerminalId) return;
    const input = terminalInputRefs.current[focusedTerminalId];
    if (!input) return;
    input.focus();
    input.select();
    input.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedTerminalId]);

  useEffect(() => {
    if (!focusedTerminalId) return;
    if (!terminals.some((t) => t.id === focusedTerminalId)) {
      setFocusedTerminalId(null);
    }
  }, [focusedTerminalId, terminals]);

  useEffect(() => {
    setImageZoom(1);
    setBaseImageSize(null);
  }, [templateSrc]);

  const clampZoom = (v: number) => Math.max(0.5, Math.min(4, v));

  const captureBaseImageSize = () => {
    const img = imgRef.current;
    if (!img) return;
    const width = img.clientWidth;
    const height = img.clientHeight;
    if (width > 0 && height > 0) {
      setBaseImageSize({ width, height });
    }
  };

  useEffect(() => {
    if (imageZoom !== 1) return;
    const t = window.setTimeout(captureBaseImageSize, 0);
    const onResize = () => captureBaseImageSize();
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, [imageZoom, templateSrc]);

  const commitName = () => {
    const v = nameDraft.trim();
    if (!v) {
      setNameDraft(templateName);
      return;
    }
    if (v !== templateName) onRename(v);
  };

  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pendingTerminal) {
          setPendingTerminal(null);
          setPendingLabel("");
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingTerminal, onClose, setPendingTerminal, setPendingLabel]);

  const fracFromEvent = (clientX: number, clientY: number) => {
    const el = imgWrapRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const fx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const fy = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { fx, fy };
  };

  const ensureDefaultCropRect = () => {
    setCropRect((prev) => prev ?? { fx: 0.1, fy: 0.1, fw: 0.8, fh: 0.8 });
  };

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  const startCropResize = (
    handle: "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw",
    e: React.PointerEvent
  ) => {
    if (!cropRect) return;
    const p = fracFromEvent(e.clientX, e.clientY);
    if (!p) return;
    cropResizeRef.current = {
      handle,
      startFx: p.fx,
      startFy: p.fy,
      rect: { ...cropRect },
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  };

  const snapTerminalAxis = (
    point: { fx: number; fy: number },
    excludeId?: string | null,
    disableSnap = false
  ) => {
    if (disableSnap) {
      setSnapGuide(null);
      return point;
    }

    const el = imgWrapRef.current;
    if (!el) return point;

    const SNAP_PX = 10;
    const fxTol = SNAP_PX / Math.max(1, el.clientWidth);
    const fyTol = SNAP_PX / Math.max(1, el.clientHeight);

    let bestX: { v: number; d: number } | null = null;
    let bestY: { v: number; d: number } | null = null;

    for (const t of terminals) {
      if (excludeId && t.id === excludeId) continue;

      const dx = Math.abs(t.fx - point.fx);
      if (dx <= fxTol && (!bestX || dx < bestX.d)) {
        bestX = { v: t.fx, d: dx };
      }

      const dy = Math.abs(t.fy - point.fy);
      if (dy <= fyTol && (!bestY || dy < bestY.d)) {
        bestY = { v: t.fy, d: dy };
      }
    }

    const snapped = {
      fx: bestX ? bestX.v : point.fx,
      fy: bestY ? bestY.v : point.fy,
    };

    if (bestX || bestY) {
      setSnapGuide({ fx: bestX?.v, fy: bestY?.v });
    } else {
      setSnapGuide(null);
    }

    return snapped;
  };

  // Pointer drag for existing terminals
  const onTerminalPointerDown = (id: string, e: React.PointerEvent) => {
    setFocusedTerminalId(id);
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = id;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    suppressNextWrapClickRef.current = false;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onWrapPointerMove = (e: React.PointerEvent) => {
    if (panStartRef.current) {
      const sc = stageScrollRef.current;
      if (!sc) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) suppressNextWrapClickRef.current = true;
      sc.scrollLeft = panStartRef.current.left - dx;
      sc.scrollTop = panStartRef.current.top - dy;
      return;
    }
    if (!draggingRef.current) return;
    if (dragStartRef.current) {
      const moved = Math.hypot(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y);
      if (moved > 3) suppressNextWrapClickRef.current = true;
    }
    const p = fracFromEvent(e.clientX, e.clientY);
    if (!p) return;
    const snapped = snapTerminalAxis(p, draggingRef.current, e.altKey);
    onUpdate(draggingRef.current, { fx: snapped.fx, fy: snapped.fy });
  };
  const onWrapPointerUp = () => {
    panStartRef.current = null;
    draggingRef.current = null;
    dragStartRef.current = null;
    setSnapGuide(null);
  };

  const commitPending = () => {
    if (!pendingTerminal) return;
    onAdd({
      id: pendingTerminal.id,
      fx: pendingTerminal.fx,
      fy: pendingTerminal.fy,
      label: pendingLabel,
    });
    setPendingTerminal(null);
    setPendingLabel("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[100dvh] w-[100vw] flex-col overflow-hidden bg-white shadow-2xl dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold">กำหนดจุดต่อสาย</h2>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitName();
                }}
                className="w-56 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                placeholder="ชื่ออุปกรณ์"
              />
              <span className="text-xs text-zinc-500">
                {cropMode
                  ? "ลากบนรูปเพื่อเลือกพื้นที่ครอป"
                  : connectPointTool
                  ? "โหมดเชื่อมจุด: คลิกบนรูปเพื่อเพิ่มจุด · ลากจุดเพื่อย้าย · Snap อัตโนมัติ (กด ⌥ ค้างเพื่อไม่ Snap)"
                  : "โหมดเลื่อนดู: ลากรูปเพื่อเลื่อนตำแหน่ง · กด 'เชื่อมจุด' เพื่อเริ่มวางจุด"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConnectPointTool((v) => !v)}
              className={`rounded px-3 py-1 text-xs ${
                connectPointTool
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200"
              }`}
              title="เปิด/ปิดโหมดเชื่อมจุด"
            >
              เชื่อมจุด
            </button>
            <div className="flex items-center overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
              <button
                onClick={() => setImageZoom((z) => clampZoom(z - 0.1))}
                className="px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="Zoom Out"
              >
                −
              </button>
              <button
                onClick={() => setImageZoom(1)}
                className="border-x border-zinc-300 px-2 py-1 text-[11px] tabular-nums text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                title="รีเซ็ตซูม"
              >
                {Math.round(imageZoom * 100)}%
              </button>
              <button
                onClick={() => setImageZoom((z) => clampZoom(z + 0.1))}
                className="px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="Zoom In"
              >
                +
              </button>
            </div>
            <button
              onClick={() => {
                setCropMode((m) => {
                  const next = !m;
                  if (next) ensureDefaultCropRect();
                  else setCropRect(null);
                  return next;
                });
              }}
              className={`rounded px-3 py-1 text-xs ${
                cropMode
                  ? "bg-orange-500 text-white hover:bg-orange-600"
                  : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200"
              }`}
            >
              <span className="flex items-center gap-1"><Scissors size={13} /> ครอป</span>
            </button>
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="ปิด"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body: image + sidebar list */}
        <div className="flex min-h-0 flex-1 gap-3 p-3">
          {/* Image stage */}
          <div ref={stageScrollRef} className="flex min-h-0 flex-1 items-start justify-start overflow-auto rounded bg-zinc-100 p-2 dark:bg-zinc-950">
            <div
              ref={imgWrapRef}
              className={`relative inline-block select-none ${cropMode || connectPointTool ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
              onWheel={(e) => {
                e.preventDefault();
                const step = e.deltaY > 0 ? -0.1 : 0.1;
                setImageZoom((z) => clampZoom(z + step));
              }}
              onPointerMove={(e) => {
                if (cropMode && cropResizeRef.current) {
                  const p = fracFromEvent(e.clientX, e.clientY);
                  if (!p) return;
                  const { handle, startFx, startFy, rect } = cropResizeRef.current;
                  const minSize = 0.05;
                  const dx = p.fx - startFx;
                  const dy = p.fy - startFy;
                  const right0 = rect.fx + rect.fw;
                  const bottom0 = rect.fy + rect.fh;

                  let left = rect.fx;
                  let top = rect.fy;
                  let right = right0;
                  let bottom = bottom0;

                  if (handle === "move") {
                    const nx = clamp01(rect.fx + dx);
                    const ny = clamp01(rect.fy + dy);
                    left = Math.min(nx, 1 - rect.fw);
                    top = Math.min(ny, 1 - rect.fh);
                    right = left + rect.fw;
                    bottom = top + rect.fh;
                  } else {
                    if (handle.includes("w")) left = Math.max(0, Math.min(rect.fx + dx, right0 - minSize));
                    if (handle.includes("e")) right = Math.min(1, Math.max(right0 + dx, left + minSize));
                    if (handle.includes("n")) top = Math.max(0, Math.min(rect.fy + dy, bottom0 - minSize));
                    if (handle.includes("s")) bottom = Math.min(1, Math.max(bottom0 + dy, top + minSize));
                    if (handle === "n") right = right0;
                    if (handle === "s") right = right0;
                    if (handle === "w") bottom = bottom0;
                    if (handle === "e") bottom = bottom0;
                  }

                  setCropRect({
                    fx: left,
                    fy: top,
                    fw: Math.max(minSize, right - left),
                    fh: Math.max(minSize, bottom - top),
                  });
                  return;
                }
                if (cropMode && cropDragRef.current) {
                  const p = fracFromEvent(e.clientX, e.clientY);
                  if (!p) return;
                  const s = cropDragRef.current;
                  const x0 = Math.min(s.startFx, p.fx);
                  const y0 = Math.min(s.startFy, p.fy);
                  const x1 = Math.max(s.startFx, p.fx);
                  const y1 = Math.max(s.startFy, p.fy);
                  setCropRect({ fx: x0, fy: y0, fw: x1 - x0, fh: y1 - y0 });
                  return;
                }
                onWrapPointerMove(e);
              }}
              onPointerDown={(e) => {
                if (!cropMode && !connectPointTool && !draggingRef.current) {
                  const sc = stageScrollRef.current;
                  if (!sc) return;
                  panStartRef.current = {
                    x: e.clientX,
                    y: e.clientY,
                    left: sc.scrollLeft,
                    top: sc.scrollTop,
                  };
                  suppressNextWrapClickRef.current = false;
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  return;
                }
                if (!cropMode) return;
              }}
              onPointerUp={(e) => {
                if (cropMode) {
                  cropResizeRef.current = null;
                  cropDragRef.current = null;
                  return;
                }
                onWrapPointerUp();
              }}
              onPointerLeave={() => {
                if (!draggingRef.current) setSnapGuide(null);
              }}
              onClick={(e) => {
                if (cropMode) return;
                const target = e.target as EventTarget | null;
                const clickedBlankArea = target === e.currentTarget || target === imgRef.current;
                if (clickedBlankArea) {
                  setFocusedTerminalId(null);
                }
                if (!connectPointTool) return;
                if (draggingRef.current) return;
                if (suppressNextWrapClickRef.current) {
                  suppressNextWrapClickRef.current = false;
                  return;
                }
                const p = fracFromEvent(e.clientX, e.clientY);
                if (!p) return;
                const snapped = snapTerminalAxis(p, null, e.altKey);
                setPendingTerminal({ fx: snapped.fx, fy: snapped.fy, id: uid() });
                setPendingLabel("");
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={templateSrc}
                alt={templateName}
                draggable={false}
                onLoad={captureBaseImageSize}
                className={baseImageSize ? "block" : "block max-h-[70vh] max-w-full object-contain"}
                style={
                  baseImageSize
                    ? {
                        width: `${baseImageSize.width * imageZoom}px`,
                        height: `${baseImageSize.height * imageZoom}px`,
                        maxWidth: "none",
                        maxHeight: "none",
                      }
                    : undefined
                }
              />
              {/* Existing terminals (draggable) */}
              {terminals.map((t) => (
                <div
                  key={t.id}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                  style={{ left: `${t.fx * 100}%`, top: `${t.fy * 100}%` }}
                >
                  <div
                    onPointerDown={(e) => onTerminalPointerDown(t.id, e)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFocusedTerminalId(t.id);
                    }}
                    className={`h-5 w-5 cursor-grab rounded-full border-2 bg-white shadow active:cursor-grabbing ${
                      focusedTerminalId === t.id
                        ? "border-blue-600 ring-2 ring-blue-300"
                        : "border-red-500"
                    }`}
                    title="ลากเพื่อย้าย"
                  />
                  {t.label && (
                    <span className="mt-0.5 rounded bg-black/70 px-1 text-[10px] text-white">
                      {t.label}
                    </span>
                  )}
                </div>
              ))}
              {/* Pending */}
              {pendingTerminal && !cropMode && (
                <div
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: `${pendingTerminal.fx * 100}%`,
                    top: `${pendingTerminal.fy * 100}%`,
                  }}
                >
                  <div className="h-5 w-5 animate-pulse rounded-full border-2 border-blue-500 bg-white shadow" />
                </div>
              )}

              {/* Snap guides */}
              {!cropMode && snapGuide?.fx !== undefined && (
                <div
                  className="pointer-events-none absolute inset-y-0 border-l border-dashed border-blue-500/70"
                  style={{ left: `${snapGuide.fx * 100}%` }}
                />
              )}
              {!cropMode && snapGuide?.fy !== undefined && (
                <div
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-blue-500/70"
                  style={{ top: `${snapGuide.fy * 100}%` }}
                />
              )}

              {/* Crop overlay */}
              {cropMode && cropRect && (
                <>
                  {/* Dim outside via 4 rects */}
                  <div
                    className="pointer-events-none absolute inset-0 bg-black/40"
                    style={{
                      clipPath: `polygon(
                        0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                        ${cropRect.fx * 100}% ${cropRect.fy * 100}%,
                        ${cropRect.fx * 100}% ${(cropRect.fy + cropRect.fh) * 100}%,
                        ${(cropRect.fx + cropRect.fw) * 100}% ${(cropRect.fy + cropRect.fh) * 100}%,
                        ${(cropRect.fx + cropRect.fw) * 100}% ${cropRect.fy * 100}%,
                        ${cropRect.fx * 100}% ${cropRect.fy * 100}%
                      )`,
                    }}
                  />
                  <div
                    className="pointer-events-none absolute border-2 border-dashed border-orange-400"
                    style={{
                      left: `${cropRect.fx * 100}%`,
                      top: `${cropRect.fy * 100}%`,
                      width: `${cropRect.fw * 100}%`,
                      height: `${cropRect.fh * 100}%`,
                    }}
                  />
                  {/* Crop drag / resize handles */}
                  <div
                    className="absolute"
                    style={{
                      left: `${cropRect.fx * 100}%`,
                      top: `${cropRect.fy * 100}%`,
                      width: `${cropRect.fw * 100}%`,
                      height: `${cropRect.fh * 100}%`,
                    }}
                    onPointerDown={(e) => startCropResize("move", e)}
                  >
                    <div className="absolute inset-0 cursor-move" />
                    <div className="absolute left-0 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-full border border-orange-500 bg-white" onPointerDown={(e) => startCropResize("nw", e)} />
                    <div className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize rounded-full border border-orange-500 bg-white" onPointerDown={(e) => startCropResize("n", e)} />
                    <div className="absolute right-0 top-0 h-3 w-3 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize rounded-full border border-orange-500 bg-white" onPointerDown={(e) => startCropResize("ne", e)} />
                    <div className="absolute right-0 top-1/2 h-3 w-3 translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border border-orange-500 bg-white" onPointerDown={(e) => startCropResize("e", e)} />
                    <div className="absolute right-0 bottom-0 h-3 w-3 translate-x-1/2 translate-y-1/2 cursor-nwse-resize rounded-full border border-orange-500 bg-white" onPointerDown={(e) => startCropResize("se", e)} />
                    <div className="absolute bottom-0 left-1/2 h-3 w-3 -translate-x-1/2 translate-y-1/2 cursor-ns-resize rounded-full border border-orange-500 bg-white" onPointerDown={(e) => startCropResize("s", e)} />
                    <div className="absolute bottom-0 left-0 h-3 w-3 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize rounded-full border border-orange-500 bg-white" onPointerDown={(e) => startCropResize("sw", e)} />
                    <div className="absolute left-0 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border border-orange-500 bg-white" onPointerDown={(e) => startCropResize("w", e)} />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Side panel: list + input */}
          <div className="flex w-72 shrink-0 flex-col gap-2 overflow-hidden">
            {pendingTerminal && (
              <div className="rounded border border-blue-400 bg-blue-50 p-2 dark:bg-blue-950/40">
                <p className="mb-1 text-[11px] text-blue-700 dark:text-blue-300">
                  จุดใหม่ ({Math.round(pendingTerminal.fx * 100)}%, {Math.round(pendingTerminal.fy * 100)}%)
                </p>
                <div className="flex gap-1">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Label เช่น L1, N, PE"
                    value={pendingLabel}
                    onChange={(e) => setPendingLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitPending();
                    }}
                    className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <button
                    onClick={commitPending}
                    className="flex items-center justify-center rounded bg-green-600 px-2 py-1 text-white hover:bg-green-700"
                    title="ยืนยัน"
                  >
                    <Check size={13} />
                  </button>
                  <button
                    onClick={() => {
                      setPendingTerminal(null);
                      setPendingLabel("");
                    }}
                    className="flex items-center justify-center rounded bg-zinc-200 px-2 py-1 hover:bg-zinc-300 dark:bg-zinc-700"
                    title="ยกเลิก"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            )}
            {cropMode && (
              <div className="rounded border border-orange-400 bg-orange-50 p-2 dark:bg-orange-950/40">
                <p className="mb-1 text-[11px] font-medium text-orange-700 dark:text-orange-300">
                  โหมดครอป
                </p>
                {cropRect && cropRect.fw > 0.01 && cropRect.fh > 0.01 ? (
                  <>
                    <p className="mb-1 text-[10px] text-zinc-600 dark:text-zinc-400">
                      พื้นที่: {Math.round(cropRect.fw * 100)}% × {Math.round(cropRect.fh * 100)}%
                    </p>
                    <div className="flex gap-1">
                      <button
                        onClick={async () => {
                          if (!cropRect) return;
                          const result = await cropImage(templateSrc, cropRect, terminals);
                          if (result) {
                            await onCrop(result.dataUrl, result.terminals);
                            setCropMode(false);
                            setCropRect(null);
                          }
                        }}
                        className="flex items-center justify-center gap-1 flex-1 rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                      >
                        <Check size={12} /> ครอป
                      </button>
                      <button
                        onClick={() => setCropRect(null)}
                        className="rounded bg-zinc-200 px-2 py-1 text-xs hover:bg-zinc-300 dark:bg-zinc-700"
                      >
                        รีเซ็ต
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-[10px] text-zinc-500">ลากบนรูปเพื่อเลือกพื้นที่</p>
                )}
                <button
                  onClick={() => {
                    setCropMode(false);
                    setCropRect(null);
                  }}
                  className="mt-1 w-full rounded bg-zinc-100 px-2 py-1 text-xs hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                >
                  ยกเลิก
                </button>
              </div>
            )}
            <div className="text-[11px] font-medium uppercase text-zinc-500">
              จุดทั้งหมด ({terminals.length})
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded border border-zinc-200 p-1 dark:border-zinc-800">
              {terminals.length === 0 && (
                <p className="py-2 text-center text-[11px] text-zinc-400">
                  คลิกบนรูปเพื่อเพิ่มจุด
                </p>
              )}
              {terminals.map((t, i) => (
                <TerminalRow
                  key={t.id}
                  index={i + 1}
                  terminal={t}
                  isFocused={focusedTerminalId === t.id}
                  inputRef={(el) => {
                    terminalInputRefs.current[t.id] = el;
                  }}
                  onRowClick={() => setFocusedTerminalId(t.id)}
                  onEnter={() => setFocusedTerminalId(null)}
                  onLabelChange={(v) => onUpdate(t.id, { label: v })}
                  onDelete={() => onRemove(t.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Crop the image at the given fractional rect and remap terminal coordinates */
async function cropImage(
  src: string,
  rect: { fx: number; fy: number; fw: number; fh: number },
  terminals: Terminal[]
): Promise<{ dataUrl: string; terminals: Terminal[] } | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const sx = rect.fx * img.naturalWidth;
      const sy = rect.fy * img.naturalHeight;
      const sw = rect.fw * img.naturalWidth;
      const sh = rect.fh * img.naturalHeight;
      if (sw < 4 || sh < 4) {
        resolve(null);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sw);
      canvas.height = Math.round(sh);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/png");
      // Remap terminal positions: only keep those inside the rect, then rescale
      const mapped = terminals
        .filter(
          (t) =>
            t.fx >= rect.fx &&
            t.fx <= rect.fx + rect.fw &&
            t.fy >= rect.fy &&
            t.fy <= rect.fy + rect.fh
        )
        .map((t) => ({
          ...t,
          fx: (t.fx - rect.fx) / rect.fw,
          fy: (t.fy - rect.fy) / rect.fh,
        }));
      resolve({ dataUrl, terminals: mapped });
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
