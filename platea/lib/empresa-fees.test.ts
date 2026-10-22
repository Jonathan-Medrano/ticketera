import assert from "node:assert/strict"
import test from "node:test"

import {
  buildEmptyMarketplaceFeeByFlow,
  formatEmpresaFeeFlowLabel,
  normalizeEmpresaMarketplaceFeeByFlow,
} from "./empresa-fees"

test("normalizeEmpresaMarketplaceFeeByFlow prefers explicit plural maps and keeps each flow isolated", () => {
  const normalized = normalizeEmpresaMarketplaceFeeByFlow({
    marketplaceFeeByFlow: {
      entradas: {
        flow: "entradas",
        configured: true,
        source: "empresa",
        legacyFallback: null,
        mode: "fixed",
        percentage: null,
        fixedAmount: 45,
      },
      consumibles: {
        flow: "consumibles",
        configured: false,
        source: null,
        legacyFallback: null,
        mode: null,
        percentage: null,
        fixedAmount: null,
      },
    },
    marketplace_fee: {
      flow: "entradas",
      configured: true,
      source: "global",
      legacyFallback: "env_legacy",
      mode: "percentage",
      percentage: 12.5,
      fixedAmount: null,
    },
  })

  assert.equal(normalized.entradas.fixedAmount, 45)
  assert.equal(normalized.entradas.source, "empresa")
  assert.equal(normalized.consumibles.configured, false)
  assert.equal(normalized.consumibles.flow, "consumibles")
})

test("normalizeEmpresaMarketplaceFeeByFlow falls back from singular only for entradas", () => {
  const normalized = normalizeEmpresaMarketplaceFeeByFlow({
    marketplace_fee: {
      flow: "entradas",
      configured: true,
      source: "global",
      legacyFallback: "env_legacy",
      mode: "percentage",
      percentage: 12.5,
      fixedAmount: null,
    },
  })

  assert.deepEqual(normalized.entradas, {
    flow: "entradas",
    configured: true,
    source: "global",
    legacyFallback: "env_legacy",
    mode: "percentage",
    percentage: 12.5,
    fixedAmount: null,
  })
  assert.deepEqual(normalized.consumibles, {
    flow: "consumibles",
    configured: false,
    source: null,
    legacyFallback: null,
    mode: null,
    percentage: null,
    fixedAmount: null,
  })
})

test("empresa fee helpers expose stable flow labels and empty defaults", () => {
  assert.equal(formatEmpresaFeeFlowLabel("entradas"), "Entradas")
  assert.equal(formatEmpresaFeeFlowLabel("consumibles"), "Consumibles")

  const empty = buildEmptyMarketplaceFeeByFlow()
  assert.equal(empty.entradas.flow, "entradas")
  assert.equal(empty.entradas.configured, false)
  assert.equal(empty.consumibles.flow, "consumibles")
  assert.equal(empty.consumibles.configured, false)
})
