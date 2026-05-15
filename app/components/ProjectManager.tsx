"use client";

import { useState, useEffect, useCallback } from "react";
import { X, FolderOpen, Plus, Trash2, Loader2, Check } from "lucide-react";
import { useEditorStore, uid } from "@/lib/store";

interface ProjectMeta {
  projectId: string;
  name: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ProjectManager({ open, onClose }: Props) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const currentProjectId = useEditorStore((s) => s.currentProjectId);
  const currentProjectName = useEditorStore((s) => s.currentProjectName);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/project");
      const data = await res.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchList();
  }, [open, fetchList]);

  const handleNew = async () => {
    const name = newName.trim() || "Untitled";
    const projectId = uid();
    const store = useEditorStore.getState();
    store.clearCanvas();
    store.setCurrentProject(projectId, name);
    // Immediately persist the new empty project
    await fetch("/api/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        name,
        devices: [],
        wires: [],
        labels: [],
        wireColor: "#dc2626",
        wireThickness: 2,
        wireJumps: false,
      }),
    });
    setNewName("");
    setCreating(false);
    onClose();
  };

  const handleOpen = async (projectId: string, name: string) => {
    if (projectId === currentProjectId) { onClose(); return; }
    setOpening(projectId);
    try {
      const res = await fetch(`/api/project?id=${projectId}`);
      const data = await res.json();
      const store = useEditorStore.getState();
      store.clearCanvas();
      store.setCurrentProject(projectId, name);
      // templates & categories are global — do NOT overwrite them
      if (data?.devices?.length) store.setField("devices", data.devices);
      if (data?.wires?.length) store.setField("wires", data.wires);
      if (Array.isArray(data?.labels)) store.setField("labels", data.labels);
      if (data?.wireColor) store.setWireColor(data.wireColor);
      if (typeof data?.wireThickness === "number") store.setWireThickness(data.wireThickness);
      if (typeof data?.wireJumps === "boolean") store.setWireJumps(data.wireJumps);
      onClose();
    } finally {
      setOpening(null);
    }
  };

  const handleDelete = async (projectId: string, name: string) => {
    if (!confirm(`ลบโปรเจค "${name}"?`)) return;
    setDeleting(projectId);
    try {
      await fetch(`/api/project?id=${projectId}`, { method: "DELETE" });
      setProjects((prev) => prev.filter((p) => p.projectId !== projectId));
    } finally {
      setDeleting(null);
    }
  };

  const handleRename = async (projectId: string, newProjectName: string) => {
    const trimmedName = newProjectName.trim();
    if (!trimmedName) return;

    const res = await fetch("/api/project", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name: trimmedName }),
    });
    if (!res.ok) return;

    // If it's the current project, update store too
    if (projectId === currentProjectId) {
      useEditorStore.getState().setCurrentProject(projectId, trimmedName);
    }
    setProjects((prev) =>
      prev.map((p) => (p.projectId === projectId ? { ...p, name: trimmedName } : p))
    );
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
          <h2 className="text-base font-semibold">จัดการโปรเจค</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {/* Current project info */}
          <div className="mb-3 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800">
            เปิดอยู่: <span className="font-medium text-zinc-800 dark:text-zinc-200">{currentProjectName}</span>
          </div>

          {/* New project */}
          {creating ? (
            <div className="mb-3 flex gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNew();
                  if (e.key === "Escape") { setCreating(false); setNewName(""); }
                }}
                placeholder="ชื่อโปรเจคใหม่"
                className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
              />
              <button
                onClick={handleNew}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                สร้าง
              </button>
              <button
                onClick={() => { setCreating(false); setNewName(""); }}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                ยกเลิก
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="mb-3 flex w-full items-center gap-2 rounded-lg border-2 border-dashed border-zinc-200 px-3 py-2.5 text-sm text-zinc-500 transition-colors hover:border-blue-400 hover:text-blue-600 dark:border-zinc-700 dark:hover:border-blue-500"
            >
              <Plus size={14} />
              โปรเจคใหม่
            </button>
          )}

          {/* Project list */}
          {loading ? (
            <div className="flex items-center justify-center py-10 text-zinc-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : projects.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">ไม่มีโปรเจคที่บันทึกไว้</p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {projects.map((p) => (
                <ProjectRow
                  key={p.projectId}
                  project={p}
                  isCurrent={p.projectId === currentProjectId}
                  opening={opening === p.projectId}
                  deleting={deleting === p.projectId}
                  onOpen={() => handleOpen(p.projectId, p.name)}
                  onDelete={() => handleDelete(p.projectId, p.name)}
                  onRename={(name) => handleRename(p.projectId, name)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectRow({
  project,
  isCurrent,
  opening,
  deleting,
  onOpen,
  onDelete,
  onRename,
}: {
  project: ProjectMeta;
  isCurrent: boolean;
  opening: boolean;
  deleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== project.name) onRename(draft.trim());
    else setDraft(project.name);
  };

  return (
    <div
      className={`group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
        isCurrent
          ? "bg-blue-50 ring-1 ring-blue-300 dark:bg-blue-950 dark:ring-blue-700"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
      }`}
    >
      <FolderOpen size={14} className={`shrink-0 ${isCurrent ? "text-blue-500" : "text-zinc-400"}`} />

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(project.name); } }}
            className="w-full rounded border border-blue-400 px-1 text-sm focus:outline-none dark:bg-zinc-800"
          />
        ) : (
          <p
            className="truncate text-sm font-medium cursor-text"
            onDoubleClick={() => setEditing(true)}
            title="ดับเบิลคลิกเพื่อแก้ชื่อ"
          >
            {project.name}
          </p>
        )}
        <p className="text-[11px] text-zinc-400">
          {new Date(project.updatedAt).toLocaleString("th-TH")}
        </p>
      </div>

      {isCurrent ? (
        <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
          <Check size={10} className="inline" /> เปิดอยู่
        </span>
      ) : (
        <button
          onClick={onOpen}
          disabled={opening}
          className="shrink-0 rounded-md border border-zinc-200 px-2.5 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {opening ? <Loader2 size={11} className="animate-spin" /> : "เปิด"}
        </button>
      )}

      <button
        onClick={onDelete}
        disabled={deleting}
        className="shrink-0 rounded-md p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 disabled:opacity-40 group-hover:opacity-100 dark:hover:bg-red-950"
      >
        {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
      </button>
    </div>
  );
}
