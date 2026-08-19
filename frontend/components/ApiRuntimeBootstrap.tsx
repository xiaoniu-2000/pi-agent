"use client";

import { installApiBridge } from "@/lib/runtime-api";

installApiBridge();

export function ApiRuntimeBootstrap({ children }: { children: React.ReactNode }) {
  return children;
}
