// Builds the Orbis UI assets and app icons using node-only APIs
const Jimp = require('jimp').default || require('jimp')
const fs = require('node:fs')
const path = require('node:path')

async function run() {
  try {
    const { DARK_BG_LOGO, MARK, ASSET_DIR, ICON_PATH } = process.env

    console.log(`Loading dark background logo: ${DARK_BG_LOGO}`)
    const darkImg = await Jimp.read(DARK_BG_LOGO)
    console.log(`Loaded: ${darkImg.width}x${darkImg.height}`)

    console.log(`Loading mark: ${MARK}`)
    const markImg = await Jimp.read(MARK)
    console.log(`Loaded: ${markImg.width}x${markImg.height}`)

    // Resize and save wordmark
    const wordmark = darkImg.resize({ w: 1200, fit: 'contain' })
    fs.mkdirSync(ASSET_DIR, { recursive: true })
    await wordmark.write(path.join(ASSET_DIR, 'orbis-wordmark.png'))
    console.log(`wrote ${path.join(ASSET_DIR, 'orbis-wordmark.png')}`)

    // Resize and save mark
    const mark = markImg.resize({ w: 256, fit: 'contain' })
    await mark.write(path.join(ASSET_DIR, 'orbis-mark.png'))
    console.log(`wrote ${path.join(ASSET_DIR, 'orbis-mark.png')}`)

    // Create app icon
    const icon = await Jimp.create({ width: 512, height: 512, color: 0xFFFFFFFF })
    const iconMark = markImg.resize({ w: 380, fit: 'contain' })
    icon.composite(iconMark, (512 - iconMark.width) >> 1, (512 - iconMark.height) >> 1)
    fs.mkdirSync(path.dirname(ICON_PATH), { recursive: true })
    await icon.write(ICON_PATH)
    console.log(`wrote ${ICON_PATH}`)

  } catch (err) {
    console.error('logo processing failed:', err)
    process.exit(1)
  }
}

run()
