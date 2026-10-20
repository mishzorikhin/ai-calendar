import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { spring } from '../lib/motion'
import styles from './ui.module.css'

type PressableProps = HTMLMotionProps<'button'> & { scale?: number }

/** Кнопка с мягким «нажатием», как на iOS. */
export function Pressable({ scale = 0.94, className, type = 'button', ...rest }: PressableProps) {
  return (
    <motion.button
      type={type}
      whileTap={{ scale }}
      transition={spring}
      className={className ? `${styles.pressable} ${className}` : styles.pressable}
      {...rest}
    />
  )
}

type CircleProps = PressableProps & { tone?: 'white' | 'glass' | 'gray' | 'dark' | 'pink'; size?: number }

export function CircleButton({ tone = 'white', size = 44, className, style, ...rest }: CircleProps) {
  return (
    <Pressable
      className={`${styles.circle} ${styles[`tone_${tone}`]} ${className ?? ''}`}
      style={{ width: size, height: size, ...style }}
      {...rest}
    />
  )
}

type PillProps = PressableProps & { tone?: 'white' | 'glass' | 'dark' | 'ghost'; small?: boolean }

export function Pill({ tone = 'white', small, className, ...rest }: PillProps) {
  return (
    <Pressable
      scale={0.95}
      className={`${styles.pill} ${styles[`pill_${tone}`]} ${small ? styles.pillSmall : ''} ${className ?? ''}`}
      {...rest}
    />
  )
}

type AvatarProps = {
  src?: string
  initials: string
  color?: string
  size?: number
  ring?: boolean
  label?: string
}

export function Avatar(props: AvatarProps) {
  return <AvatarInner key={props.src ?? 'none'} {...props} />
}

function AvatarInner({ src, initials, color = 'var(--lavender)', size = 32, ring = true, label }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  return (
    <span
      className={`${styles.avatar} ${ring ? styles.avatarRing : ''}`}
      style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span>{initials}</span>
      {src && !failed && <img src={src} alt="" draggable={false} onError={() => setFailed(true)} />}
    </span>
  )
}

/** Точка «это вы» — синяя с белым ободком. */
export function MeDot({ size = 32 }: { size?: number }) {
  const still = useReducedMotion()
  return (
    <span className={`${styles.avatar} ${styles.avatarRing} ${styles.meDot}`} style={{ width: size, height: size }}>
      <motion.i
        animate={still ? undefined : { scale: [1, 1.18, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      />
    </span>
  )
}

export function Stack({ children, overlap = 10 }: { children: ReactNode; overlap?: number }) {
  const style: CSSProperties & Record<'--overlap', string> = { '--overlap': `-${overlap}px` }
  return (
    <span className={styles.stack} style={style}>
      {children}
    </span>
  )
}

/** Мерцающий текст статуса («Планирую…»). */
export function Shimmer({ children }: { children: ReactNode }) {
  return <span className={styles.shimmer}>{children}</span>
}

export function Dots() {
  const still = useReducedMotion()
  return (
    <span className={styles.dots} role="img" aria-label="Загрузка">
      {[0, 1, 2].map((i) => (
        <motion.i
          key={i}
          animate={still ? undefined : { opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.16 }}
        />
      ))}
    </span>
  )
}

/** Анимированная звуковая волна; при «уменьшении движения» — статичная. */
export function Waveform({
  bars = 18,
  color = 'currentColor',
  height = 22,
}: {
  bars?: number
  color?: string
  height?: number
}) {
  const still = useReducedMotion()
  return (
    <span className={styles.wave} style={{ height }} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <motion.i
          key={i}
          style={{ background: color, scaleY: 0.3 + ((i * 37) % 50) / 100 }}
          animate={
            still ? undefined : { scaleY: [0.25, 0.5 + ((i * 37) % 50) / 100, 0.3, 0.9 - ((i * 23) % 40) / 100, 0.25] }
          }
          transition={{ duration: 1.1 + (i % 4) * 0.12, repeat: Infinity, ease: 'easeInOut', delay: i * 0.05 }}
        />
      ))}
    </span>
  )
}
