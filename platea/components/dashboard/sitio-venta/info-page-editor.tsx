"use client"

import { useMemo, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Eye, FileText, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useLoading } from "@/components/loading-provider"
import { useAppTheme } from "@/components/theme-provider"
import { TenantInfoPageView } from "@/components/tenant/tenant-info-page-view"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import { getTenantInfoPageLabel, getTenantInfoPageSlug, type TenantInfoPage, type TenantInfoPageKey } from "@/lib/tenant-info"
import { hasMeaningfulRichText, normalizeInfoContentToHtml, sanitizeTenantRichText } from "@/lib/tenant-rich-text"
import { buildSitioVentaPayload, createSitioVentaInitialForm, getInfoPageByKey, replaceInfoPage } from "./form-helpers"
import type { SitioVentaEmpresa } from "./types"

const RichTextEditor = dynamic(
  () => import("./rich-text-editor").then((mod) => mod.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-border bg-muted/20 text-sm text-muted-foreground">
        Cargando editor...
      </div>
    ),
  },
)

const INFO_PAGE_EDITOR_COPY: Record<TenantInfoPageKey, { description: string; placeholder: string }> = {
  contacto: {
    description: "Editá la página pública de contacto con una experiencia dedicada y una vista previa fiel al tenant.",
    placeholder: "## Cómo contactarnos\n\nEscribinos por [WhatsApp](https://wa.me/5491122334455) o por [email](mailto:hola@tuempresa.com).\n\n- Horario de respuesta: lunes a viernes de 10 a 18 hs.\n- Incluí el nombre del evento si tu consulta es operativa.",
  },
  arrepentimiento: { description: "", placeholder: "" },
  terminos: {
    description: "Editá las condiciones de uso que verá el comprador dentro del sitio de venta.",
    placeholder: "## Términos y condiciones\n\nDescribí las reglas de compra, acceso y uso del servicio para tus compradores.",
  },
  privacidad: {
    description: "Editá la política de privacidad pública del tenant.",
    placeholder: "## Política de privacidad\n\nExplicá cómo tratás los datos personales y por qué canales pueden hacer consultas.",
  },
  defensa_consumidor: {
    description: "Completá la información de defensa del consumidor visible para el comprador.",
    placeholder: "## Defensa del consumidor\n\nIndicá organismo, canal de reclamo y cualquier dato obligatorio según tu operación.",
  },
  eliminar_cuenta: {
    description: "Explicá el procedimiento para solicitar eliminación de cuenta o datos.",
    placeholder: "## Eliminar cuenta\n\nIndicá el canal y los pasos que debe seguir un usuario para solicitar la baja.",
  },
}

function normalizeEditorPage(page: TenantInfoPage) {
  return {
    ...page,
    title: page.title.trim() || getTenantInfoPageLabel(page.key),
    content: sanitizeTenantRichText(page.content),
  }
}

export function SitioVentaInfoPageEditor({
  empresa,
  permisos,
  esEmpleado,
  pageKey,
}: {
  empresa: SitioVentaEmpresa
  permisos?: Permisos
  esEmpleado?: boolean
  pageKey: TenantInfoPageKey
}) {
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)
  const canEdit = puede("editar_configuracion")
  const router = useRouter()
  const { withLoading } = useLoading()
  const { resolvedTheme } = useAppTheme()
  const initialForm = useMemo(() => createSitioVentaInitialForm(empresa), [empresa])
  const initialPage = useMemo(() => getInfoPageByKey(initialForm.info_pages, pageKey), [initialForm.info_pages, pageKey])
  const [page, setPage] = useState<TenantInfoPage | null>(
    initialPage
      ? {
          ...initialPage,
          content: normalizeInfoContentToHtml(initialPage.content),
        }
      : null
  )
  const [mode, setMode] = useState<"edicion" | "ver">("edicion")
  const [navGuardOpen, setNavGuardOpen] = useState(false)

  if (!page) {
    return (
      <div className="rounded-3xl border border-border bg-card p-6 text-sm text-muted-foreground">
        No encontramos la página seleccionada dentro de Información.
      </div>
    )
  }

  const currentPage = page

  const copy = INFO_PAGE_EDITOR_COPY[pageKey]
  const publicHref = buildTenantPath(empresa.slug, tenantRoutes.informacionPage(getTenantInfoPageSlug(pageKey)))
  const normalizedPage = normalizeEditorPage(currentPage)
  const formChanged = JSON.stringify(currentPage) !== JSON.stringify(initialPage)

  function handleVolver() {
    if (!formChanged) {
      router.push("/sitio-venta/editor")
      return
    }
    setNavGuardOpen(true)
  }

  async function handleSave() {
    if (currentPage.enabled && !hasMeaningfulRichText(currentPage.content)) {
      toast.error(`Completá el contenido de \"${normalizedPage.title}\" antes de aplicarla`)
      return
    }

    const nextForm = {
      ...initialForm,
      info_pages: replaceInfoPage(initialForm.info_pages, normalizedPage),
    }

    await withLoading(async () => {
      const res = await fetch("/api/sitio-venta", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSitioVentaPayload(nextForm)),
      })

        const data = await res.json()

        if (!res.ok) {
          toast.error(data.error ?? `No pudimos guardar ${normalizedPage.title}`)
          return
        }

        toast.success(`${normalizedPage.title} guardada`)
        setPage(normalizedPage)
        router.refresh()
      })
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <button type="button" onClick={handleVolver} className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground cursor-pointer">
            <ArrowLeft className="h-4 w-4" /> Volver a Sitio de venta
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">Información · {getTenantInfoPageLabel(pageKey)}</h1>
             <Badge variant={currentPage.enabled && currentPage.content.trim() ? "default" : "outline"}>{currentPage.enabled && currentPage.content.trim() ? "Aplicada" : "Deshabilitada"}</Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">{copy.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild type="button" variant="outline">
            <Link href={publicHref} target="_blank" rel="noreferrer">Ver ruta pública</Link>
          </Button>
          <Button type="button" className="gap-2" onClick={handleSave} disabled={!canEdit || !formChanged}>
            <Save className="h-4 w-4" /> Guardar cambios
          </Button>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card p-4 md:p-5 space-y-4">
        <Tabs value={mode} onValueChange={(value) => setMode(value as "edicion" | "ver")} className="gap-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/20 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-4 flex-1 min-w-0">
              <div className="space-y-2">
                <label className="inline-flex items-center gap-3 cursor-pointer">
                  <Switch
                    checked={currentPage.enabled}
                    onCheckedChange={(checked) => setPage({ ...currentPage, enabled: checked })}
                    disabled={!canEdit}
                  />
                  <span className="text-sm font-semibold text-foreground">Mostrar esta página en el menú Información</span>
                </label>
              </div>

            </div>

            <TabsList variant="line" className="w-full lg:w-auto">
              <TabsTrigger value="edicion" className="gap-2">
                <FileText className="h-4 w-4" /> Edición
              </TabsTrigger>
              <TabsTrigger value="ver" className="gap-2">
                <Eye className="h-4 w-4" /> Ver
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="edicion" className="mt-0 space-y-4">
            <div className="grid gap-4">
              <div className="rounded-2xl border border-border bg-background p-4 space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Título visible</Label>
                  <Input
                    className="h-10"
                     value={currentPage.title}
                     onChange={(event) => setPage({ ...currentPage, title: event.target.value })}
                    placeholder={getTenantInfoPageLabel(pageKey)}
                    disabled={!canEdit}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Contenido</Label>
                  <RichTextEditor
                     value={currentPage.content}
                     onChange={(html) => setPage({ ...currentPage, content: html })}
                    placeholder={copy.placeholder}
                    editable={canEdit}
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="ver" className="mt-0 space-y-3">
            {!normalizedPage.enabled ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                Esta preview refleja el comportamiento público real: mientras la página siga deshabilitada, no aparecerá en el menú Información.
              </div>
            ) : null}
            <div className="overflow-hidden rounded-3xl border border-border bg-muted/15">
              <TenantInfoPageView
                tenant={{
                  ...empresa,
                  nombre: empresa.nombre ?? "Preview",
                  logo_url: empresa.logo_url ?? null,
                  navbar_size: initialForm.navbar_size,
                  desktop_event_card_size: initialForm.desktop_event_card_size,
                  color_primario: initialForm.color_primario,
                  color_fondo: initialForm.color_fondo,
                  color_texto: initialForm.color_texto,
                  descripcion: empresa.descripcion ?? null,
                  whatsapp: empresa.whatsapp ?? null,
                  banners: empresa.banners ?? null,
                  home_sections: null,
                   faqs: initialForm.faqs,
                  sales_readiness: null,
                  info_pages: empresa.info_pages ?? null,
                }}
                title={normalizedPage.title}
                content={normalizedPage.content}
                available={normalizedPage.enabled && hasMeaningfulRichText(normalizedPage.content)}
                forceMode={resolvedTheme === "light" ? "light" : "dark"}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {!canEdit ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Tenés acceso para ver la configuración, pero no para editarla. Si necesitás cambios, pedile permiso a un administrador.
        </div>
      ) : null}

      <Dialog open={navGuardOpen} onOpenChange={setNavGuardOpen}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">Tenés cambios sin guardar</DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm mt-1">
              Si salís ahora, los cambios en esta página se van a perder.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-4">
            <Button type="button" variant="outline" className="flex-1 h-10" onClick={() => setNavGuardOpen(false)}>
              Quedarme
            </Button>
            <Button
              type="button"
              className="flex-1 h-10"
              onClick={() => {
                setNavGuardOpen(false)
                router.push("/sitio-venta/editor")
              }}
            >
              Salir igual
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
