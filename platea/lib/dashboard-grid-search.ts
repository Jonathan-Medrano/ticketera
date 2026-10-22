export function writeDashboardSearchParam(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined
) {
  if (value == null || value.trim() === "") {
    params.delete(key)
    return
  }

  params.set(key, value)
}
