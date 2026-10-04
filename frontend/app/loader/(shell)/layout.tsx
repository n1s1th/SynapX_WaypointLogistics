import { FlagPhotoUploader } from "@/components/loader/flag-photo-uploader";
import { SessionGate } from "@/components/loader/loader-session";

// Signed-in loader screens: the user, dock and loader_session_id come from
// this tablet's session (L2 sign-in); the Issues badge from the dock's last
// loaded summary (L3).
export default function LoaderShellLayout({ children }: LayoutProps<"/loader">) {
  return (
    <SessionGate>
      {children}
      <FlagPhotoUploader />
    </SessionGate>
  );
}
