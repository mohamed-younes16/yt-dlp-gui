import { Clock, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatDuration } from "@/lib/types";

interface TrimSliderProps {
  duration: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  disabled?: boolean;
}

export function TrimSlider({ duration, value, onChange, disabled }: TrimSliderProps) {
  const [start, end] = value;
  const full = start <= 0.5 && end >= duration - 0.5;

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Scissors className="size-4" />
          Trim
          {!full && (
            <span className="bg-primary/15 text-primary rounded-full px-1.5 py-0.5 text-[10px]">
              {formatDuration(end - start)}
            </span>
          )}
        </span>
        <span className="text-muted-foreground flex items-center gap-1 text-xs tabular-nums">
          <Clock className="size-3" />
          {formatDuration(start)} — {formatDuration(end)} / {formatDuration(duration)}
        </span>
      </div>

      <Slider
        value={value}
        onValueChange={(v) => onChange([v[0] as number, v[1] as number])}
        min={0}
        max={Math.floor(duration)}
        step={1}
        disabled={disabled}
      />

      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-[11px]">Drag both ends to slice before downloading</span>
        {!full && (
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onChange([0, Math.floor(duration)])} disabled={disabled}>
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}
