"use client"

import { motion, useReducedMotion, type Variants } from "framer-motion"
import type { ReactNode } from "react"

type Direction = "up" | "down" | "left" | "right" | "scale" | "none"

type RevealProps = {
  children: ReactNode
  direction?: Direction
  delay?: number
  duration?: number
  className?: string
  once?: boolean
  amount?: number
}

const offsetFor = (direction: Direction) => {
  switch (direction) {
    case "up":
      return { y: 28 }
    case "down":
      return { y: -28 }
    case "left":
      return { x: -28 }
    case "right":
      return { x: 28 }
    case "scale":
      return { scale: 0.96 }
    case "none":
    default:
      return {}
  }
}

const luxuryEase = [0.22, 1, 0.36, 1] as const

export function RevealOnScroll({
  children,
  direction = "up",
  delay = 0,
  duration = 0.7,
  className,
  once = true,
  amount = 0.2,
}: RevealProps) {
  const reduce = useReducedMotion()

  if (reduce) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, ...offsetFor(direction) }}
      whileInView={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      viewport={{ once, amount }}
      transition={{ duration, delay, ease: luxuryEase }}
    >
      {children}
    </motion.div>
  )
}

type StaggerGroupProps = {
  children: ReactNode
  className?: string
  staggerDelay?: number
  initialDelay?: number
  once?: boolean
  amount?: number
  as?: "div" | "ul" | "ol" | "section"
}

const groupVariants = (staggerDelay: number, initialDelay: number): Variants => ({
  hidden: {},
  visible: {
    transition: {
      staggerChildren: staggerDelay,
      delayChildren: initialDelay,
    },
  },
})

export function StaggerGroup({
  children,
  className,
  staggerDelay = 0.08,
  initialDelay = 0,
  once = true,
  amount = 0.2,
  as = "div",
}: StaggerGroupProps) {
  const reduce = useReducedMotion()
  const Tag = motion[as] as typeof motion.div

  if (reduce) {
    const StaticTag = as as "div"
    return <StaticTag className={className}>{children}</StaticTag>
  }

  return (
    <Tag
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, amount }}
      variants={groupVariants(staggerDelay, initialDelay)}
    >
      {children}
    </Tag>
  )
}

type StaggerItemProps = {
  children: ReactNode
  className?: string
  direction?: Direction
  duration?: number
  as?: "div" | "li" | "article" | "section"
}

const itemVariants = (direction: Direction, duration: number): Variants => ({
  hidden: { opacity: 0, ...offsetFor(direction) },
  visible: {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    transition: { duration, ease: luxuryEase },
  },
})

export function StaggerItem({
  children,
  className,
  direction = "up",
  duration = 0.55,
  as = "div",
}: StaggerItemProps) {
  const reduce = useReducedMotion()
  const Tag = motion[as] as typeof motion.div

  if (reduce) {
    const StaticTag = as as "div"
    return <StaticTag className={className}>{children}</StaticTag>
  }

  return (
    <Tag className={className} variants={itemVariants(direction, duration)}>
      {children}
    </Tag>
  )
}
