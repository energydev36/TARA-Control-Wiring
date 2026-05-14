"use client";

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/lib/store";

const DEBOUNCE_MS = 1500;

/**
 * Mounts once at app root.
 * - On mount: loads global library (templates + categories) then loads current project.
 * - Library changes auto-save to /api/library (shared across all projects).
 * - Project changes (devices + wires) auto-save to /api/project.
 */
export function DbSync() {
  const initialized = useRef(false);
  const libTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while hydrating from DB — suppress auto-save during load */
  const isLoading = useRef(true);

  // ── Load on mount ────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const store = useEditorStore.getState();

    // 1. Load global library first
    fetch("/api/library")
      .then((r) => r.json())
      .then((lib) => {
        if (!lib) return;
        if (lib.templates?.length) store.setField("templates", lib.templates);
        if (lib.categories?.length) store.setField("categories", lib.categories);
      })
      .catch((e) => console.warn("DbSync library load error:", e));

    // 2. Load current project (devices + wires only)
    // Strategy: fetch the full list first, then load by stored ID if it exists,
    // otherwise fall back to the most recently updated project.
    // This handles fresh browsers where localStorage has "default" but real data
    // lives under a UUID created on another machine.
    const loadProject = async (storedId: string) => {
      // Fetch list of all projects (metadata only — fast)
      const listRes = await fetch("/api/project");
      const list: { projectId: string; name: string; updatedAt: string }[] =
        await listRes.json().catch(() => []);

      if (!Array.isArray(list) || list.length === 0) return null;

      // Prefer the stored ID if it actually exists in the DB
      const match = list.find((p) => p.projectId === storedId);
      const target = match ?? list[0]; // fall back to most recently updated

      const res = await fetch(`/api/project?id=${target.projectId}`);
      const data = await res.json();

      // If we ended up loading a different project, update the store
      if (!match && data) {
        store.setCurrentProject(target.projectId, target.name);
      }
      return data;
    };

    loadProject(store.currentProjectId)
      .then((data) => {
        if (!data) return;
        store.setField("devices", data.devices ?? []);
        store.setField("wires", data.wires ?? []);
        if (data.wireColor) store.setWireColor(data.wireColor);
        if (typeof data.wireThickness === "number") store.setWireThickness(data.wireThickness);
        if (typeof data.wireJumps === "boolean") store.setWireJumps(data.wireJumps);
      })
      .catch((e) => console.warn("DbSync project load error:", e))
      .finally(() => { isLoading.current = false; });
  }, []);

  // ── Auto-save library (templates + categories) ───────────────────────────
  useEffect(() => {
    let prevFp = "";

    const getFp = (s: ReturnType<typeof useEditorStore.getState>) =>
      JSON.stringify({ t: s.templates, c: s.categories });

    const unsub = useEditorStore.subscribe((state) => {
      if (isLoading.current) return;
      const fp = getFp(state);
      if (fp === prevFp) return;
      prevFp = fp;

      if (libTimer.current) clearTimeout(libTimer.current);
      useEditorStore.getState().setDbStatus("saving");

      libTimer.current = setTimeout(() => {
        const { templates, categories } = useEditorStore.getState();
        fetch("/api/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templates, categories }),
        })
          .then((r) => {
            if (!r.ok) useEditorStore.getState().setDbStatus("error");
            // project timer will set final status
          })
          .catch(() => useEditorStore.getState().setDbStatus("error"));
      }, DEBOUNCE_MS);
    });

    return () => {
      unsub();
      if (libTimer.current) clearTimeout(libTimer.current);
    };
  }, []);

  // ── Auto-save project (devices + wires + settings) ───────────────────────
  useEffect(() => {
    let prevFp = "";

    const getFp = (s: ReturnType<typeof useEditorStore.getState>) =>
      JSON.stringify({
        d: s.devices,
        w: s.wires,
        wc: s.wireColor,
        wt: s.wireThickness,
        wj: s.wireJumps,
        pid: s.currentProjectId,
      });

    const unsub = useEditorStore.subscribe((state) => {
      if (isLoading.current) return;
      const fp = getFp(state);
      if (fp === prevFp) return;
      prevFp = fp;

      if (projectTimer.current) clearTimeout(projectTimer.current);
      useEditorStore.getState().setDbStatus("saving");

      projectTimer.current = setTimeout(() => {
        const { devices, wires, wireColor, wireThickness, wireJumps,
          currentProjectId, currentProjectName } = useEditorStore.getState();
        fetch("/api/project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: currentProjectId,
            name: currentProjectName,
            devices,
            wires,
            wireColor,
            wireThickness,
            wireJumps,
          }),
        })
          .then((r) => useEditorStore.getState().setDbStatus(r.ok ? "saved" : "error"))
          .catch(() => useEditorStore.getState().setDbStatus("error"));
      }, DEBOUNCE_MS);
    });

    return () => {
      unsub();
      if (projectTimer.current) clearTimeout(projectTimer.current);
    };
  }, []);

  return null;
}
