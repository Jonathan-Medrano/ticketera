"use client"

import { useEffect, useRef, useState } from "react"

import { useDebounce } from "@/lib/use-debounce"

export const DASHBOARD_SEARCH_DEBOUNCE_MS = 1500

export function createDashboardDebouncedSearchController(initialUrlValue = "", delay = DASHBOARD_SEARCH_DEBOUNCE_MS) {
  let urlValue = initialUrlValue
  let value = initialUrlValue
  let pendingValue = initialUrlValue
  let dueAt: number | null = null

  return {
    get value() {
      return value
    },
    input(next: string, now: number) {
      value = next
      pendingValue = next
      dueAt = now + delay
    },
    syncUrl(next: string) {
      urlValue = next
      value = next
      pendingValue = next
      dueAt = null
    },
    advance(now: number) {
      if (dueAt == null || now < dueAt) return [] as string[]

      dueAt = null

      if (pendingValue === urlValue) return [] as string[]

      return [pendingValue]
    },
  }
}

export function useDashboardDebouncedSearch({
  urlValue,
  emit,
  delay = DASHBOARD_SEARCH_DEBOUNCE_MS,
}: {
  urlValue: string
  emit: (next: string) => void
  delay?: number
}) {
  const [value, setValue] = useState(urlValue)
  const debouncedValue = useDebounce(value, delay)
  const emitRef = useRef(emit)

  useEffect(() => {
    emitRef.current = emit
  }, [emit])

  useEffect(() => {
    setValue(urlValue)
  }, [urlValue])

  useEffect(() => {
    if (debouncedValue === urlValue) return
    emitRef.current(debouncedValue)
  }, [debouncedValue, urlValue])

  return { value, setValue }
}
