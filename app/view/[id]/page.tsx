import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { connectDB } from "@/lib/mongodb";
import { ProjectModel } from "@/lib/models/Project";
import { LibraryModel } from "@/lib/models/Library";
import ProjectViewer from "./ProjectViewer";
import type {
  ViewerDevice,
  ViewerLabel,
  ViewerTemplate,
  ViewerWire,
  ViewerWireLayer,
} from "./ProjectViewer";

export const dynamic = "force-dynamic";

function toFiniteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeTemplates(input: unknown): ViewerTemplate[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const t = item as Record<string, unknown>;
      if (typeof t.id !== "string") return null;
      const terminals = Array.isArray(t.terminals)
        ? t.terminals
            .map((raw) => {
              if (!raw || typeof raw !== "object") return null;
              const r = raw as Record<string, unknown>;
              if (typeof r.id !== "string") return null;
              return {
                id: r.id,
                fx: toFiniteNumber(r.fx, 0.5),
                fy: toFiniteNumber(r.fy, 0.5),
                label: typeof r.label === "string" ? r.label : "",
              };
            })
            .filter((t): t is ViewerTemplate["terminals"][number] => t !== null)
        : [];
      return {
        id: t.id,
        name: typeof t.name === "string" ? t.name : "Untitled",
        src: typeof t.src === "string" ? t.src : "",
        category: typeof t.category === "string" ? t.category : undefined,
        terminals,
      } satisfies ViewerTemplate;
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
}

function normalizeDevices(input: unknown): ViewerDevice[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const d = item as Record<string, unknown>;
      if (typeof d.id !== "string" || typeof d.src !== "string") return null;
      return {
        id: d.id,
        templateId: typeof d.templateId === "string" ? d.templateId : "",
        src: d.src,
        x: toFiniteNumber(d.x, 0),
        y: toFiniteNumber(d.y, 0),
        width: Math.max(1, toFiniteNumber(d.width, 120)),
        height: Math.max(1, toFiniteNumber(d.height, 80)),
        rotation: toFiniteNumber(d.rotation, 0),
        flipX: Boolean(d.flipX),
        flipY: Boolean(d.flipY),
      } satisfies ViewerDevice;
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
}

function normalizeWires(input: unknown): ViewerWire[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const w = item as Record<string, unknown>;
      if (typeof w.id !== "string" || !Array.isArray(w.points)) return null;
      const points = w.points
        .map((n) => toFiniteNumber(n, Number.NaN))
        .filter((n) => Number.isFinite(n));
      const evenPoints = points.length % 2 === 0 ? points : points.slice(0, -1);
      if (evenPoints.length < 4) return null;
      const normBind = (raw: unknown) => {
        if (!raw || typeof raw !== "object") return undefined;
        const b = raw as Record<string, unknown>;
        if (typeof b.deviceId !== "string" || typeof b.terminalId !== "string") return undefined;
        return { deviceId: b.deviceId, terminalId: b.terminalId };
      };
      const normWireBind = (raw: unknown) => {
        if (!raw || typeof raw !== "object") return undefined;
        const b = raw as Record<string, unknown>;
        if (typeof b.wireId !== "string") return undefined;
        const t = toFiniteNumber(b.t, Number.NaN);
        if (!Number.isFinite(t)) return undefined;
        return { wireId: b.wireId, t: Math.max(0, Math.min(1, t)) };
      };
      return {
        id: w.id,
        points: evenPoints,
        color: typeof w.color === "string" ? w.color : "#dc2626",
        thickness: Math.max(0.1, toFiniteNumber(w.thickness, 1.5)),
        label: typeof w.label === "string" ? w.label : undefined,
        layerId: typeof w.layerId === "string" ? w.layerId : undefined,
        startBind: normBind(w.startBind),
        endBind: normBind(w.endBind),
        startWireBind: normWireBind(w.startWireBind),
        endWireBind: normWireBind(w.endWireBind),
      } satisfies ViewerWire;
    })
    .filter((w): w is NonNullable<typeof w> => w !== null);
}

function normalizeLabels(input: unknown): ViewerLabel[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const l = item as Record<string, unknown>;
      if (typeof l.id !== "string" || typeof l.text !== "string") return null;
      return {
        id: l.id,
        text: l.text,
        x: toFiniteNumber(l.x, 0),
        y: toFiniteNumber(l.y, 0),
        fontSize: Math.max(6, toFiniteNumber(l.fontSize, 18)),
        color: typeof l.color === "string" ? l.color : "#111827",
        rotation: toFiniteNumber(l.rotation, 0),
      } satisfies ViewerLabel;
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
}

function normalizeWireLayers(input: unknown): ViewerWireLayer[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const l = item as Record<string, unknown>;
      if (typeof l.id !== "string") return null;
      return {
        id: l.id,
        name: typeof l.name === "string" ? l.name : "Layer",
        thickness:
          typeof l.thickness === "number" && Number.isFinite(l.thickness)
            ? l.thickness
            : undefined,
      } satisfies ViewerWireLayer;
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
}

export default async function ViewProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let doc:
    | (Record<string, unknown> & { name?: string; updatedAt?: Date })
    | null = null;
  let libraryDoc: Record<string, unknown> | null = null;
  try {
    await connectDB();
    [doc, libraryDoc] = await Promise.all([
      ProjectModel.findOne({ projectId: id }).lean() as Promise<
        (Record<string, unknown> & { name?: string; updatedAt?: Date }) | null
      >,
      LibraryModel.findOne({ libraryId: "global" }).lean() as Promise<Record<string, unknown> | null>,
    ]);
  } catch (err) {
    console.error("view project error:", err);
  }

  if (!doc) notFound();

  // Prefer library templates (authoritative source with terminal labels).
  // Fall back to project-embedded templates if library is unavailable.
  const rawTemplates =
    libraryDoc && Array.isArray(libraryDoc.templates) && libraryDoc.templates.length
      ? libraryDoc.templates
      : doc.templates;

  const templates = normalizeTemplates(rawTemplates);
  const devices = normalizeDevices(doc.devices);
  const wires = normalizeWires(doc.wires);
  const labels = normalizeLabels(doc.labels);
  const wireLayers = normalizeWireLayers(doc.wireLayers);
  const name = typeof doc.name === "string" ? doc.name : "Untitled";
  const updatedAt = doc.updatedAt
    ? new Date(doc.updatedAt as Date).toISOString()
    : null;

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-950 text-zinc-100">
      <header className="z-10 flex items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/90 px-3 py-2 backdrop-blur sm:px-4">
        <Link
          href="/"
          aria-label="กลับ"
          className="rounded-md p-2 text-zinc-300 hover:bg-zinc-800"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate text-sm font-semibold sm:text-base">{name}</h1>
          {updatedAt ? (
            <p className="truncate text-[10px] text-zinc-500 sm:text-xs">
              อัปเดต {new Date(updatedAt).toLocaleString("th-TH")}
            </p>
          ) : null}
        </div>
      </header>
      <div className="relative flex-1 overflow-hidden">
        <ProjectViewer
          templates={templates}
          devices={devices}
          wires={wires}
          labels={labels}
          wireLayers={wireLayers}
        />
      </div>
    </div>
  );
}
