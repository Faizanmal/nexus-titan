"use client";
import { useEffect } from "react";
import { registerOfflineWorker } from "@nexus-titan/hybrid-web";

export function OfflineWorker() {
  useEffect(() => { void registerOfflineWorker().catch(() => undefined); }, []);
  return null;
}
