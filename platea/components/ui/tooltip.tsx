"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type TooltipRootContextValue = {
  enabled: boolean
  setOpen: (open: boolean) => void
}

const TooltipRootContext = React.createContext<TooltipRootContextValue | null>(null)

function useCanHoverTooltip() {
  const [canHover, setCanHover] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return
    }

    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)")
    const update = () => setCanHover(mediaQuery.matches)

    update()
    mediaQuery.addEventListener("change", update)

    return () => {
      mediaQuery.removeEventListener("change", update)
    }
  }, [])

  return canHover
}

function TooltipProvider({
  delayDuration = 120,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      disableHoverableContent
      {...props}
    />
  )
}

function Tooltip({
  disabled = false,
  open: openProp,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root> & {
  disabled?: boolean
}) {
  const canHover = useCanHoverTooltip()
  const enabled = !disabled && canHover
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false)
  const open = openProp ?? uncontrolledOpen

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (openProp === undefined) {
        setUncontrolledOpen(nextOpen)
      }

      onOpenChange?.(nextOpen)
    },
    [onOpenChange, openProp]
  )

  if (!enabled) {
    return (
      <TooltipRootContext.Provider value={{ enabled: false, setOpen }}>
        {children}
      </TooltipRootContext.Provider>
    )
  }

  return (
    <TooltipRootContext.Provider value={{ enabled: true, setOpen }}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={setOpen}
        disableHoverableContent
        {...props}
      >
        {children}
      </TooltipPrimitive.Root>
    </TooltipRootContext.Provider>
  )
}

const TooltipTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof TooltipPrimitive.Trigger>
>(({ onClickCapture, onKeyDownCapture, asChild, children, ...props }, ref) => {
  const context = React.useContext(TooltipRootContext)
  const enabled = context?.enabled ?? true

  const handleClickCapture = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClickCapture?.(event)
    if (!event.defaultPrevented) {
      context?.setOpen(false)
    }
  }

  const handleKeyDownCapture = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    onKeyDownCapture?.(event)
    if (!event.defaultPrevented && (event.key === "Enter" || event.key === " ")) {
      context?.setOpen(false)
    }
  }

  if (!enabled) {
    if (asChild) {
      return <>{children}</>
    }

    return (
      <button
        ref={ref}
        data-slot="tooltip-trigger"
        onClickCapture={handleClickCapture}
        onKeyDownCapture={handleKeyDownCapture}
        {...props}
      >
        {children}
      </button>
    )
  }

  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      data-slot="tooltip-trigger"
      asChild={asChild}
      onClickCapture={handleClickCapture}
      onKeyDownCapture={handleKeyDownCapture}
      {...props}
    >
      {children}
    </TooltipPrimitive.Trigger>
  )
})
TooltipTrigger.displayName = "TooltipTrigger"

function TooltipPortal({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Portal>) {
  const context = React.useContext(TooltipRootContext)

  if (context && !context.enabled) {
    return null
  }

  return <TooltipPrimitive.Portal data-slot="tooltip-portal" {...props} />
}

const TooltipContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 8, ...props }, ref) => {
  const context = React.useContext(TooltipRootContext)

  if (context && !context.enabled) {
    return null
  }

  return (
    <TooltipPortal>
      <TooltipPrimitive.Content
        ref={ref}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-64 origin-(--radix-tooltip-content-transform-origin) overflow-hidden rounded-lg bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </TooltipPortal>
  )
})
TooltipContent.displayName = "TooltipContent"

export {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
  useCanHoverTooltip,
}
