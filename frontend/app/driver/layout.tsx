import { SyncProvider } from "@/components/SyncProvider";
import DriverSyncBar from "@/components/driver/DriverSyncBar";
import { DriverSwRegister } from "@/components/driver/DriverSwRegister";

/**
 * Driver layout wraps every page under /driver with the SyncProvider,
 * making the offline queue state available everywhere via useSyncContext(),
 * shows the connection/sync bar, and registers the offline app shell.
 */
export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <SyncProvider>
      <DriverSwRegister />
      <DriverSyncBar />
      {children}
    </SyncProvider>
  );
}
