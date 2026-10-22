import { ImageResponse } from "next/og"

export const runtime = "edge"
export const revalidate = 86400
export const alt = "Ticketera — Ticketera para eventos en Argentina"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default async function OpenGraphImage() {
  const [interBold, interSemiBold] = await Promise.all([
    fetch("https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuFuYAZ9hiJ-Ek-_EeA.woff").then(r => r.arrayBuffer()),
    fetch("https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuGKYAZ9hiJ-Ek-_EeA.woff").then(r => r.arrayBuffer()),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(150deg, #061a3d 0%, #0c2d6b 50%, #061a3d 100%)",
          fontFamily: "Inter",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Ambient glow top-left */}
        <div style={{
          position: "absolute", top: -120, left: -80,
          width: 520, height: 520,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,82,204,0.45) 0%, transparent 70%)",
          display: "flex",
        }} />
        {/* Ambient glow bottom-right */}
        <div style={{
          position: "absolute", bottom: -100, right: -60,
          width: 440, height: 440,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,174,132,0.18) 0%, transparent 70%)",
          display: "flex",
        }} />

        {/* Top accent bar */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 5,
          background: "linear-gradient(90deg, #0052cc 0%, #ffae84 50%, #0052cc 100%)",
          display: "flex",
        }} />

        {/* Main content — centered for Instagram safe crop */}
        <div style={{
          display: "flex", flexDirection: "column",
          alignItems: "center", textAlign: "center",
          gap: "0px", zIndex: 1,
          padding: "0 80px",
        }}>
          {/* Logo mark + brand name */}
          <div style={{ display: "flex", alignItems: "center", gap: "18px", marginBottom: "52px" }}>
            {/* Ticket icon in JSX (Satori-compatible) */}
            <div style={{
              width: 76, height: 76, borderRadius: 22,
              background: "#0052cc",
              display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative",
              boxShadow: "0 0 0 3px rgba(0,82,204,0.35)",
            }}>
              {/* Ticket body */}
              <div style={{
                width: 48, height: 30, borderRadius: 6,
                background: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                position: "relative",
              }}>
                {/* Left notch */}
                <div style={{
                  position: "absolute", left: -7, top: "50%",
                  width: 10, height: 10, borderRadius: "50%",
                  background: "#0052cc", marginTop: -5,
                  display: "flex",
                }} />
                {/* Right notch */}
                <div style={{
                  position: "absolute", right: -7, top: "50%",
                  width: 10, height: 10, borderRadius: "50%",
                  background: "#0052cc", marginTop: -5,
                  display: "flex",
                }} />
                {/* Checkmark left side */}
                <div style={{ display: "flex", marginLeft: -8 }}>
                  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
                    <polyline points="2,7 6,11 14,3" stroke="#0052cc" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                {/* Dashed divider */}
                <div style={{
                  position: "absolute", right: 14, top: 3, bottom: 3,
                  borderLeft: "1.5px dashed rgba(0,82,204,0.4)",
                  display: "flex",
                }} />
              </div>
            </div>
            <span style={{
              fontSize: 46, fontWeight: 800, color: "#ffffff",
              letterSpacing: "-0.03em",
            }}>
              Ticketera
            </span>
          </div>

          {/* Headline */}
          <h1 style={{
            fontSize: 78, fontWeight: 800, color: "#ffffff",
            lineHeight: 1.05, margin: 0, letterSpacing: "-0.04em",
            maxWidth: 960,
          }}>
            La ticketera para eventos<br />en Argentina
          </h1>

          {/* Feature chips */}
          <div style={{
            display: "flex", alignItems: "center", gap: "12px",
            marginTop: 36,
          }}>
            {["Entradas", "Barra / POS", "Check-in QR", "Revendedores"].map((label) => (
              <div key={label} style={{
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 999, padding: "10px 22px",
                fontSize: 24, color: "#c8d6ff", fontWeight: 600,
                display: "flex",
              }}>
                {label}
              </div>
            ))}
          </div>

          {/* Value pill */}
          <div style={{
            marginTop: 40,
            background: "rgba(255,174,132,0.13)",
            border: "1px solid rgba(255,174,132,0.35)",
            borderRadius: 999, padding: "14px 36px",
            fontSize: 27, color: "#ffae84", fontWeight: 700,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <span>4% de comisión · Sin costo fijo · Tu marca</span>
          </div>
        </div>

        {/* Bottom domain */}
        <div style={{
          position: "absolute", bottom: 36,
          fontSize: 21, color: "rgba(200,214,255,0.4)",
          fontWeight: 600, letterSpacing: "0.05em",
          display: "flex",
        }}>
          TICKETERA.COM
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Inter", data: interBold, style: "normal", weight: 800 },
        { name: "Inter", data: interSemiBold, style: "normal", weight: 600 },
      ],
    },
  )
}
