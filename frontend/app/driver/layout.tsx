import type { Metadata, Viewport } from "next";
import { DriverProvider } from "@/components/driver/driver-provider";
import { DriverSwRegister } from "@/components/driver/driver-sw-register";

export const metadata: Metadata = {
  title: "Driver · Waypoint Logistics",
  description: "Collect your run, deliver stop by stop, record proof of delivery, and keep working without signal.",
  manifest: "/driver.webmanifest",
  appleWebApp: { capable: true, title: "Driver", statusBarStyle: "default" },
  icons: { apple: "/icons/icon-192.svg" },
};

// Matches the brand-strong token (#092C4C) behind the driver screens.
export const viewport: Viewport = {
  themeColor: "#092c4c",
};

export default function DriverLayout({ children }: LayoutProps<"/driver">) {
  return (
    <>
      <DriverSwRegister />
      <DriverProvider>{children}</DriverProvider>
    </>
  );
}
