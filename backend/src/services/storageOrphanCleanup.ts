import { prisma } from '../lib/prisma'
import {
  SUPABASE_STORAGE_BUCKET,
  buildSupabaseUrlRegex,
  extractPathFromPublicUrl,
  getSupabaseServerClient,
} from '../lib/supabase-storage'
import { logServerError } from '../lib/safe-log'

const DEFAULT_COOLDOWN_HOURS = 24
const DEFAULT_BATCH_SIZE = 100
const LIST_PAGE_SIZE = 1000
const SAMPLE_PATHS_CAP = 200
const SAMPLE_PATHS_STORED_CAP = 50 // cap más bajo en DB para no inflar la tabla

export type StorageOrphanCleanupOptions = {
  dryRun?: boolean
  cooldownHours?: number
  triggeredBy?: 'cron' | 'manual'
  triggeredByUserId?: string | null
  triggeredByUserName?: string | null
}

export type OrphanFileInfo = {
  path: string
  createdAt: string | null
  sizeBytes: number | null
}

export type StorageOrphanCleanupResult = {
  status: 'ok' | 'skipped'
  reason?: string
  scanned: number
  inUse: number
  withinCooldown: number
  orphans: number
  deleted: number
  failed: number
  dryRun: boolean
  orphanSample: OrphanFileInfo[]
  runId: number | null
}

type StorageFile = {
  path: string
  createdAt: Date | null
  sizeBytes: number | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listAllStorageFiles(client: any, bucket: string): Promise<StorageFile[]> {
  const out: StorageFile[] = []
  const queue: string[] = ['']

  while (queue.length > 0) {
    const folder = queue.shift()!
    let offset = 0

    while (true) {
      const { data, error } = await client.storage.from(bucket).list(folder || undefined, {
        limit: LIST_PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })

      if (error) throw error
      if (!data || data.length === 0) break

      for (const item of data) {
        const fullPath = folder ? `${folder}/${item.name}` : item.name
        if (item.id) {
          const sizeBytes =
            item.metadata && typeof item.metadata.size === 'number' ? item.metadata.size : null
          out.push({
            path: fullPath,
            createdAt: item.created_at ? new Date(item.created_at) : null,
            sizeBytes,
          })
        } else {
          queue.push(fullPath)
        }
      }

      if (data.length < LIST_PAGE_SIZE) break
      offset += LIST_PAGE_SIZE
    }
  }

  return out
}

async function collectUsedStoragePaths(bucket: string): Promise<Set<string>> {
  const used = new Set<string>()
  const urlRegex = buildSupabaseUrlRegex(bucket)

  function ingestString(value: unknown) {
    if (typeof value !== 'string' || !value) return
    const matches = value.match(urlRegex)
    if (!matches) return
    for (const url of matches) {
      const path = extractPathFromPublicUrl(url, bucket)
      if (path) used.add(path)
    }
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ imagen_url: string }>>`
      SELECT imagen_url FROM eventos WHERE imagen_url IS NOT NULL AND imagen_url <> ''
    `
    for (const row of rows) ingestString(row.imagen_url)
  } catch (err) {
    logServerError('storage cleanup: scan eventos.imagen_url')
    throw err
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ imagen_url: string }>>`
      SELECT imagen_url FROM evento_tandas WHERE imagen_url IS NOT NULL AND imagen_url <> ''
    `
    for (const row of rows) ingestString(row.imagen_url)
  } catch (err) {
    logServerError('storage cleanup: scan evento_tandas.imagen_url')
    throw err
  }

  try {
    // entrada_categorias también tiene imagen_url propia (se puebla desde el wizard de
    // crear/editar evento — ver syncCategorias en routes/eventos.ts). Si no se escanea acá,
    // el cron real (no dry-run) borra del bucket imágenes de categoría que SÍ están en uso.
    const rows = await prisma.$queryRaw<Array<{ imagen_url: string }>>`
      SELECT imagen_url FROM entrada_categorias WHERE imagen_url IS NOT NULL AND imagen_url <> ''
    `
    for (const row of rows) ingestString(row.imagen_url)
  } catch (err) {
    logServerError('storage cleanup: scan entrada_categorias.imagen_url')
    throw err
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ imagen_url: string }>>`
      SELECT imagen_url FROM consumibles WHERE imagen_url IS NOT NULL AND imagen_url <> ''
    `
    for (const row of rows) ingestString(row.imagen_url)
  } catch (err) {
    logServerError('storage cleanup: scan consumibles.imagen_url')
    throw err
  }

  try {
    // marketing_campanas.contenido_html guarda el contenido del email; las campañas
    // nuevas usan JSON estructurado con la imagen subida a Supabase embebida en
    // imagen_url. Hay que escanearlo o el cleanup borraría esas imágenes como huérfanas.
    const rows = await prisma.$queryRaw<Array<{ contenido_html: string | null }>>`
      SELECT contenido_html FROM marketing_campanas WHERE contenido_html IS NOT NULL AND contenido_html <> ''
    `
    for (const row of rows) ingestString(row.contenido_html)
  } catch (err) {
    logServerError('storage cleanup: scan marketing_campanas.contenido_html')
    throw err
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ home_sections: string | null; info_pages: string | null }>>`
      SELECT home_sections, info_pages FROM empresas
    `
    for (const row of rows) {
      ingestString(row.home_sections)
      ingestString(row.info_pages)
    }
  } catch (err) {
    logServerError('storage cleanup: scan empresas json')
    throw err
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ logo_url: string }>>`
      SELECT logo_url FROM empresas WHERE logo_url IS NOT NULL AND logo_url <> ''
    `
    for (const row of rows) ingestString(row.logo_url)
  } catch (err) {
    logServerError('storage cleanup: scan empresas.logo_url')
    throw err
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ banners: string | null }>>`
      SELECT banners FROM empresas WHERE banners IS NOT NULL
    `
    for (const row of rows) ingestString(row.banners)
  } catch (err) {
    logServerError('storage cleanup: scan empresas.banners')
    throw err
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ galeria_fotos: string | null }>>`
      SELECT galeria_fotos FROM empresas WHERE galeria_fotos IS NOT NULL
    `
    for (const row of rows) ingestString(row.galeria_fotos)
  } catch (err) {
    logServerError('storage cleanup: scan empresas.galeria_fotos')
    throw err
  }

  return used
}

async function insertRunRecord(input: {
  startedAt: Date
  finishedAt: Date
  scanned: number
  inUse: number
  withinCooldown: number
  orphans: number
  deleted: number
  failed: number
  cooldownHours: number
  dryRun: boolean
  triggeredBy: 'cron' | 'manual'
  triggeredByUserId: string | null
  triggeredByUserName: string | null
  status: 'ok' | 'skipped' | 'failed'
  reason: string | null
  samplePaths: string[]
}): Promise<number | null> {
  try {
    const samplePathsJson = JSON.stringify(input.samplePaths.slice(0, SAMPLE_PATHS_STORED_CAP))
    const durationMs = input.finishedAt.getTime() - input.startedAt.getTime()
    const dryRunBool = Boolean(input.dryRun)
    await prisma.$executeRaw`
      INSERT INTO storage_cleanup_runs
        (started_at, finished_at, duration_ms, scanned, in_use, within_cooldown, orphans, deleted, failed,
         cooldown_hours, dry_run, triggered_by, triggered_by_user_id, triggered_by_user_name, status, reason, sample_paths)
      VALUES (
        ${input.startedAt},
        ${input.finishedAt},
        ${durationMs},
        ${input.scanned},
        ${input.inUse},
        ${input.withinCooldown},
        ${input.orphans},
        ${input.deleted},
        ${input.failed},
        ${input.cooldownHours},
        ${dryRunBool},
        ${input.triggeredBy},
        ${input.triggeredByUserId},
        ${input.triggeredByUserName},
        ${input.status},
        ${input.reason},
        ${samplePathsJson}
      )
    `
    // Postgres does not return insertId via $executeRaw; fetch the last inserted id
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM storage_cleanup_runs ORDER BY id DESC LIMIT 1
    `
    return rows[0]?.id ?? null
  } catch {
    logServerError('storage cleanup: insert run record')
    return null
  }
}

export async function runStorageOrphanCleanup(
  options: StorageOrphanCleanupOptions = {},
): Promise<StorageOrphanCleanupResult> {
  const dryRun = options.dryRun ?? false
  const cooldownHours = options.cooldownHours ?? DEFAULT_COOLDOWN_HOURS
  const cooldownMs = cooldownHours * 60 * 60 * 1000
  const triggeredBy = options.triggeredBy ?? 'cron'
  const triggeredByUserId = options.triggeredByUserId ?? null
  const triggeredByUserName = options.triggeredByUserName ?? null

  const startedAt = new Date()

  const client = getSupabaseServerClient()
  if (!client) {
    const finishedAt = new Date()
    const runId = await insertRunRecord({
      startedAt,
      finishedAt,
      scanned: 0,
      inUse: 0,
      withinCooldown: 0,
      orphans: 0,
      deleted: 0,
      failed: 0,
      cooldownHours,
      dryRun,
      triggeredBy,
      triggeredByUserId,
      triggeredByUserName,
      status: 'skipped',
      reason: 'supabase_not_configured',
      samplePaths: [],
    })
    return {
      status: 'skipped',
      reason: 'supabase_not_configured',
      scanned: 0,
      inUse: 0,
      withinCooldown: 0,
      orphans: 0,
      deleted: 0,
      failed: 0,
      dryRun,
      orphanSample: [],
      runId,
    }
  }

  const cooldownThreshold = new Date(startedAt.getTime() - cooldownMs)

  const [files, usedPaths] = await Promise.all([
    listAllStorageFiles(client, SUPABASE_STORAGE_BUCKET),
    collectUsedStoragePaths(SUPABASE_STORAGE_BUCKET),
  ])

  let inUse = 0
  let withinCooldown = 0
  const orphanFiles: StorageFile[] = []

  for (const file of files) {
    if (usedPaths.has(file.path)) {
      inUse++
      continue
    }
    if (file.createdAt && file.createdAt > cooldownThreshold) {
      withinCooldown++
      continue
    }
    orphanFiles.push(file)
  }

  let deleted = 0
  let failed = 0

  if (!dryRun && orphanFiles.length > 0) {
    const orphanPaths = orphanFiles.map((f) => f.path)
    for (let i = 0; i < orphanPaths.length; i += DEFAULT_BATCH_SIZE) {
      const batch = orphanPaths.slice(i, i + DEFAULT_BATCH_SIZE)
      try {
        const { error } = await client.storage.from(SUPABASE_STORAGE_BUCKET).remove(batch)
        if (error) {
          failed += batch.length
          logServerError('storage cleanup: batch delete failed')
        } else {
          deleted += batch.length
        }
      } catch {
        failed += batch.length
        logServerError('storage cleanup: batch delete threw')
      }
    }
  }

  // Top N huérfanos para devolver al UI (más viejos primero — los más sospechosos)
  const sortedOrphans = orphanFiles.slice().sort((a, b) => {
    const aTs = a.createdAt?.getTime() ?? 0
    const bTs = b.createdAt?.getTime() ?? 0
    return aTs - bTs
  })

  const orphanSample: OrphanFileInfo[] = sortedOrphans.slice(0, SAMPLE_PATHS_CAP).map((f) => ({
    path: f.path,
    createdAt: f.createdAt ? f.createdAt.toISOString() : null,
    sizeBytes: f.sizeBytes,
  }))

  const finishedAt = new Date()

  const runId = await insertRunRecord({
    startedAt,
    finishedAt,
    scanned: files.length,
    inUse,
    withinCooldown,
    orphans: orphanFiles.length,
    deleted,
    failed,
    cooldownHours,
    dryRun,
    triggeredBy,
    triggeredByUserId,
    triggeredByUserName,
    status: 'ok',
    reason: null,
    samplePaths: orphanSample.map((o) => o.path),
  })

  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'storage_orphan_cleanup',
      bucket: SUPABASE_STORAGE_BUCKET,
      scanned: files.length,
      inUse,
      withinCooldown,
      orphans: orphanFiles.length,
      deleted,
      failed,
      dryRun,
      triggeredBy,
      runId,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    }),
  )

  return {
    status: 'ok',
    scanned: files.length,
    inUse,
    withinCooldown,
    orphans: orphanFiles.length,
    deleted,
    failed,
    dryRun,
    orphanSample,
    runId,
  }
}

export type StorageCleanupHistoryRow = {
  id: number
  started_at: string
  finished_at: string
  duration_ms: number
  scanned: number
  in_use: number
  within_cooldown: number
  orphans: number
  deleted: number
  failed: number
  cooldown_hours: number
  dry_run: boolean
  triggered_by: 'cron' | 'manual'
  triggered_by_user_id: string | null
  triggered_by_user_name: string | null
  status: string
  reason: string | null
}

export async function getStorageCleanupHistory(limit = 50): Promise<StorageCleanupHistoryRow[]> {
  const cap = Math.min(Math.max(1, limit), 200)
  const rows = await prisma.$queryRaw<StorageCleanupHistoryRow[]>`
    SELECT id, started_at, finished_at, duration_ms, scanned, in_use, within_cooldown,
           orphans, deleted, failed, cooldown_hours, dry_run, triggered_by,
           triggered_by_user_id, triggered_by_user_name, status, reason
    FROM storage_cleanup_runs
    ORDER BY started_at DESC
    LIMIT ${cap}
  `
  return rows
}
