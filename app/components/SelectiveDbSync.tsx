"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { DbSync } from "./DbSync";

export default function SelectiveDbSync() {
  const pathname = usePathname();

  // Only mount DbSync on the editor/studio pages where project sync is needed.
  // This prevents DbSync from running on the homepage and on simple "view" pages.
  if (!pathname) return null;
  if (pathname.startsWith("/studio")) return <DbSync />;
  return null;
}
