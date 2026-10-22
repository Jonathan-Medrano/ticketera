"use client"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface AutoSegmento {
  slug: string
  nombre: string
  count: number
}

interface ManualSegmento {
  id: number
  nombre: string
  count: number
}

interface SegmentSelectorProps {
  value: string
  onChange: (value: string) => void
  segmentos: { automaticos: AutoSegmento[]; manuales: ManualSegmento[] }
  placeholder?: string
}

export default function SegmentSelector({
  value,
  onChange,
  segmentos,
  placeholder = "Seleccionar segmento",
}: SegmentSelectorProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10 bg-background w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {segmentos.automaticos.length > 0 && (
          <SelectGroup>
            <SelectLabel>Automáticos</SelectLabel>
            {segmentos.automaticos.map((s) => (
              <SelectItem key={s.slug} value={s.slug}>
                {s.nombre} ({s.count})
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {segmentos.manuales.length > 0 && (
          <SelectGroup>
            <SelectLabel>Manuales</SelectLabel>
            {segmentos.manuales.map((s) => (
              <SelectItem key={String(s.id)} value={String(s.id)}>
                {s.nombre} ({s.count})
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}
