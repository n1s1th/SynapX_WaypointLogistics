import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { OfflineSyncBanner } from "@/components/OfflineSyncBanner";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Waypoint Logistics | Intelligent Supply Chain & Fleet Management",
  description: "Enterprise logistics management platform for real-time dispatch, inventory tracking, and warehouse operations across Waypoint Group.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Waypoint Logistics",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

import { AuthProvider } from "@/lib/auth-context";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full font-sans antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-background text-foreground" suppressHydrationWarning>
        <AuthProvider>
          <OfflineSyncBanner />
          <main className="flex-1 flex flex-col">{children}</main>
          <Toaster position="top-right" richColors />
        </AuthProvider>
      </body>
    </html>
  );
}
