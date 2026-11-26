import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import "./globals.css";
import { OfflineWorker } from "@/components/offline-worker";
import { CommandCenterShell } from "@/components/command-center-shell";

export const metadata: Metadata = {
  title: "NEXUS TITAN",
  description: "Tenant-scoped synthetic industrial operations command center.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <OfflineWorker />
        <Suspense fallback={null}>
          <CommandCenterShell>{children}</CommandCenterShell>
        </Suspense>
      </body>
    </html>
  );
}
