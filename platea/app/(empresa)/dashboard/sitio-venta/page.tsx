import { redirect } from "next/navigation"

// Legacy path — kept as a redirect so old links/bookmarks to the inline tabs
// editor still land somewhere. The editor now lives at its own route with its
// own navbar/shell (see app/(empresa)/sitio-venta/editor/page.tsx).
export default function SitioVentaLegacyRedirectPage() {
  redirect("/sitio-venta/editor")
}
