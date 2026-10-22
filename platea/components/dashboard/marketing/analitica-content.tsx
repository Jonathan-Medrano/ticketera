"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  BarChart2,
  BarChart3,
  MousePointerClick,
  Tag,
  Copy,
  Check,
  Loader2,
  CheckCircle2,
  ChevronDown,
  Unlink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface TrackingConfig {
  ga4_measurement_id: string | null
  meta_pixel_id: string | null
  gtm_container_id: string | null
}

interface GoogleStatus {
  connected: boolean
  email?: string | null
  ga4PropertyId?: string | null
  ga4MeasurementId?: string | null
  gtmAccountId?: string | null
  gtmContainerId?: string | null
  connectedAt?: string | null
}

interface Ga4Property {
  propertyId: string
  displayName: string
}

interface GtmContainer {
  accountId: string
  containerId: string
  publicId: string
  name: string
}

interface Props {
  initialTracking: TrackingConfig
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function TrackingCard({
  id,
  icon,
  title,
  description,
  placeholder,
  value,
  onChange,
  onSave,
  saving,
}: {
  id: string
  icon: React.ReactNode
  title: string
  description: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  onSave: () => void
  saving: boolean
}) {
  const hasValue = value.trim().length > 0
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-foreground text-sm">{title}</h3>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                  hasValue
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground"
                }`}
              >
                {hasValue ? "Activo" : "No configurado"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <label htmlFor={id} className="sr-only">{title}</label>
        <Input
          id={id}
          className="h-10 flex-1 font-mono text-sm"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button className="h-10 px-4 shrink-0 gap-2" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
        </Button>
      </div>
    </div>
  )
}

function UtmBuilder() {
  const [baseUrl, setBaseUrl] = useState("")
  const [source, setSource] = useState("")
  const [medium, setMedium] = useState("")
  const [campaign, setCampaign] = useState("")
  const [content, setContent] = useState("")
  const [term, setTerm] = useState("")
  const [copied, setCopied] = useState(false)

  const generatedUrl = useMemo(() => {
    if (!baseUrl.trim()) return ""
    try {
      const url = new URL(
        baseUrl.trim().startsWith("http") ? baseUrl.trim() : `https://${baseUrl.trim()}`
      )
      if (source.trim()) url.searchParams.set("utm_source", source.trim())
      if (medium.trim()) url.searchParams.set("utm_medium", medium.trim())
      if (campaign.trim()) url.searchParams.set("utm_campaign", campaign.trim())
      if (content.trim()) url.searchParams.set("utm_content", content.trim())
      if (term.trim()) url.searchParams.set("utm_term", term.trim())
      return url.toString()
    } catch {
      return ""
    }
  }, [baseUrl, source, medium, campaign, content, term])

  async function copiar() {
    if (!generatedUrl) return
    await navigator.clipboard.writeText(generatedUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-5">
      <div>
        <h3 className="font-semibold text-foreground">UTM Builder</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Generá URLs de campaña para rastrear el origen del tráfico.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2 space-y-1.5">
          <Label htmlFor="utm-base-url" className="text-xs text-muted-foreground">URL base</Label>
          <Input
            id="utm-base-url"
            className="h-10"
            placeholder="https://tutienda.ticketera.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="utm-source" className="text-xs text-muted-foreground">utm_source</Label>
          <Input
            id="utm-source"
            className="h-10"
            placeholder="instagram"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="utm-medium" className="text-xs text-muted-foreground">utm_medium</Label>
          <Input
            id="utm-medium"
            className="h-10"
            placeholder="cpc"
            value={medium}
            onChange={(e) => setMedium(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="utm-campaign" className="text-xs text-muted-foreground">utm_campaign</Label>
          <Input
            id="utm-campaign"
            className="h-10"
            placeholder="verano-2025"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="utm-content" className="text-xs text-muted-foreground">
            utm_content <span className="opacity-50">(opc.)</span>
          </Label>
          <Input
            id="utm-content"
            className="h-10"
            placeholder="banner-hero"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="utm-term" className="text-xs text-muted-foreground">
            utm_term <span className="opacity-50">(opc.)</span>
          </Label>
          <Input
            id="utm-term"
            className="h-10"
            placeholder="entradas evento"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
      </div>
      {generatedUrl && (
        <div className="rounded-xl border border-border bg-muted/50 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">URL generada</p>
          <p className="text-xs font-mono text-foreground break-all">{generatedUrl}</p>
          <Button size="sm" variant="outline" className="h-8 gap-2 text-xs" onClick={copiar}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copiado" : "Copiar URL"}
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Panel Google OAuth ───────────────────────────────────────────────────────

function GoogleConnectionPanel() {
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const [statusError, setStatusError] = useState(false)

  const [ga4Properties, setGa4Properties] = useState<Ga4Property[]>([])
  const [loadingGa4, setLoadingGa4] = useState(false)
  const [savingGa4, setSavingGa4] = useState(false)
  const [selectedGa4, setSelectedGa4] = useState("")

  const [gtmContainers, setGtmContainers] = useState<GtmContainer[]>([])
  const [loadingGtm, setLoadingGtm] = useState(false)
  const [savingGtm, setSavingGtm] = useState(false)
  const [selectedGtm, setSelectedGtm] = useState("")

  const searchParams = useSearchParams()
  const router = useRouter()

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true)
    setStatusError(false)
    try {
      const res = await fetch("/api/marketing/google/status")
      if (!res.ok) {
        setStatusError(true)
        return
      }
      const data: GoogleStatus = await res.json()
      setStatus(data)
      if (data.ga4PropertyId) setSelectedGa4(data.ga4PropertyId)
      if (data.gtmContainerId) setSelectedGtm(data.gtmContainerId)
    } catch {
      setStatusError(true)
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Detectar ?google_connected=1 o ?google_error=...
  useEffect(() => {
    const connected = searchParams.get("google_connected")
    const error = searchParams.get("google_error")
    if (connected === "1") {
      toast.success("Cuenta de Google conectada exitosamente")
      fetchStatus()
      // Limpiar params de URL sin navegar
      const url = new URL(window.location.href)
      url.searchParams.delete("google_connected")
      router.replace(url.pathname + url.search, { scroll: false })
    } else if (error) {
      toast.error(`Error al conectar con Google: ${error}`)
      const url = new URL(window.location.href)
      url.searchParams.delete("google_error")
      router.replace(url.pathname + url.search, { scroll: false })
    }
  }, [searchParams, fetchStatus, router])

  async function handleConnect() {
    setConnecting(true)
    try {
      const res = await fetch("/api/marketing/google/auth-url")
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo obtener la URL de autorización")
        return
      }
      window.location.assign(data.authUrl)
    } catch {
      toast.error("Error al iniciar la conexión con Google")
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      const res = await fetch("/api/marketing/google/connection", { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "Error al desconectar")
        return
      }
      toast.success("Cuenta de Google desconectada")
      setStatus({ connected: false })
      setGa4Properties([])
      setGtmContainers([])
      setSelectedGa4("")
      setSelectedGtm("")
    } catch {
      toast.error("Error al desconectar Google")
    } finally {
      setDisconnecting(false)
    }
  }

  async function loadGa4Properties() {
    setLoadingGa4(true)
    try {
      const res = await fetch("/api/marketing/google/ga4-properties")
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al cargar propiedades GA4")
        return
      }
      setGa4Properties(data.properties ?? [])
    } catch {
      toast.error("Error al cargar propiedades GA4")
    } finally {
      setLoadingGa4(false)
    }
  }

  async function loadGtmContainers() {
    setLoadingGtm(true)
    try {
      const res = await fetch("/api/marketing/google/gtm-containers")
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al cargar contenedores GTM")
        return
      }
      setGtmContainers(data.containers ?? [])
    } catch {
      toast.error("Error al cargar contenedores GTM")
    } finally {
      setLoadingGtm(false)
    }
  }

  async function saveGa4() {
    if (!selectedGa4) return
    setSavingGa4(true)
    try {
      const res = await fetch("/api/marketing/google/ga4-selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: selectedGa4 }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al guardar propiedad GA4")
        return
      }
      toast.success("Propiedad GA4 guardada")
      await fetchStatus()
    } catch {
      toast.error("Error al guardar propiedad GA4")
    } finally {
      setSavingGa4(false)
    }
  }

  async function saveGtm() {
    if (!selectedGtm) return
    // selectedGtm = "accountId:containerId"
    const [accountId, containerId] = selectedGtm.split(":")
    setSavingGtm(true)
    try {
      const res = await fetch("/api/marketing/google/gtm-selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, containerId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al guardar contenedor GTM")
        return
      }
      toast.success("Contenedor GTM guardado")
      await fetchStatus()
    } catch {
      toast.error("Error al guardar contenedor GTM")
    } finally {
      setSavingGtm(false)
    }
  }

  // ── Loading inicial ──
  if (loadingStatus) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 flex items-center justify-center shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // ── Desconectado ──
  if (!status?.connected) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <BarChart2 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">Google Analytics 4 y Tag Manager</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Conectá tu cuenta de Google para configurar GA4 y GTM automáticamente.
            </p>
          </div>
        </div>
        {statusError && (
          <p className="text-xs text-muted-foreground">
            No se pudo verificar el estado de la conexión. Recargá la página.
          </p>
        )}
        <Button onClick={handleConnect} disabled={connecting} className="gap-2">
          {connecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          )}
          Conectar con Google
        </Button>
        <p className="text-xs text-muted-foreground">
          Conectá una sola vez y elegí qué propiedad GA4 y qué contenedor GTM usar.
        </p>
      </div>
    )
  }

  // ── Conectado ──
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6">
      {/* Header conectado */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-foreground text-sm">Google conectado</h3>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
                Activo
              </span>
            </div>
            {status.email && (
              <p className="text-xs text-muted-foreground mt-0.5">{status.email}</p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs h-8 text-destructive border-destructive/40 hover:bg-destructive/10"
          onClick={handleDisconnect}
          disabled={disconnecting}
        >
          {disconnecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Unlink className="h-3.5 w-3.5" />
          )}
          Desconectar
        </Button>
      </div>

      {/* GA4 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-medium text-foreground">Propiedad GA4</p>
            {status.ga4PropertyId ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                Propiedad activa: <span className="font-mono">{status.ga4MeasurementId ?? status.ga4PropertyId}</span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">Sin configurar</p>
            )}
          </div>
          {ga4Properties.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-8"
              onClick={loadGa4Properties}
              disabled={loadingGa4}
            >
              {loadingGa4 ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {status.ga4PropertyId ? "Cambiar" : "Elegir propiedad"}
            </Button>
          )}
        </div>
        {ga4Properties.length > 0 && (
          <div className="flex gap-2">
            <Select value={selectedGa4} onValueChange={setSelectedGa4}>
              <SelectTrigger className="h-10 flex-1">
                <SelectValue placeholder="Elegí una propiedad GA4" />
              </SelectTrigger>
              <SelectContent>
                {ga4Properties.map((p) => (
                  <SelectItem key={p.propertyId} value={p.propertyId}>
                    {p.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="h-10 px-4 shrink-0"
              onClick={saveGa4}
              disabled={savingGa4 || !selectedGa4}
            >
              {savingGa4 ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
            </Button>
          </div>
        )}
      </div>

      {/* GTM */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-medium text-foreground">Contenedor GTM</p>
            {status.gtmContainerId ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                Contenedor activo: <span className="font-mono">{status.gtmContainerId}</span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">Sin configurar</p>
            )}
          </div>
          {gtmContainers.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-8"
              onClick={loadGtmContainers}
              disabled={loadingGtm}
            >
              {loadingGtm ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {status.gtmContainerId ? "Cambiar" : "Elegir contenedor"}
            </Button>
          )}
        </div>
        {gtmContainers.length > 0 && (
          <div className="flex gap-2">
            <Select
              value={selectedGtm}
              onValueChange={setSelectedGtm}
            >
              <SelectTrigger className="h-10 flex-1">
                <SelectValue placeholder="Elegí un contenedor GTM" />
              </SelectTrigger>
              <SelectContent>
                {gtmContainers.map((c) => (
                  <SelectItem
                    key={`${c.accountId}:${c.containerId}`}
                    value={`${c.accountId}:${c.containerId}`}
                  >
                    {c.name} ({c.publicId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="h-10 px-4 shrink-0"
              onClick={saveGtm}
              disabled={savingGtm || !selectedGtm}
            >
              {savingGtm ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AnaliticaContent({ initialTracking }: Props) {
  const [pixel, setPixel] = useState(initialTracking.meta_pixel_id ?? "")
  const [savingPixel, setSavingPixel] = useState(false)

  async function saveTracking(field: string, value: string, setSaving: (v: boolean) => void) {
    setSaving(true)
    try {
      const res = await fetch("/api/marketing/analitica/tracking", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al guardar")
        return
      }
      toast.success("Configuración guardada")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-[-0.02em]">Analítica & Tracking</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Conectá herramientas de medición y generá URLs de campaña.
        </p>
      </div>

      {/* ── Connection-status KPI strip ───────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        {/* GA4 */}
        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Google Analytics 4</p>
              <Badge
                variant="outline"
                className={
                  (initialTracking.ga4_measurement_id ?? "").trim().length > 0
                    ? "mt-1 border-primary/30 bg-primary/10 text-primary"
                    : "mt-1 border-border bg-muted text-muted-foreground"
                }
              >
                {(initialTracking.ga4_measurement_id ?? "").trim().length > 0
                  ? "Activo"
                  : "Sin configurar"}
              </Badge>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BarChart3 className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Meta Pixel */}
        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Meta Pixel</p>
              <Badge
                variant="outline"
                className={
                  pixel.trim().length > 0
                    ? "mt-1 border-primary/30 bg-primary/10 text-primary"
                    : "mt-1 border-border bg-muted text-muted-foreground"
                }
              >
                {pixel.trim().length > 0 ? "Activo" : "Sin configurar"}
              </Badge>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MousePointerClick className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* GTM */}
        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Google Tag Manager</p>
              <Badge
                variant="outline"
                className={
                  (initialTracking.gtm_container_id ?? "").trim().length > 0
                    ? "mt-1 border-primary/30 bg-primary/10 text-primary"
                    : "mt-1 border-border bg-muted text-muted-foreground"
                }
              >
                {(initialTracking.gtm_container_id ?? "").trim().length > 0
                  ? "Activo"
                  : "Sin configurar"}
              </Badge>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Tag className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Integraciones de Tracking</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Los scripts se inyectan automáticamente en tu tienda pública una vez configurados.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Panel Google (GA4 + GTM via OAuth) — hidden until GOOGLE_MARKETING_CLIENT_ID/SECRET are set in prod */}
          {false && (
            <div className="lg:col-span-2">
              <GoogleConnectionPanel />
            </div>
          )}

          {/* Meta Pixel — campo manual, sin cambios */}
          <TrackingCard
            id="tracking-meta-pixel"
            icon={<MousePointerClick className="h-5 w-5" />}
            title="Meta Pixel"
            description="Seguí conversiones de campañas en Facebook e Instagram."
            placeholder="123456789012345"
            value={pixel}
            onChange={setPixel}
            onSave={() => saveTracking("meta_pixel_id", pixel, setSavingPixel)}
            saving={savingPixel}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">UTM Builder</h2>
        </div>
        <UtmBuilder />
      </section>

      {/* Conversiones por UTM — hidden: no backend feed yet */}
      {false && (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Conversiones por UTM</h2>
          </div>
          <div className="rounded-2xl border border-border bg-card p-10 text-center shadow-sm">
            <BarChart2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">Sin datos todavía</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Los datos de conversión aparecerán aquí una vez que tus compradores lleguen desde
              campañas con UTM.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
