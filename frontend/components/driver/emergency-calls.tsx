// Phone numbers that work without mobile data: an SOS must not depend on the app.

import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";

const NUMBERS = [
  { label: "Police", number: "119" },
  { label: "Ambulance (Suwa Seriya)", number: "1990" },
  { label: "Fire and rescue", number: "110" },
];

export function EmergencyCalls() {
  return (
    <section aria-labelledby="emergency-calls" className="flex flex-col gap-2">
      <h2 id="emergency-calls" className="text-sm font-bold">
        In danger? Call now
      </h2>
      <div className="grid grid-cols-3 gap-2">
        {NUMBERS.map((item) => (
          <Button key={item.number} asChild variant="outline" className="h-auto min-h-14 flex-col gap-0.5 py-2">
            <a href={`tel:${item.number}`} aria-label={`Call ${item.label}, ${item.number}`}>
              <span className="flex items-center gap-1 text-base font-bold">
                <Phone className="size-4" aria-hidden />
                {item.number}
              </span>
              <span className="text-[11px] leading-tight font-normal text-muted-foreground whitespace-normal">{item.label}</span>
            </a>
          </Button>
        ))}
      </div>
    </section>
  );
}
