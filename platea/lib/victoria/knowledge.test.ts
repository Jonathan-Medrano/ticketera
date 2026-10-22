// Anti-deriva: garantiza que Victoria nunca mande a una ruta inexistente.
//
// Recorre los CTAs de la KB (TOPICS) y el mapa de apertura contextual
// (ROUTE_TOPIC) y verifica que cada ruta del dashboard tiene un `page.tsx` real
// bajo app/(empresa). Si alguien renombra o borra una ruta, este test ROMPE en
// vez de dejar a Victoria mandando a un 404.
//
// Correr: npx tsx --test lib/victoria/knowledge.test.ts   (desde platea/)

import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs"
import path from "node:path"

import { TOPICS, TOPIC_BY_ID } from "./knowledge"
import { ROUTE_TOPIC } from "./route-topic"

// __dirname existe en runtime CJS (platea no declara "type":"module").
// app/(empresa) es el route group: NO aparece en la URL, así que una ruta
// "/dashboard/x" vive en app/(empresa)/dashboard/x/page.tsx.
const APP_EMPRESA_DIR = path.resolve(__dirname, "..", "..", "app", "(empresa)")

/** ¿Existe un page.tsx real para esta ruta del dashboard? */
function dashboardRouteExists(href: string): boolean {
  // path.join descarta la barra inicial de href al unir segmentos relativos.
  const pageFile = path.join(APP_EMPRESA_DIR, href, "page.tsx")
  return fs.existsSync(pageFile)
}

test("el directorio de rutas del dashboard existe (sanity del resolver)", () => {
  assert.ok(
    fs.existsSync(path.join(APP_EMPRESA_DIR, "dashboard", "page.tsx")),
    `No encuentro el dashboard en ${APP_EMPRESA_DIR}. ¿Se movió app/(empresa)?`,
  )
})

test("cada cta.href de un Topic apunta a una ruta real del dashboard", () => {
  for (const topic of TOPICS) {
    if (!topic.cta) continue
    assert.ok(
      dashboardRouteExists(topic.cta.href),
      `Topic "${topic.id}": cta.href "${topic.cta.href}" no tiene page.tsx real bajo app/(empresa).`,
    )
  }
})

test("cada ruta del mapa ROUTE_TOPIC (apertura contextual) existe y apunta a un Topic válido", () => {
  for (const [href, topicId] of Object.entries(ROUTE_TOPIC)) {
    assert.ok(
      dashboardRouteExists(href),
      `ROUTE_TOPIC: la ruta "${href}" no tiene page.tsx real bajo app/(empresa).`,
    )
    assert.ok(
      TOPIC_BY_ID[topicId],
      `ROUTE_TOPIC: la ruta "${href}" mapea a un topicId inexistente "${topicId}".`,
    )
  }
})

test("el resolver detectaría un href roto (negativo) — si no, no protege nada", () => {
  assert.equal(
    dashboardRouteExists("/dashboard/ruta-que-no-existe"),
    false,
    "El resolver dice que existe una ruta inventada: no detectaría hrefs rotos.",
  )
})

test("todo Topic declara una `fuente` no vacía y `relacionados` resolubles", () => {
  for (const topic of TOPICS) {
    assert.ok(
      typeof topic.fuente === "string" && topic.fuente.trim().length > 0,
      `Topic "${topic.id}" no declara su fuente (anti-alucinación).`,
    )
    for (const rel of topic.relacionados ?? []) {
      assert.ok(
        TOPIC_BY_ID[rel],
        `Topic "${topic.id}": el relacionado "${rel}" no existe en la KB.`,
      )
    }
  }
})
