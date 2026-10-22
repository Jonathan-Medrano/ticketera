"use client"

import type { ReactNode } from "react"
import { TenantPanel } from "./tenant-surface"
import type { TenantEmpresa } from "@/lib/tenant"
import { looksLikeHtml, normalizeInfoContentToHtml, sanitizeTenantRichText } from "@/lib/tenant-rich-text"

function renderInlineFragments(text: string) {
  const tokens: ReactNode[] = []
  const pattern = /(\*\*([^*]+)\*\*|\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index))
    }

    if (match[2]) {
      tokens.push(
        <strong key={`strong-${match.index}`} className="font-semibold">
          {match[2]}
        </strong>
      )
    } else {
      tokens.push(
        <a
          key={`link-${match.index}`}
          href={match[4]}
          target={match[4].startsWith("http") ? "_blank" : undefined}
          rel={match[4].startsWith("http") ? "noreferrer" : undefined}
          className="underline underline-offset-4"
        >
          {match[3]}
        </a>
      )
    }

    lastIndex = pattern.lastIndex
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex))
  }

  return tokens
}

function renderParagraph(text: string) {
  const lines = text.split("\n")

  return lines.map((line, index) => (
    <span key={`line-${index}`}>
      {renderInlineFragments(line)}
      {index < lines.length - 1 ? <br /> : null}
    </span>
  ))
}

function renderRichContent(content: string) {
  return content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      if (block.startsWith("### ")) {
        return (
          <h3 key={`block-${index}`} className="text-base font-semibold md:text-lg">
            {block.slice(4)}
          </h3>
        )
      }

      if (block.startsWith("## ")) {
        return (
          <h2 key={`block-${index}`} className="text-lg font-semibold md:text-xl">
            {block.slice(3)}
          </h2>
        )
      }

      const lines = block.split("\n")
      const isList = lines.every((line) => line.trim().startsWith("- "))

      if (isList) {
        return (
          <ul key={`block-${index}`} className="list-disc space-y-2 pl-5">
            {lines.map((line, itemIndex) => (
              <li key={`item-${itemIndex}`}>{renderInlineFragments(line.trim().slice(2))}</li>
            ))}
          </ul>
        )
      }

      return <p key={`block-${index}`}>{renderParagraph(block)}</p>
    })
}

export function TenantInfoPageView({
  tenant,
  title,
  content,
  available,
  forceMode,
}: {
  tenant: TenantEmpresa
  title: string
  content: string
  available: boolean
  forceMode?: "light" | "dark"
}) {
  const contentIsHtml = looksLikeHtml(content)
  const normalizedContent = contentIsHtml ? sanitizeTenantRichText(content) : normalizeInfoContentToHtml(content)
  const previewTenant = forceMode === "light"
    ? {
        ...tenant,
        color_fondo: "#f8fafc",
        color_texto: "#0f172a",
      }
    : tenant

  if (!available) {
    return (
      <div className="px-4 pt-28 pb-28" style={{ background: previewTenant.color_fondo }}>
        <div className="max-w-4xl mx-auto">
        <TenantPanel tenant={previewTenant} className="rounded-[2rem] border p-6 md:p-8" tone="soft">
          <h1 className="text-2xl font-black mb-3" style={{ color: previewTenant.color_texto }}>Información no disponible</h1>
          <p style={{ color: `${previewTenant.color_texto}75` }}>Esta sección no está habilitada o todavía no fue completada.</p>
        </TenantPanel>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pt-28 pb-28" style={{ background: previewTenant.color_fondo }}>
      <div className="max-w-4xl mx-auto">
      <TenantPanel tenant={previewTenant} className="rounded-[2rem] border p-6 md:p-8" tone="soft">
        <h1 className="text-3xl md:text-4xl font-black tracking-[-0.04em] mb-4" style={{ color: previewTenant.color_texto }}>
          {title}
        </h1>
        {contentIsHtml ? (
          <div
            className="text-sm md:text-base leading-relaxed max-w-none break-words [&_p]:mb-4 [&_p]:leading-relaxed [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_li]:leading-relaxed [&_strong]:font-semibold [&_em]:italic [&_u]:underline [&_blockquote]:my-4 [&_blockquote]:rounded-2xl [&_blockquote]:border-l-4 [&_blockquote]:px-4 [&_blockquote]:py-3 [&_blockquote]:border-l-[var(--tenant-info-quote-border)] [&_blockquote]:bg-[var(--tenant-info-quote-bg)] [&_h2]:mb-4 [&_h2]:text-lg [&_h2]:font-semibold md:[&_h2]:text-xl [&_h3]:mb-3 [&_h3]:text-base [&_h3]:font-semibold md:[&_h3]:text-lg [&_a]:text-[var(--tenant-info-link)] [&_a]:underline [&_a]:underline-offset-4"
            style={{
              color: `${previewTenant.color_texto}cc`,
              ['--tenant-info-link' as string]: previewTenant.color_primario,
              ['--tenant-info-quote-border' as string]: `${previewTenant.color_primario}`,
              ['--tenant-info-quote-bg' as string]: `${previewTenant.color_texto}08`,
            }}
            dangerouslySetInnerHTML={{ __html: normalizedContent }}
          />
        ) : (
          <div className="space-y-4 text-sm md:text-base leading-relaxed break-words" style={{ color: `${previewTenant.color_texto}cc` }}>
            {renderRichContent(content)}
          </div>
        )}
      </TenantPanel>
      </div>
    </div>
  )
}
