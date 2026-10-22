"use client"

import { Component, ReactNode, ErrorInfo } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { reportClientError } from "@/lib/client-error-logger"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export default class DashboardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError({
      message: error.message,
      stack: error.stack ?? null,
      severity: "error",
      context: {
        kind: "react-error-boundary",
        boundary: "DashboardErrorBoundary",
        componentStack: info.componentStack?.slice(0, 1500) ?? null,
      },
    })
  }

  reset = () => this.setState({ hasError: false, message: "" })

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <div className="h-14 w-14 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
          <AlertTriangle className="h-7 w-7 text-destructive" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Algo salió mal</h2>
        <p className="text-muted-foreground text-sm max-w-sm mb-6">
          Ocurrió un error inesperado en esta sección. Podés intentar recargar o volver al dashboard.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={this.reset}>
            Reintentar
          </Button>
          <Button onClick={() => (window.location.href = "/dashboard")}>
            Ir al dashboard
          </Button>
        </div>
      </div>
    )
  }
}
