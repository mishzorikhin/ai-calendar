import { motion, type HTMLMotionProps } from 'framer-motion'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { spring } from '../lib/motion'
import { ForkLogo } from './Icons'
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

/** Изображение с художественной заглушкой: если фото не загрузится, остаётся градиент. */
export function SmartImage({
  src,
  art,
  className,
  style,
  children,
}: {
  src: string
  art: string
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  return (
    <div className={`${styles.smartImage} ${className ?? ''}`} style={{ background: art, ...style }}>
      <div className={styles.bokeh} aria-hidden="true" />
      {state !== 'error' && (
        <motion.img
          src={src}
          alt=""
          draggable={false}
          initial={false}
          animate={{ opacity: state === 'ok' ? 1 : 0 }}
          transition={{ duration: 0.5 }}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      )}
      {children}
    </div>
  )
}

export function Avatar({
  src,
  initials,
  color = '#dfe2f7',
  size = 32,
  ring = true,
}: {
  src?: string
  initials: string
  color?: string
  size?: number
  ring?: boolean
}) {
  const [failed, setFailed] = useState(false)
  return (
    <span
      className={`${styles.avatar} ${ring ? styles.avatarRing : ''}`}
      style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}
    >
      <span>{initials}</span>
      {src && !failed && <img src={src} alt="" draggable={false} onError={() => setFailed(true)} />}
    </span>
  )
}

export function RestaurantLogo({ size = 32 }: { size?: number }) {
  return (
    <span className={`${styles.avatar} ${styles.avatarRing} ${styles.logo}`} style={{ width: size, height: size }}>
      <ForkLogo size={size * 0.62} />
    </span>
  )
}

/** Точка «это вы» — синяя с белым ободком. */
export function MeDot({ size = 32 }: { size?: number }) {
  return (
    <span className={`${styles.avatar} ${styles.avatarRing} ${styles.meDot}`} style={{ width: size, height: size }}>
      <motion.i animate={{ scale: [1, 1.18, 1] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} />
    </span>
  )
}

export function Stack({ children, overlap = 10 }: { children: ReactNode; overlap?: number }) {
  return (
    <span className={styles.stack} style={{ ['--overlap' as string]: `-${overlap}px` }}>
      {children}
    </span>
  )
}

/** Мерцающий текст статуса («Планирую…»). */
export function Shimmer({ children }: { children: ReactNode }) {
  return <span className={styles.shimmer}>{children}</span>
}

export function Dots() {
  return (
    <span className={styles.dots} aria-label="Загрузка">
      {[0, 1, 2].map((i) => (
        <motion.i
          key={i}
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.16 }}
        />
      ))}
    </span>
  )
}

/** Анимированная звуковая волна. */
export function Waveform({
  bars = 18,
  color = 'currentColor',
  height = 22,
}: {
  bars?: number
  color?: string
  height?: number
}) {
  return (
    <span className={styles.wave} style={{ height }}>
      {Array.from({ length: bars }, (_, i) => (
        <motion.i
          key={i}
          style={{ background: color }}
          animate={{ scaleY: [0.25, 0.5 + ((i * 37) % 50) / 100, 0.3, 0.9 - ((i * 23) % 40) / 100, 0.25] }}
          transition={{ duration: 1.1 + (i % 4) * 0.12, repeat: Infinity, ease: 'easeInOut', delay: i * 0.05 }}
        />
      ))}
    </span>
  )
}
