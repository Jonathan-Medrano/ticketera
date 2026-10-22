import assert from "node:assert/strict"
import test from "node:test"
import {
  buildTenantSupportResponseMap,
  resolvePublicTenantSupportFaqCollection,
  resolveTenantSupportFaqCollection,
} from "@/lib/tenant-support"

test("resolveTenantSupportFaqCollection keeps legacy and canonical FAQ entries", () => {
  const faqs = resolveTenantSupportFaqCollection([
    { pregunta: "¿Horario?", respuesta: "20 hs" },
    { question: "¿Hay reingreso?", answer: "No", hidden: true },
    { id: "faq-3", question: "Dress code", answer: "Libre", hidden: false },
  ])

  assert.deepEqual(faqs, [
    { id: "faq-1", question: "¿Horario?", answer: "20 hs", hidden: false },
    { id: "faq-2", question: "¿Hay reingreso?", answer: "No", hidden: true },
    { id: "faq-3", question: "Dress code", answer: "Libre", hidden: false },
  ])
})

test("public tenant FAQ helpers omit hidden entries", () => {
  const source = JSON.stringify([
    { question: "Visible", answer: "Sí", hidden: false },
    { question: "Oculta", answer: "No sale", hidden: true },
    { pregunta: "Legacy visible", respuesta: "Compat ok" },
  ])

  assert.deepEqual(resolvePublicTenantSupportFaqCollection(source), [
    { id: "faq-1", question: "Visible", answer: "Sí", hidden: false },
    { id: "faq-3", question: "Legacy visible", answer: "Compat ok", hidden: false },
  ])

  assert.deepEqual(buildTenantSupportResponseMap(source), {
    Visible: "Sí",
    "Legacy visible": "Compat ok",
  })
})
