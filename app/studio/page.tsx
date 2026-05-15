"use client";

import dynamic from "next/dynamic";
import Sidebar from "../components/Sidebar";
import WireLayerPanel from "../components/WireLayerPanel";

const DeviceCanvas = dynamic(() => import("../components/DeviceCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">
      Loading canvas…
    </div>
  ),
});

export default function StudioPage() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Sidebar />
      <main className="relative flex-1">
        <DeviceCanvas />
      </main>
      <WireLayerPanel />
    </div>
  );
}
