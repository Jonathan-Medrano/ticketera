import { fetchBackendFromServer } from "@/lib/server-backend"
import MensajesSection, { type PlatformMessage } from "@/components/super-admin/mensajes-section"

type MessagesPayload = {
  data: { messages: PlatformMessage[] }
}

export default async function MensajesPage() {
  let initialMessages: PlatformMessage[] | undefined
  try {
    const payload = await fetchBackendFromServer<MessagesPayload>("/api/platform/mensajes")
    initialMessages = payload.data.messages
  } catch {
    // Fall back to client-side fetch inside the component
  }
  return <MensajesSection initialMessages={initialMessages} />
}
