"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Signal, BatteryFull, User, Truck, Phone, Mail, IdCard, Pencil,
  LogOut, Map, Home, TriangleAlert, ChevronRight, Lock
} from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { cachedGet, writeCache } from "@/lib/driverCache";
import { forgetScreens } from "@/lib/driverSession";
import { useAuth } from "@/lib/auth-context";
import { useSyncContext } from "@/components/SyncProvider";
import DeviceClock from "@/components/driver/DeviceClock";

interface UserProfile {
  id: number;
  full_name: string;
  email: string;
  role: string;
}

interface DriverDetails {
  phone: string | null;
  license_type: string | null;
  complete: boolean; // false: dispatch can't assign this driver yet
  vehicle: { code: string; vehicle_type: string; temperature_mode: string; depot_name: string } | null;
  todays_vehicle: string | null;
}

const LICENCES = [
  { value: "Light", label: "Light", hint: "Vans" },
  { value: "Heavy", label: "Heavy", hint: "Trucks" },
];

// Same rule as the server: 10 digits starting with 0, or +94 instead of the 0.
function normalisePhone(value: string): string | null {
  let number = value.replace(/[\s\-()]/g, "");
  if (number.startsWith("+94")) number = "0" + number.slice(3);
  return /^0\d{9}$/.test(number) ? number : null;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [details, setDetails] = useState<DriverDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState("");
  const [licence, setLicence] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const { queue, online, flush } = useSyncContext();
  const { logout } = useAuth();

  useEffect(() => {
    async function loadProfile() {
      try {
        const [user, driver] = await Promise.all([
          cachedGet<UserProfile>("/driver/me"),
          cachedGet<DriverDetails>("/driver/profile"),
        ]);
        setProfile(user);
        setDetails(driver);
        // A new account has nothing saved yet: open the form straight away.
        if (!driver.complete) {
          setPhone(driver.phone ?? "");
          setLicence(driver.license_type ?? "");
          setEditing(true);
        }
      } catch (error) {
        console.error("Failed to load profile:", error);
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, []);

  function startEditing() {
    setPhone(details?.phone ?? "");
    setLicence(details?.license_type ?? "");
    setError(null);
    setEditing(true);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    // A saved phone number stays as it is; only the licence can change.
    const number = details?.phone ?? normalisePhone(phone);
    if (!number) {
      setError("Enter a Sri Lankan phone number, like 0771234567.");
      return;
    }
    if (!licence) {
      setError("Choose your licence type.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await apiFetch<DriverDetails>("/driver/profile", {
        method: "PUT",
        body: JSON.stringify({ phone: number, license_type: licence }),
      });
      setDetails(saved);
      writeCache("/driver/profile", saved);
      setEditing(false);
      if (!details?.complete) router.push("/driver"); // first login done: on to today's trips
    } catch (err) {
      setError(
        err instanceof ApiError && !err.isNetworkError
          ? err.message
          : "Saving needs signal. Try again when you're online."
      );
    } finally {
      setSaving(false);
    }
  }

  function handleLogout() {
    // Records still on the phone: say what happens to them before logging out.
    if (queue.length > 0 && !confirmLogout) {
      setConfirmLogout(true);
      return;
    }
    forgetScreens();
    void logout(true); // ends the shared (Keycloak) sign-in too, so the next driver must sign in
  }

  const setupNeeded = details !== null && !details.complete; // first login: phone and licence still missing
  const truck = details?.todays_vehicle ?? details?.vehicle?.code ?? null;
  const truckLine = details?.todays_vehicle
    ? "On today's trip"
    : details?.vehicle
      ? `${titleCase(details.vehicle.vehicle_type)} · ${details.vehicle.temperature_mode === "reefer" ? "Refrigerated" : "Ambient"} · ${titleCase(details.vehicle.depot_name)} depot`
      : "Dispatch assigns a truck for each trip";

  return (
    <div className="min-h-screen flex flex-col font-sans relative" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>

      {/* Header */}
      <div
        className="flex flex-col w-full bg-white z-10"
        style={{ borderBottom: "1px solid #D9E1E8" }}
      >
        {/* Device status */}
        <div className="flex justify-between items-center px-5 h-[34px] w-full">
          <DeviceClock className="text-[12px] font-semibold" style={{ color: "#12202E" }} />
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-normal" style={{ color: "#BDBDBD" }}>Online</span>
            <Signal size={16} color="#BDBDBD" />
            <BatteryFull size={18} color="#BDBDBD" />
          </div>
        </div>

        {/* Title bar */}
        <div className="flex px-5 py-2.5 items-center w-full">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>
              Driver Profile
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em]" style={{ color: "#5D6A78" }}>
              View your account and vehicle details
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 px-5 pt-[24px] pb-[100px] gap-4">

        {/* Missing details: without them dispatch can't give this driver a trip */}
        {details && !details.complete && (
          <div className="flex items-start gap-3 p-4 rounded-xl" style={{ backgroundColor: "#FFF4E5", border: "1px solid #B26A00" }}>
            <TriangleAlert size={18} color="#B26A00" className="shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-[14px]" style={{ color: "#8A5300" }}>Add your phone and licence</span>
              <span className="text-[12px]" style={{ color: "#8A5300" }}>
                You can use the app after you save them. Check your phone number: it can&apos;t be changed later.
              </span>
            </div>
          </div>
        )}

        {/* Driver Info Card */}
        <div
          className="flex flex-col p-4 gap-4 w-full rounded-2xl bg-white"
          style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
        >
          <div className="flex items-center gap-4 w-full">
            <div
              className="flex justify-center items-center w-[64px] h-[64px] rounded-full shrink-0"
              style={{ backgroundColor: "#EAF2FF" }}
            >
              <User size={32} color="#2167D5" />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="font-bold text-[18px]" style={{ color: "#12202E" }}>
                {loading ? "Loading..." : profile?.full_name || "Unknown Driver"}
              </span>
              <div className="flex items-center px-2.5 py-0.5 rounded-full w-fit" style={{ backgroundColor: "#F2F5F8" }}>
                <span className="font-semibold text-[11px]" style={{ color: "#5D6A78" }}>
                  ID: {loading ? "..." : `DRV-${profile?.id.toString().padStart(4, "0")}`}
                </span>
              </div>
            </div>
            {details && !editing && (
              <button
                type="button"
                onClick={startEditing}
                className="flex items-center gap-1.5 h-11 px-3 rounded-lg shrink-0"
                style={{ border: "1px solid #D9E1E8", color: "#163A5F" }}
              >
                <Pencil size={15} />
                <span className="font-semibold text-[13px]">Edit</span>
              </button>
            )}
          </div>

          <div className="w-full h-[1px]" style={{ backgroundColor: "#F2F5F8" }}></div>

          {editing ? (
            <form onSubmit={handleSave} className="flex flex-col gap-4">
              {details?.phone ? (
                <div className="flex flex-col gap-1.5">
                  <span className="font-semibold text-[13px]" style={{ color: "#12202E" }}>Phone number</span>
                  <div className="flex items-center gap-2 h-12 px-3 rounded-lg" style={{ backgroundColor: "#F2F5F8", border: "1px solid #D9E1E8" }}>
                    <Lock size={15} color="#8793A0" className="shrink-0" />
                    <span className="text-[15px]" style={{ color: "#12202E" }}>{details.phone}</span>
                  </div>
                  <span className="text-[12px]" style={{ color: "#5D6A78" }}>Your phone number can&apos;t be changed.</span>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="driver-phone" className="font-semibold text-[13px]" style={{ color: "#12202E" }}>
                    Phone number
                  </label>
                  <input
                    id="driver-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="0771234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-12 px-3 rounded-lg text-[15px] outline-none focus:ring-2 focus:ring-[#2167D5]"
                    style={{ border: "1px solid #C5D0DB", color: "#12202E" }}
                  />
                </div>
              )}

              <fieldset className="flex flex-col gap-1.5">
                <legend className="font-semibold text-[13px] mb-1.5" style={{ color: "#12202E" }}>Licence type</legend>
                <div className="grid grid-cols-2 gap-2">
                  {LICENCES.map((option) => {
                    const chosen = licence === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={chosen}
                        onClick={() => setLicence(option.value)}
                        className="flex flex-col items-start h-14 px-3 justify-center rounded-lg"
                        style={{
                          border: chosen ? "2px solid #2167D5" : "1px solid #C5D0DB",
                          backgroundColor: chosen ? "#EAF2FF" : "#FFFFFF",
                        }}
                      >
                        <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>{option.label}</span>
                        <span className="text-[12px]" style={{ color: "#5D6A78" }}>{option.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {error && (
                <p role="alert" className="text-[13px] font-medium" style={{ color: "#C9363E" }}>{error}</p>
              )}

              <div className="flex gap-2">
                {details?.complete && (
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="flex-1 h-12 rounded-lg font-semibold text-[15px] bg-white"
                    style={{ border: "1px solid #C5D0DB", color: "#12202E" }}
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 h-12 rounded-lg font-bold text-[15px] text-white disabled:opacity-60"
                  style={{ backgroundColor: "#163A5F" }}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Phone size={16} color="#8793A0" className="shrink-0" />
                <span className="font-medium text-[14px]" style={{ color: details?.phone ? "#12202E" : "#8793A0" }}>
                  {loading ? "Loading..." : details?.phone || "Not added yet"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <IdCard size={16} color="#8793A0" className="shrink-0" />
                <span className="font-medium text-[14px]" style={{ color: details?.license_type ? "#12202E" : "#8793A0" }}>
                  {loading ? "Loading..." : details?.license_type ? `${details.license_type} vehicle licence` : "Licence not added yet"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Mail size={16} color="#8793A0" className="shrink-0" />
                <span className="font-medium text-[14px]" style={{ color: "#12202E" }}>
                  {loading ? "Loading..." : profile?.email || "No email"}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Vehicle: set by the depot, so it's shown here but not editable */}
        <div className="flex flex-col gap-2 w-full mt-2">
          <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>Current Assignment</span>
          <div
            className="flex flex-col p-4 gap-3 w-full rounded-xl"
            style={{ backgroundColor: "#EAF2FF", border: "2px solid #2167D5" }}
          >
            <div className="flex items-center gap-3">
              <Truck size={20} color="#2167D5" className="shrink-0" />
              <span className="font-bold text-[14px]" style={{ color: "#2167D5" }}>VEHICLE</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-[20px]" style={{ color: "#12202E" }}>
                {loading ? "Loading..." : truck ?? "Not assigned yet"}
              </span>
              <span className="font-normal text-[14px]" style={{ color: "#5D6A78" }}>{truckLine}</span>
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="flex flex-col w-full mt-4 bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #D9E1E8" }}>
          <button className="flex items-center justify-between p-4 w-full active:bg-gray-50 transition-colors">
            <span className="font-medium text-[15px]" style={{ color: "#12202E" }}>Support & Help</span>
            <ChevronRight size={18} color="#8793A0" />
          </button>
          <div className="w-full h-[1px]" style={{ backgroundColor: "#F2F5F8" }}></div>
          <button className="flex items-center justify-between p-4 w-full active:bg-gray-50 transition-colors">
            <span className="font-medium text-[15px]" style={{ color: "#12202E" }}>Privacy Policy</span>
            <ChevronRight size={18} color="#8793A0" />
          </button>
        </div>

        {/* Logout Action */}
        <div className="w-full mt-6">
          {confirmLogout && queue.length > 0 && (
            <div role="alert" className="flex flex-col gap-3 p-4 mb-3 rounded-xl" style={{ backgroundColor: "#FFF4E5", border: "1px solid #B26A00" }}>
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-[14px]" style={{ color: "#8A5300" }}>
                  {queue.length} {queue.length === 1 ? "record" : "records"} not sent yet
                </span>
                <span className="text-[12px]" style={{ color: "#8A5300" }}>
                  They send when you log in again on this phone. If another driver logs in here first, they are deleted.
                </span>
              </div>
              <button
                type="button"
                onClick={() => flush()}
                disabled={!online}
                className="h-11 rounded-lg font-bold text-[14px] text-white disabled:opacity-60"
                style={{ backgroundColor: "#163A5F" }}
              >
                {online ? "Send now" : "No signal to send"}
              </button>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex justify-center items-center gap-2 h-[55px] rounded-lg bg-white"
            style={{ border: "2px solid #C9363E" }}
          >
            <LogOut size={18} color="#C9363E" />
            <span className="font-bold text-[16px]" style={{ color: "#C9363E" }}>
              {confirmLogout && queue.length > 0 ? "Log out anyway" : "Log out"}
            </span>
          </button>
        </div>
      </div>

      {/* Bottom Nav: hidden until the first-login details are saved */}
      {!setupNeeded && (
        <div
          className="fixed bottom-0 left-0 right-0 flex items-center justify-between px-8 py-2.5 bg-white z-50"
          style={{ borderTop: "1px solid #D9E1E8", boxShadow: "0px -8px 28px 0px rgba(11, 39, 67, 0.16)" }}
        >
          <Link href="/driver" className="flex flex-col items-center gap-1 w-[72px]">
            <Home size={22} color="#8793A0" />
            <span className="text-[10px] font-medium" style={{ color: "#8793A0" }}>Home</span>
          </Link>
          <Link href="/driver/trip" className="flex flex-col items-center gap-1 w-[72px]">
            <Map size={22} color="#8793A0" />
            <span className="text-[10px] font-medium" style={{ color: "#8793A0" }}>Map</span>
          </Link>
          <Link href="/driver/report" className="flex flex-col items-center gap-1 w-[72px]">
            <TriangleAlert size={22} color="#8793A0" />
            <span className="text-[10px] font-medium" style={{ color: "#8793A0" }}>Report</span>
          </Link>
          <Link href="/driver/profile" className="flex flex-col items-center gap-1 w-[72px]">
            <User size={22} color="#163A5F" />
            <span className="text-[10px] font-bold" style={{ color: "#163A5F" }}>Profile</span>
          </Link>
        </div>
      )}
    </div>
  );
}
