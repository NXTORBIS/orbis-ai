// Builds the Orbis UI assets and app icons from the user's logo files.
// Env: DARK_BG_LOGO (ring + wordmark on black), MARK (standalone ring), ASSET_DIR, ICON_PATH, ICON_ALT_PATH, ICON_STYLE (white|black), PREVIEW_PATH
const { app, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

// Bitmaps are BGRA with premultiplied alpha, matching toBitmap()/createFromBitmap().
function load(file) {
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) throw new Error(`Could not decode ${file}`)
  const { width, height } = image.getSize()
  // Some decoders hand back an all-zero bitmap; retry through other representations.
  const attempts = [
    () => image.toBitmap(),
    () => nativeImage.createFromBuffer(image.toPNG()).toBitmap(),
    () => image.resize({ width, height, quality: 'best' }).toBitmap()
  ]
  for (const read of attempts) {
    const data = Buffer.from(read())
    let sum = 0
    for (let i = 0; i < data.length; i += 997) sum += data[i]
    if (data.length === width * height * 4 && sum > 0) return { width, height, data }
  }
  throw new Error(`Could not read pixels from ${file}`)
}

function cornerLevel(img, pick) {
  const values = []
  for (const [x, y] of [[2, 2], [img.width - 3, 2], [2, img.height - 3], [img.width - 3, img.height - 3]]) {
    const i = (y * img.width + x) * 4
    values.push(pick(img.data[i], img.data[i + 1], img.data[i + 2]))
  }
  return values.sort((a, b) => a - b)[1]
}

/** Glowing artwork on black: brightness becomes alpha, the colour is kept. */
function alphaFromBlack(img) {
  const bg = cornerLevel(img, Math.max)
  const scale = 255 / (255 - bg)
  const out = Buffer.alloc(img.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const [b, g, r] = [img.data[i], img.data[i + 1], img.data[i + 2]].map((c) => Math.max(0, Math.round((c - bg) * scale)))
    const a = Math.max(r, g, b)
    if (a < 3) continue
    out[i] = b
    out[i + 1] = g
    out[i + 2] = r
    out[i + 3] = a
  }
  return { ...img, data: out }
}

/** Dark artwork on white: darkness becomes alpha. */
function alphaFromWhite(img) {
  const bg = cornerLevel(img, Math.min)
  const scale = 255 / Math.max(1, bg)
  const out = Buffer.alloc(img.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const [b, g, r] = [img.data[i], img.data[i + 1], img.data[i + 2]].map((c) => Math.min(255, Math.round(c * scale)))
    const m = Math.min(r, g, b)
    const a = 255 - m
    if (a < 6) continue
    out[i] = b - m
    out[i + 1] = g - m
    out[i + 2] = r - m
    out[i + 3] = a
  }
  return { ...img, data: out }
}

function bbox(img, threshold) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function pad(rect, amount, img) {
  const x = Math.max(0, rect.x - amount)
  const y = Math.max(0, rect.y - amount)
  return { x, y, width: Math.min(img.width - x, rect.width + amount * 2), height: Math.min(img.height - y, rect.height + amount * 2) }
}

const toImage = (img) => nativeImage.createFromBitmap(img.data, { width: img.width, height: img.height })

function fit(image, maxSize) {
  const { width, height } = image.getSize()
  const s = maxSize / Math.max(width, height)
  return s >= 1 ? image : image.resize({ width: Math.round(width * s), height: Math.round(height * s), quality: 'best' })
}

/** Premultiplied source-over of `image` onto a raw canvas. */
function blit(canvas, image, ox, oy) {
  const src = image.toBitmap()
  const { width, height } = image.getSize()
  for (let y = 0; y < height; y++) {
    const cy = oy + y
    if (cy < 0 || cy >= canvas.height) continue
    for (let x = 0; x < width; x++) {
      const cx = ox + x
      if (cx < 0 || cx >= canvas.width) continue
      const j = (y * width + x) * 4
      const i = (cy * canvas.width + cx) * 4
      const inv = 1 - src[j + 3] / 255
      for (let c = 0; c < 4; c++) canvas.data[i + c] = Math.min(255, Math.round(src[j + c] + canvas.data[i + c] * inv))
    }
  }
}

function solidCanvas(width, height, [r, g, b]) {
  const data = Buffer.alloc(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = b
    data[i + 1] = g
    data[i + 2] = r
    data[i + 3] = 255
  }
  return { width, height, data }
}

/** Anti-aliased rounded square filled with an opaque colour, transparent outside. */
function roundedSquare(size, radius, [r, g, b]) {
  const data = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const nx = Math.min(Math.max(px, radius), size - radius)
      const ny = Math.min(Math.max(py, radius), size - radius)
      const coverage = Math.max(0, Math.min(1, radius - Math.hypot(px - nx, py - ny) + 0.5))
      const i = (y * size + x) * 4
      data[i] = Math.round(b * coverage)
      data[i + 1] = Math.round(g * coverage)
      data[i + 2] = Math.round(r * coverage)
      data[i + 3] = Math.round(255 * coverage)
    }
  }
  return { width: size, height: size, data }
}

function write(file, image) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, image.toPNG())
  const { width, height } = image.getSize()
  console.log(`wrote ${file} (${width}x${height})`)
}

app.whenReady().then(() => {
  try {
    const { DARK_BG_LOGO, MARK, ASSET_DIR, ICON_PATH, ICON_ALT_PATH, ICON_STYLE, PREVIEW_PATH } = process.env

    // Wordmark (ring "O" + RBIS) from the black-background logo.
    const dark = alphaFromBlack(load(DARK_BG_LOGO))
    const wordmark = fit(toImage(dark).crop(pad(bbox(dark, 3), 10, dark)), 1200)
    write(path.join(ASSET_DIR, 'orbis-wordmark.png'), wordmark)

    // Standalone ring, used wherever the single logo appears.
    const raw = load(MARK)
    const cornerAlpha = Math.min(raw.data[3], raw.data[raw.data.length - 1])
    const ring = cornerAlpha < 10 ? raw : alphaFromWhite(raw)
    console.log(`mark ${raw.width}x${raw.height}, ${cornerAlpha < 10 ? 'transparent background' : 'white background removed'}`)
    const ringCrop = toImage(ring).crop(pad(bbox(ring, 6), 6, ring))
    const mark = fit(ringCrop, 256)
    write(path.join(ASSET_DIR, 'orbis-mark.png'), mark)

    // App icons: the ring on a white and on a black rounded square.
    const iconOn = (rgb) => {
      const icon = roundedSquare(512, 112, rgb)
      const scaled = fit(ringCrop, 400)
      const { width, height } = scaled.getSize()
      blit(icon, scaled, (512 - width) >> 1, (512 - height) >> 1)
      return toImage(icon)
    }
    const iconWhite = iconOn([255, 255, 255])
    const iconBlack = iconOn([0, 0, 0])
    write(ICON_PATH, ICON_STYLE === 'black' ? iconBlack : iconWhite)
    write(ICON_ALT_PATH, ICON_STYLE === 'black' ? iconWhite : iconBlack)

    // Preview: assets on black (left) and on the light theme colour (right).
    const preview = solidCanvas(1400, 700, [0, 0, 0])
    blit(preview, toImage(solidCanvas(700, 700, [238, 243, 251])), 700, 0)
    blit(preview, fit(wordmark, 600), 50, 40)
    blit(preview, fit(mark, 160), 50, 320)
    blit(preview, fit(mark, 40), 250, 380)
    blit(preview, fit(mark, 22), 320, 390)
    blit(preview, fit(iconWhite, 180), 380, 300)
    blit(preview, fit(iconBlack, 180), 50, 500)
    blit(preview, fit(mark, 160), 750, 320)
    blit(preview, fit(mark, 40), 950, 380)
    blit(preview, fit(mark, 22), 1020, 390)
    write(PREVIEW_PATH, toImage(preview))
  } catch (err) {
    console.error('logo processing failed:', err && err.stack ? err.stack : err)
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
