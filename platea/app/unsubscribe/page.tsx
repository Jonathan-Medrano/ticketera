import Link from 'next/link'
import { MailX, MailCheck, Mail } from 'lucide-react'

type Props = {
  searchParams: Promise<{ ok?: string; error?: string; token?: string }>
}

export default async function UnsubscribePage({ searchParams }: Props) {
  const params = await searchParams
  const isOk = params.ok === '1'
  const isError = params.error === '1'
  const token = params.token

  if (isOk) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-md">
          <div className="flex justify-center mb-4">
            <MailCheck className="h-14 w-14 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Dado de baja exitosamente</h1>
          <p className="text-muted-foreground mb-6">
            Te diste de baja exitosamente del marketing por email. Ya no recibirás más emails de este tipo.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-md">
          <div className="flex justify-center mb-4">
            <MailX className="h-14 w-14 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Error al procesar la solicitud</h1>
          <p className="text-muted-foreground mb-6">
            Ocurrió un error al procesar tu solicitud. Si el problema persiste, podés contactar soporte.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    )
  }

  if (token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-md">
          <div className="flex justify-center mb-4">
            <Mail className="h-14 w-14 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Confirmar baja de email marketing</h1>
          <p className="text-muted-foreground mb-6">
            ¿Querés dejar de recibir emails de marketing de esta empresa? Esto no afecta los emails de tus
            compras (entradas, confirmaciones).
          </p>
          <form action="/api/marketing/unsubscribe" method="POST">
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Confirmar baja
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center max-w-md">
        <div className="flex justify-center mb-4">
          <Mail className="h-14 w-14 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Darse de baja</h1>
        <p className="text-muted-foreground mb-6">
          Para darte de baja del marketing por email, usá el enlace de baja incluido en el email que recibiste.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  )
}
