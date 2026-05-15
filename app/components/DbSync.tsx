"use client";

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/lib/store";

const DEBOUNCE_MS = 1500;

/**
 * Mounts once at app root.
 * - On mount: loads global library (templates + categories) then loads current project.
 * - Library changes auto-save to /api/library (shared across all projects).
 * - Project changes (devices + wires) auto-save to /api/project.
 *
 * Race-condition protection:
 * - `localSavedAt` (persisted in localStorage) tracks when canvas was last mutated locally.
 * - On mount, DB data is only applied if its `updatedAt` is newer than `localSavedAt`.
 * - A `beforeunload` handler flushes the debounce immediately so DB is up-to-date on refresh.
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
        const patch: Record<string, unknown> = {};
        if (lib.templates?.length) patch.templates = lib.templates;
        if (lib.categories?.length) patch.categories = lib.categories;
        if (Object.keys(patch).length) useEditorStore.setState(patch);
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

        // ── Timestamp guard ──────────────────────────────────────────────
        // localSavedAt is persisted in localStorage and updated every time
        // canvas data changes locally. If localSavedAt is newer than the DB's
        // updatedAt, the DB has stale data — skip the overwrite and push the
        // localStorage version to DB instead.
        const localSavedAt = useEditorStore.getState().localSavedAt ?? 0;
        const dbUpdatedAt = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;

        if (localSavedAt > dbUpdatedAt + 2000) {
          // localStorage is newer — skip DB overwrite, persist local data to DB
          console.info("DbSync: localStorage is newer than DB, skipping overwrite and pushing local data to DB.");
          const s = useEditorStore.getState();
          fetch("/api/project", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: s.currentProjectId,
              name: s.currentProjectName,
              devices: s.devices,
              wires: s.wires,
              labels: s.labels,
              wireColor: s.wireColor,
              wireThickness: s.wireThickness,
              wireJumps: s.wireJumps,
              wireLayers: s.wireLayers,
              activeWireLayerId: s.activeWireLayerId,
            }),
          }).catch((e) => console.warn("DbSync push-local error:", e));
          return;
        }

        const patch: Record<string, unknown> = {
          devices: data.devices ?? [],
          wires: data.wires ?? [],
          labels: data.labels ?? [],
          past: [],
          future: [],
        };
        if (Array.isArray(data.wireLayers) && data.wireLayers.length > 0)
          patch.wireLayers = data.wireLayers;
        if (typeof data.activeWireLayerId === "string" || data.activeWireLayerId === null)
          patch.activeWireLayerId = data.activeWireLayerId;
        if (data.wireColor) patch.wireColor = data.wireColor;
        if (typeof data.wireThickness === "number") patch.wireThickness = data.wireThickness;
        if (typeof data.wireJumps === "boolean") patch.wireJumps = data.wireJumps;
        useEditorStore.setState(patch);
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
        l: s.labels,
        wc: s.wireColor,
        wt: s.wireThickness,
        wj: s.wireJumps,
        wl: s.wireLayers,
        wla: s.activeWireLayerId,
        pid: s.currentProjectId,
        pn: s.currentProjectName,
      });

    const doSave = () => {
      const { devices, wires, labels, wireColor, wireThickness, wireJumps,
        wireLayers, activeWireLayerId,
        currentProjectId, currentProjectName } = useEditorStore.getState();
      fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProjectId,
          name: currentProjectName,
          devices,
          wires,
          labels,
          wireColor,
          wireThickness,
          wireJumps,
          wireLayers,
          activeWireLayerId,
        }),
      })
        .then((r) => useEditorStore.getState().setDbStatus(r.ok ? "saved" : "error"))
        .catch(() => useEditorStore.getState().setDbStatus("error"));
    };

    const unsub = useEditorStore.subscribe((state) => {
      if (isLoading.current) return;
      const fp = getFp(state);
      if (fp === prevFp) return;
      prevFp = fp;

      // Update localSavedAt immediately so localStorage is timestamped
      useEditorStore.getState().setLocalSavedAt(Date.now());

      if (projectTimer.current) clearTimeout(projectTimer.current);
      useEditorStore.getState().setDbStatus("saving");

      projectTimer.current = setTimeout(doSave, DEBOUNCE_MS);
    });

    // ── Flush save immediately before page unloads ─────────────────────
    // This prevents data loss when the user refreshes before the debounce fires.
    const handleBeforeUnload = () => {
      if (projectTimer.current) {
        clearTimeout(projectTimer.current);
        projectTimer.current = null;
      }
      const { devices, wires, labels, wireColor, wireThickness, wireJumps,
        wireLayers, activeWireLayerId,
        currentProjectId, currentProjectName } = useEditorStore.getState();
      const payload = JSON.stringify({
        projectId: currentProjectId,
        name: currentProjectName,
        devices,
        wires,
        labels,
        wireColor,
        wireThickness,
        wireJumps,
        wireLayers,
        activeWireLayerId,
      });
      // sendBeacon is guaranteed to complete even after page unload
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon("/api/project", blob);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      unsub();
      if (projectTimer.current) clearTimeout(projectTimer.current);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return null;
}
