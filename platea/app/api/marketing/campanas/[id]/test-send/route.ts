import { proxyToBackend } from '@/lib/backend-proxy'
import { NextRequest } from 'next/server'

export const POST = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  return proxyToBackend(req, `/api/marketing/campanas/${id}/test-send`)
}
