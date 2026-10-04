import { SyncProvider } from "@/components/SyncProvider";
import { DriverSwRegister } from "@/components/driver/DriverSwRegister";
import { DriverAuthGuard } from "@/components/driver/DriverAuthGuard";

/**
 * Driver layout wraps every page under /driver with the SyncProvider,
 * making the offline queue state available everywhere via useSyncContext(),
 * registers the service worker that keeps the screens opening offline, and
 * keeps logged-out visitors on the login screen.
 */
export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DriverSwRegister />
      <SyncProvider>
        <DriverAuthGuard>{children}</DriverAuthGuard>
      </SyncProvider>
    </>
  );
}
