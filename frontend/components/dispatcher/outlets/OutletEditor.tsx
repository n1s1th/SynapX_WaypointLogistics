"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Choice } from "@/components/dispatcher/operations/shared";
import { apiBase, weekdays, type OutletContact, type OutletRecord, type ReceivingWindow } from "./outlet-data";

const blankContact = (): OutletContact => ({ name: "", role: "", phone: "", email: "" });
const blankWindow = (): ReceivingWindow => ({ weekday: 0, opens_at: "09:00", closes_at: "17:00" });

export function OutletEditor({ outlet, onSaved, onClose }: { outlet?: OutletRecord; onSaved: (record: OutletRecord) => void; onClose: () => void }) {
  const [contacts, setContacts] = useState<OutletContact[]>(outlet?.contacts ?? []);
  const [windows, setWindows] = useState<ReceivingWindow[]>(outlet?.receiving_windows ?? []);
  const [active, setActive] = useState(outlet?.active ?? true);
  const [brand, setBrand] = useState(outlet?.brand ?? "fresh");
  const [depot, setDepot] = useState(outlet?.depot ?? "peliyagoda");
  const [dockType, setDockType] = useState(outlet?.dock_type ?? "rear_dock");
  const [vanOnly, setVanOnly] = useState(outlet?.van_only ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function changeContact(index: number, key: keyof OutletContact, value: string) { setContacts((items) => items.map((item, i) => i === index ? { ...item, [key]: value } : item)); }
  function changeWindow(index: number, key: keyof ReceivingWindow, value: string) { setWindows((items) => items.map((item, i) => i === index ? { ...item, [key]: key === "weekday" ? Number(value) : value } : item)); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      code: String(form.get("code")).trim(), name: String(form.get("name")).trim(), address: String(form.get("address")).trim(),
      district: String(form.get("district")).trim(), brand, depot, dock_type: dockType, van_only: vanOnly, active,
      delivery_restrictions: String(form.get("delivery_restrictions")).trim() || null,
      contacts: contacts.map(({ name, role, phone, email }) => ({ name: name.trim(), role: role?.trim() || null, phone: phone?.trim() || null, email: email?.trim() || null })),
      receiving_windows: windows.map(({ weekday, opens_at, closes_at }) => ({ weekday, opens_at, closes_at })),
      ...(outlet ? { expected_updated_at: outlet.updated_at } : {}),
    };
    if (contacts.some((c) => !c.name.trim() || !(c.phone?.trim() || c.email?.trim()))) { setError("Each contact needs a name and a phone or email."); return; }
    if (windows.some((w) => !w.opens_at || !w.closes_at || w.opens_at >= w.closes_at)) { setError("Each receiving window must close after it opens on the same day."); return; }
    for (const day of weekdays.keys()) {
      const entries = windows.filter((w) => w.weekday === day).sort((a, b) => a.opens_at.localeCompare(b.opens_at));
      if (entries.some((entry, index) => index > 0 && entries[index - 1].closes_at > entry.opens_at)) { setError("Receiving windows cannot overlap."); return; }
    }
    setBusy(true); setError(null);
    try {
      const response = await fetch(`${apiBase}/api/v1/outlets/${outlet ? outlet.id : ""}`, { method: outlet ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "Could not save outlet. Check its fields and dispatcher access.");
      onSaved(result); toast.success(outlet ? "Outlet updated" : "Outlet added"); onClose();
    } catch (cause) { setError(cause instanceof Error ? `${cause.message} Refresh the directory before retrying if the connection was interrupted.` : "Could not save outlet."); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>{outlet ? `Edit ${outlet.name}` : "Add outlet"}</DialogTitle><DialogDescription>Register the delivery address, contacts, local receiving hours, and restrictions.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-6"><fieldset disabled={busy} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {([["code", "Outlet code", 20], ["name", "Outlet name", 255], ["address", "Delivery address", 500], ["district", "District", 100]] as const).map(([key, label, max]) => <div key={key} className="space-y-2"><Label htmlFor={`outlet-${key}`}>{label}</Label><Input id={`outlet-${key}`} name={key} defaultValue={outlet?.[key] ?? ""} required maxLength={max} pattern={key === "code" ? "[A-Za-z0-9][A-Za-z0-9_-]*" : undefined} /></div>)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><p className="text-sm font-medium">Brand</p><Choice label="Outlet brand" value={brand} onChange={setBrand} options={[{ value: "fresh", label: "Fresh" }, { value: "style", label: "Style" }, { value: "tech", label: "Tech" }]} /></div>
        <div className="space-y-2"><p className="text-sm font-medium">Serving depot</p><Choice label="Serving depot" value={depot} onChange={setDepot} options={[{ value: "peliyagoda", label: "Peliyagoda" }, { value: "kandy", label: "Kandy" }]} /></div>
        <div className="space-y-2"><p className="text-sm font-medium">Dock type</p><Choice label="Dock type" value={dockType} onChange={setDockType} options={[{ value: "rear_dock", label: "Rear dock" }, { value: "street", label: "Street unload" }, { value: "mall_bay", label: "Mall bay" }]} /></div>
        <div className="space-y-2"><p className="text-sm font-medium">Vehicle access</p><Choice label="Vehicle access" value={vanOnly ? "vans" : "all"} onChange={(value) => setVanOnly(value === "vans")} options={[{ value: "all", label: "Trucks and vans" }, { value: "vans", label: "Vans only" }]} /></div>
      </div>
      <div className="space-y-2"><Label htmlFor="outlet-restrictions">Delivery restrictions</Label><Textarea id="outlet-restrictions" name="delivery_restrictions" maxLength={2000} defaultValue={outlet?.delivery_restrictions ?? ""} placeholder="Loading bay, parking, vehicle access, unloading requirements…" /></div>
      <div className="space-y-2"><p className="text-sm font-medium">Status</p><Choice label="Outlet status" value={active ? "active" : "inactive"} onChange={(value) => setActive(value === "active")} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} /></div>
      <section aria-label="Contacts" className="space-y-3 border-t border-border pt-4"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Contacts</h3><Button type="button" variant="outline" onClick={() => setContacts((items) => [...items, blankContact()])}>Add contact</Button></div>
        {contacts.length === 0 && <p className="text-sm text-muted-foreground">No contacts recorded.</p>}
        {contacts.map((contact, index) => <div key={index} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
          {([["name", "Name"], ["role", "Role"], ["phone", "Phone"], ["email", "Email"]] as const).map(([key, label]) => <div key={key} className="space-y-1"><Label htmlFor={`contact-${index}-${key}`}>{label}</Label><Input id={`contact-${index}-${key}`} type={key === "email" ? "email" : "text"} value={contact[key] ?? ""} required={key === "name"} maxLength={{name:150,role:100,phone:40,email:255}[key]} onChange={(event) => changeContact(index, key, event.target.value)} /></div>)}
          <Button type="button" variant="ghost" onClick={() => setContacts((items) => items.filter((_, i) => i !== index))}>Remove contact {index + 1}</Button>
        </div>)}
      </section>
      <section aria-label="Receiving hours" className="space-y-3 border-t border-border pt-4"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Receiving hours</h3><Button type="button" variant="outline" onClick={() => setWindows((items) => [...items, blankWindow()])}>Add window</Button></div><p className="text-xs text-muted-foreground">Times are local to the outlet. A day without a window has no recorded receiving hours.</p>
        {windows.map((window, index) => <div key={index} className="grid items-end gap-3 rounded-md border border-border p-3 sm:grid-cols-4">
          <div className="space-y-1"><Label htmlFor={`window-${index}-day`}>Day</Label><select id={`window-${index}-day`} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={window.weekday} onChange={(event) => changeWindow(index, "weekday", event.target.value)}>{weekdays.map((day, i) => <option value={i} key={day}>{day}</option>)}</select></div>
          {([["opens_at", "Opens"], ["closes_at", "Closes"]] as const).map(([key, label]) => <div key={key} className="space-y-1"><Label htmlFor={`window-${index}-${key}`}>{label}</Label><Input id={`window-${index}-${key}`} type="time" required value={window[key]} onChange={(event) => changeWindow(index, key, event.target.value)} /></div>)}
          <Button type="button" variant="ghost" onClick={() => setWindows((items) => items.filter((_, i) => i !== index))}>Remove window {index + 1}</Button>
        </div>)}
      </section>
    </fieldset>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : outlet ? "Save changes" : "Add outlet"}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
