// Возможности framer-motion (анимации, жесты, layout) — отдельным чанком: LazyMotion подгружает их
// после первого кадра, а в основном бандле остаются лёгкие компоненты m.*.
import { domMax } from 'framer-motion'

export default domMax
