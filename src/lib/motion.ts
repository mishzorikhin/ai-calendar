import type { Transition, Variants } from 'framer-motion'

export const ease = [0.22, 1, 0.36, 1] as const

export const spring: Transition = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }
export const softSpring: Transition = { type: 'spring', stiffness: 240, damping: 30, mass: 1 }
export const bouncy: Transition = { type: 'spring', stiffness: 520, damping: 26 }

/** Переход между экранами: вперёд — «погружение», назад — «всплытие». */
export const screenVariants: Variants = {
  enter: (dir: number) => ({
    opacity: 0,
    scale: dir > 0 ? 0.94 : 1.04,
    y: dir > 0 ? 28 : -10,
    zIndex: 2,
  }),
  center: {
    opacity: 1,
    scale: 1,
    y: 0,
    zIndex: 2,
    transition: { ...softSpring, staggerChildren: 0.045, delayChildren: 0.06 },
  },
  exit: (dir: number) => ({
    opacity: 0,
    scale: dir > 0 ? 1.03 : 0.95,
    y: dir > 0 ? -8 : 24,
    zIndex: 1,
    transition: { duration: 0.28, ease },
  }),
}

/** Элемент экрана, появляющийся каскадом вслед за родителем. */
export const itemVariants: Variants = {
  enter: { opacity: 0, y: 22 },
  center: { opacity: 1, y: 0, transition: softSpring },
  exit: {},
}

export const fadeVariants: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: 0.35, ease } },
  exit: {},
}
