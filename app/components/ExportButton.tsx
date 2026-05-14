"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/store";
import Konva from "konva";
import { X, Download, FileJson, ImageDown } from "lucide-react";

type StageRef = { __taraStage?: Konva.Stage | null };

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function computeBBox(
  ids: string[],
  stage: Konva.Stage
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const node = stage.findOne<Konva.Node>(`#${CSS.escape(id)}`);
    if (!node) continue;
    const box = node.getClientRect({ skipTransform: false });
    if (box.width === 0 && box.height === 0) continue;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

interface ExportOptions {
  pixelRatio: number;
  background: "white" | "transparent";
}

type ExportFrame = { x: number; y: number; width: number; height: number };

function exportByFrame(frame: ExportFrame, stage: Konva.Stage, opts: ExportOptions): string | null {
  const { pixelRatio, background } = opts;
  const oldW = stage.width(), oldH = stage.height();
  const oldX = stage.x(), oldY = stage.y();
  const oldScaleX = stage.scaleX(), oldScaleY = stage.scaleY();
  const gridLayer = stage.findOne<Konva.Layer>("#grid-layer");
  const exportFrameLayer = stage.findOne<Konva.Layer>("#export-frame-layer");
  const oldGridVisible = gridLayer ? gridLayer.visible() : undefined;
  const oldExportFrameVisible = exportFrameLayer ? exportFrameLayer.visible() : undefined;
  let bgLayer: Konva.Layer | null = null;

  try {
    // Reset transform so getClientRect returns true world coords
    stage.position({ x: 0, y: 0 });
    stage.scale({ x: 1, y: 1 });
    stage.batchDraw();

    const exportW = Math.max(1, Math.ceil(frame.width));
    const exportH = Math.max(1, Math.ceil(frame.height));
    // Top-left corner of the crop in WORLD coords
    const cropX = frame.x;
    const cropY = frame.y;

    if (gridLayer) gridLayer.visible(false);
    if (exportFrameLayer) exportFrameLayer.visible(false);

    // Resize stage to cover the crop region so toDataURL has the full pixels.
    // Shift stage so (cropX,cropY) → screen (0,0); world content beyond viewport
    // is now drawn into the resized canvas.
    stage.size({ width: exportW, height: exportH });
    stage.position({ x: -cropX, y: -cropY });

    if (background === "white") {
      bgLayer = new Konva.Layer({ listening: false, id: "export-bg-layer" });
      // White rect in WORLD coords matching the crop region exactly
      bgLayer.add(
        new Konva.Rect({
          x: cropX,
          y: cropY,
          width: exportW,
          height: exportH,
          fill: "#ffffff",
          listening: false,
        })
      );
      stage.add(bgLayer);
      bgLayer.moveToBottom();
    }

    stage.batchDraw();

    return stage.toDataURL({
      x: 0,
      y: 0,
      width: exportW,
      height: exportH,
      pixelRatio,
      mimeType: "image/png",
    });
  } finally {
    if (bgLayer) bgLayer.destroy();
    if (gridLayer && oldGridVisible !== undefined) gridLayer.visible(oldGridVisible);
    if (exportFrameLayer && oldExportFrameVisible !== undefined) exportFrameLayer.visible(oldExportFrameVisible);
    stage.size({ width: oldW, height: oldH });
    stage.position({ x: oldX, y: oldY });
    stage.scale({ x: oldScaleX, y: oldScaleY });
    stage.batchDraw();
  }
}

// ── Export Settings Modal ──────────────────────────────────────────────────
const PIXEL_RATIOS = [
  { label: "1× (72 dpi)", value: 1 },
  { label: "2× (144 dpi)", value: 2 },
  { label: "3× (216 dpi)", value: 3 },
  { label: "4× (288 dpi)", value: 4 },
];

function ExportModal({ onClose, onExport }: {
  onClose: () => void;
  onExport: (opts: ExportOptions) => void;
}) {
  const [pixelRatio, setPixelRatio] = useState(2);
  const [background, setBackground] = useState<"white" | "transparent">("white");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-none"
    >
      <div className="pointer-events-auto w-80 rounded-lg bg-white shadow-2xl dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <ImageDown size={16} className="text-blue-600" />
            <h2 className="text-sm font-semibold">
              Export All
            </h2>
          </div>
          <button onClick={onClose} className="flex items-center justify-center rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X size={15} />
          </button>
        </div>

        {/* Options */}
        <div className="space-y-4 p-4">
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            พื้นที่ส่งออกกำหนดจากกรอบ Export Frame บนแคนวาส
          </p>

          {/* Resolution */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              ความละเอียด (Pixel Ratio)
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {PIXEL_RATIOS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setPixelRatio(r.value)}
                  className={`rounded border px-2 py-1.5 text-xs transition-colors ${
                    pixelRatio === r.value
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Background */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              พื้นหลัง
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => setBackground("white")}
                className={`flex items-center justify-center gap-1.5 rounded border px-2 py-2 text-xs transition-colors ${
                  background === "white"
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                    : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                }`}
              >
                <span className="inline-block h-3 w-3 rounded border border-zinc-300 bg-white" />
                สีขาว
              </button>
              <button
                onClick={() => setBackground("transparent")}
                className={`flex items-center justify-center gap-1.5 rounded border px-2 py-2 text-xs transition-colors ${
                  background === "transparent"
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                    : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                }`}
              >
                <span
                  className="inline-block h-3 w-3 rounded border border-zinc-300"
                  style={{
                    backgroundImage: "linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%)",
                    backgroundSize: "6px 6px",
                    backgroundPosition: "0 0,0 3px,3px -3px,-3px 0",
                  }}
                />
                โปร่งใส
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="flex-1 rounded border border-zinc-200 px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => onExport({ pixelRatio, background })}
            className="flex flex-1 items-center justify-center gap-1.5 rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Download size={13} />
            Export PNG
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Export Button ─────────────────────────────────────────────────────
export default function ExportButton() {
  const devices = useEditorStore((s) => s.devices);
  const wires = useEditorStore((s) => s.wires);
  const setExportPreview = useEditorStore((s) => s.setExportPreview);
  const exportFrame = useEditorStore((s) => s.exportFrame);
  const setExportFrame = useEditorStore((s) => s.setExportFrame);
  const [modalOpen, setModalOpen] = useState(false);

  const getAllIds = () => [...devices.map((d) => d.id), ...wires.map((w) => w.id)];

  const openModal = () => {
    const stage = (window as unknown as StageRef).__taraStage;
    const ids = getAllIds();
    setModalOpen(true);
    setExportPreview({ ids, padding: 0 });
    if (stage && !exportFrame) {
      const box = computeBBox(ids, stage);
      if (box) {
        setExportFrame({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        });
      }
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setExportPreview(null);
  };

  const handleExport = (opts: ExportOptions) => {
    const stage = (window as unknown as StageRef).__taraStage;
    if (!stage) return;

    const ids = getAllIds();

    if (ids.length === 0) { alert("ไม่มี Object ให้ Export"); return; }

    let frame = exportFrame;
    if (!frame) {
      const box = computeBBox(ids, stage);
      if (box) {
        frame = {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        };
      }
    }

    if (!frame) { alert("ไม่สามารถคำนวณ Bounding Box ได้"); return; }
    const dataUrl = exportByFrame(frame, stage, opts);
    if (!dataUrl) { alert("ไม่สามารถคำนวณ Bounding Box ได้"); return; }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadDataUrl(dataUrl, `wiring-all-${stamp}.png`);
    closeModal();
  };

  const exportProject = () => {
    const state = useEditorStore.getState();
    const data = { version: 1, templates: state.templates, devices: state.devices, wires: state.wires };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, `tara-project-${Date.now()}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-1.5">
        <button
          onClick={openModal}
          className="rounded-md bg-blue-600 px-2 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          title="Export ทั้งหมด"
        >
          Export All
        </button>
        <button
          onClick={exportProject}
          className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-300 px-2 py-2 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          <FileJson size={13} />
          Save Project (.json)
        </button>
      </div>

      {modalOpen && (
        <ExportModal
          onClose={closeModal}
          onExport={handleExport}
        />
      )}
    </>
  );
}
