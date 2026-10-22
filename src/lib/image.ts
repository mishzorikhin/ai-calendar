/** Картинка для чата: не больше 1600 px по длинной стороне и 1,5 МБ (как принимает сервер). */
export const IMAGE_MAX_SIDE = 1600
export const IMAGE_MAX_BYTES = 1536 * 1024

/** Размер после уменьшения: длинная сторона не больше max, пропорции сохраняются. */
export function fitSize(width: number, height: number, max = IMAGE_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Сколько байт в data URL (base64 без префикса). */
export function dataUrlBytes(url: string): number {
  const b64 = url.slice(url.indexOf(',') + 1)
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - pad
}

/**
 * Сжимает фото или скриншот в JPEG: уменьшает до IMAGE_MAX_SIDE и снижает качество, пока не влезет
 * в IMAGE_MAX_BYTES (если не влезло и так — ещё уменьшает). Только в браузере.
 */
export async function compressImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    let side = IMAGE_MAX_SIDE
    for (let attempt = 0; attempt < 4; attempt++) {
      const { width, height } = fitSize(bitmap.width, bitmap.height, side)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Не получилось обработать картинку')
      // Прозрачный PNG в JPEG — на белом, а не на чёрном.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(bitmap, 0, 0, width, height)
      for (const quality of [0.85, 0.72, 0.6]) {
        const url = canvas.toDataURL('image/jpeg', quality)
        if (dataUrlBytes(url) <= IMAGE_MAX_BYTES) return url
      }
      side = Math.round(side * 0.7)
    }
    throw new Error('Картинка слишком большая')
  } finally {
    bitmap.close()
  }
}
