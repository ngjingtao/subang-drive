import * as THREE from 'three'

function canvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')]
}

function tex(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c)
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
  }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function noise(ctx, w, h, amount, alpha) {
  for (let i = 0; i < amount; i++) {
    const v = Math.random() * 255
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2)
  }
}

const roadCache = new Map()

/**
 * Road texture: one tile = road width x 12 m.
 * `lanes` shape the painted markings (2, 4 or 6).
 */
export function roadTexture(lanes = 2, plain = false) {
  const key = plain ? 'plain' : `r${lanes}`
  if (roadCache.has(key)) return roadCache.get(key)

  const W = 512
  const H = 768
  const [c, ctx] = canvas(W, H)

  // asphalt
  const g = ctx.createLinearGradient(0, 0, W, 0)
  g.addColorStop(0, plain ? '#5c5e5a' : '#4a4e51')
  g.addColorStop(0.5, plain ? '#676964' : '#55595c')
  g.addColorStop(1, plain ? '#5a5c58' : '#474b4e')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // coarse aggregate
  for (let i = 0; i < 18000; i++) {
    const v = 35 + Math.random() * 110
    ctx.fillStyle = `rgba(${v},${v},${v},${0.1 + Math.random() * 0.2})`
    const s = Math.random() * 2.4
    ctx.fillRect(Math.random() * W, Math.random() * H, s, s)
  }
  // faint tyre polish down the lane centres
  if (!plain) {
    const laneW = W / lanes
    ctx.globalAlpha = 0.08
    for (let i = 0; i < lanes; i++) {
      const x = laneW * (i + 0.5)
      ctx.fillStyle = '#9a9a94'
      ctx.fillRect(x - laneW * 0.22, 0, laneW * 0.44, H)
    }
    ctx.globalAlpha = 1
  }

  // tar patches
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = 'rgba(30,31,33,0.18)'
    const pw = 20 + Math.random() * 80
    const ph = 30 + Math.random() * 140
    ctx.fillRect(Math.random() * W, Math.random() * H, pw, ph)
  }

  if (!plain) {
    ctx.lineCap = 'butt'
    const edge = Math.max(3, W * 0.012)
    // edge lines (solid white), slightly worn
    ctx.fillStyle = 'rgba(240,238,228,0.72)'
    ctx.fillRect(W * 0.045, 0, edge, H)
    ctx.fillRect(W * 0.955 - edge, 0, edge, H)

    const dash = (x, width, color = 'rgba(245,242,230,0.8)') => {
      ctx.fillStyle = color
      ctx.fillRect(x - width / 2, 70, width, 250) // 4 m dash in a 12 m tile
    }

    if (lanes === 2) {
      dash(W * 0.5, Math.max(4, W * 0.014))
    } else if (lanes === 3) {
      dash(W / 3, Math.max(4, W * 0.012))
      dash((W * 2) / 3, Math.max(4, W * 0.012))
    } else if (lanes === 4) {
      dash(W * 0.5, Math.max(5, W * 0.015), 'rgba(248,236,190,0.65)')
      dash(W * 0.25, Math.max(3, W * 0.011))
      dash(W * 0.75, Math.max(3, W * 0.011))
    } else {
      dash(W * 0.5, Math.max(5, W * 0.014), 'rgba(248,236,190,0.6)')
      for (const f of [0.22, 0.38, 0.62, 0.78]) dash(W * f, Math.max(3, W * 0.01))
    }

    // subtle cracks / patches
    ctx.strokeStyle = 'rgba(20,20,22,0.35)'
    ctx.lineWidth = 1.2
    for (let i = 0; i < 4; i++) {
      ctx.beginPath()
      let x = Math.random() * W
      let y = Math.random() * H
      ctx.moveTo(x, y)
      for (let j = 0; j < 8; j++) {
        x += (Math.random() - 0.5) * 45
        y += 18 + Math.random() * 30
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }

  const t = tex(c)
  roadCache.set(key, t)
  return t
}

let grassTex
export function grassTexture() {
  if (grassTex) return grassTex
  const S = 512
  const [c, ctx] = canvas(S, S)
  ctx.fillStyle = '#5d7044'
  ctx.fillRect(0, 0, S, S)
  for (let i = 0; i < 12000; i++) {
    const g1 = 60 + Math.random() * 75
    const r = 45 + Math.random() * 45
    const b = 32 + Math.random() * 32
    ctx.fillStyle = `rgba(${r},${g1},${b},${0.3 + Math.random() * 0.4})`
    ctx.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 1 + Math.random() * 4)
  }
  // broad dry patches
  for (let i = 0; i < 25; i++) {
    const x = Math.random() * S
    const y = Math.random() * S
    const rad = 15 + Math.random() * 55
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rad)
    rg.addColorStop(0, 'rgba(129,119,66,0.24)')
    rg.addColorStop(1, 'rgba(128,124,74,0)')
    ctx.fillStyle = rg
    ctx.beginPath()
    ctx.arc(x, y, rad, 0, Math.PI * 2)
    ctx.fill()
  }
  grassTex = tex(c)
  return grassTex
}

let pathTex
export function pathTexture() {
  if (pathTex) return pathTex
  const S = 256
  const [c, ctx] = canvas(S, S)
  ctx.fillStyle = '#8b877c'
  ctx.fillRect(0, 0, S, S)
  noise(ctx, S, S, 5000, 0.15)
  pathTex = tex(c)
  return pathTex
}

let shadowTex
export function shadowTexture() {
  if (shadowTex) return shadowTex
  const S = 256
  const [c, ctx] = canvas(S, S)
  const g = ctx.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.62)')
  g.addColorStop(0.45, 'rgba(0,0,0,0.36)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  shadowTex = tex(c, { repeat: false, srgb: false })
  return shadowTex
}

let glowTex
export function glowTexture() {
  if (glowTex) return glowTex
  const S = 256
  const [c, ctx] = canvas(S, S)
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.18, 'rgba(255,238,200,0.85)')
  g.addColorStop(0.5, 'rgba(255,200,120,0.22)')
  g.addColorStop(1, 'rgba(255,180,80,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  glowTex = tex(c, { repeat: false })
  return glowTex
}

let emblemTex
export function emblemTexture() {
  if (emblemTex) return emblemTex
  const S = 512
  const [c, ctx] = canvas(S, S)
  ctx.clearRect(0, 0, S, S)
  ctx.strokeStyle = '#d7d9dc'
  ctx.lineWidth = 26
  const cx = S / 2
  const cy = S / 2
  const ellipse = (rx, ry, rot) => {
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2)
    ctx.stroke()
  }
  ellipse(180, 112, 0)
  ellipse(74, 112, 0)
  ellipse(112, 74, Math.PI / 2)
  emblemTex = tex(c, { repeat: false })
  return emblemTex
}

let plateTex
export function plateTexture(text = 'B 2014 V') {
  const [c, ctx] = canvas(512, 128)
  ctx.fillStyle = '#f2f0e9'
  ctx.fillRect(0, 0, 512, 128)
  ctx.fillStyle = '#141414'
  ctx.fillRect(0, 0, 512, 8)
  ctx.fillRect(0, 120, 512, 8)
  ctx.font = '800 74px "Arial Narrow", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 256, 68)
  const t = tex(c, { repeat: false })
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

let clusterTex
export function clusterTexture() {
  if (clusterTex) return clusterTex
  const W = 1024
  const H = 512
  const [c, ctx] = canvas(W, H)
  ctx.fillStyle = '#07090c'
  ctx.fillRect(0, 0, W, H)

  // subtle blue backlight wash
  const wash = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W / 2)
  wash.addColorStop(0, 'rgba(30,58,86,0.20)')
  wash.addColorStop(1, 'rgba(10,14,20,0)')
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, W, H)

  const dial = (cx, cy, r, maxVal, step, label, redline) => {
    ctx.save()
    ctx.translate(cx, cy)
    // ring
    ctx.strokeStyle = 'rgba(170,186,204,0.32)'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(0, 0, r, Math.PI * 0.75, Math.PI * 2.25)
    ctx.stroke()

    const start = Math.PI * 0.75
    const total = Math.PI * 1.5
    for (let v = 0; v <= maxVal; v += step) {
      const t = v / maxVal
      const a = start + total * t
      const major = v % (step * 4) === 0
      const inner = r - (major ? 30 : 18)
      ctx.strokeStyle = redline != null && v >= redline ? 'rgba(255,86,70,0.95)' : 'rgba(226,236,246,0.85)'
      ctx.lineWidth = major ? 5 : 2.5
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner)
      ctx.lineTo(Math.cos(a) * (r - 5), Math.sin(a) * (r - 5))
      ctx.stroke()
      if (major) {
        const tx = Math.cos(a) * (r - 62)
        const ty = Math.sin(a) * (r - 62)
        ctx.fillStyle = 'rgba(228,238,248,0.9)'
        ctx.font = '600 34px "Helvetica Neue", Arial, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(v), tx, ty)
      }
    }
    // small tick marks
    for (let v = 0; v <= maxVal; v += step / 2) {
      const t = v / maxVal
      const a = start + total * t
      ctx.strokeStyle = 'rgba(200,214,230,0.4)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * (r - 20), Math.sin(a) * (r - 20))
      ctx.lineTo(Math.cos(a) * (r - 12), Math.sin(a) * (r - 12))
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(180,198,216,0.6)'
    ctx.font = '500 23px "Helvetica Neue", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(label, 0, r * 0.54)
    ctx.restore()
  }

  dial(282, 250, 196, 8, 1, 'x1000 r/min', 6.5)
  dial(742, 250, 196, 200, 20, 'km/h', null)

  // centre info pod
  ctx.fillStyle = '#0b1118'
  ctx.strokeStyle = 'rgba(120,150,180,0.28)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(W / 2 - 90, 214, 180, 110, 12)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = 'rgba(160,220,255,0.55)'
  ctx.font = '600 20px "Helvetica Neue", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('SUBANG', W / 2, 242)

  // fuel + temp bars
  const bar = (x, y, w, h, fill, label) => {
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = fill
    ctx.fillRect(x, y, w * 0.66, h)
    ctx.fillStyle = 'rgba(200,214,230,0.55)'
    ctx.font = '500 20px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(label, x + w / 2, y + h + 28)
  }
  bar(374, 388, 120, 8, 'rgba(120,205,255,0.8)', 'FUEL')
  bar(530, 388, 120, 8, 'rgba(255,120,90,0.8)', 'TEMP')

  // Toyota-ish name
  ctx.fillStyle = 'rgba(220,232,244,0.35)'
  ctx.font = '500 18px "Helvetica Neue", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('TOYOTA', W / 2, 452)

  clusterTex = tex(c, { repeat: false })
  return clusterTex
}

let radioTex
export function radioTexture() {
  if (radioTex) return radioTex
  const W = 512
  const H = 256
  const [c, ctx] = canvas(W, H)
  ctx.fillStyle = '#0b1118'
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createLinearGradient(0, 0, W, 0)
  glow.addColorStop(0, 'rgba(20,40,60,0)')
  glow.addColorStop(0.5, 'rgba(45,110,150,0.38)')
  glow.addColorStop(1, 'rgba(20,40,60,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, 170)
  ctx.fillStyle = 'rgba(150,220,255,0.95)'
  ctx.font = '600 54px "Helvetica Neue", Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('88.1', 34, 82)
  ctx.fillStyle = 'rgba(170,210,235,0.6)'
  ctx.font = '500 22px "Helvetica Neue", Arial, sans-serif'
  ctx.fillText('hitz  fm', 34, 116)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(120,200,255,0.45)'
  ctx.font = '500 24px "Helvetica Neue", Arial, sans-serif'
  ctx.fillText('4:42 PM', W - 34, 82)
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  for (let i = 0; i < 6; i++) ctx.fillRect(34 + i * 74, 160, 54, 6)
  ctx.fillStyle = 'rgba(255,200,87,0.55)'
  ctx.fillRect(34, 160, 54, 6)
  radioTex = tex(c, { repeat: false })
  return radioTex
}

let chevronTex
export function chevronTexture() {
  if (chevronTex) return chevronTex
  const W = 256
  const H = 128
  const [c, ctx] = canvas(W, H)
  ctx.clearRect(0, 0, W, H)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const draw = (y) => {
    ctx.beginPath()
    ctx.moveTo(48, y + 34)
    ctx.lineTo(128, y)
    ctx.lineTo(208, y + 34)
    ctx.lineWidth = 23
    ctx.strokeStyle = 'rgba(255,200,87,0.92)'
    ctx.shadowColor = 'rgba(255,190,70,0.8)'
    ctx.shadowBlur = 14
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.lineWidth = 5
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'
    ctx.stroke()
  }
  draw(8)
  draw(66)
  chevronTex = tex(c, { repeat: false })
  return chevronTex
}

export function makeLabelTexture(text, sub = '', { w = 512, h = 256, bg = 'rgba(10,12,15,0.82)', fg = '#f5f1e6', accent = '#ffc857', border = true } = {}) {
  const [c, ctx] = canvas(w, h)
  ctx.fillStyle = bg
  ctx.beginPath()
  ctx.roundRect(4, 4, w - 8, h - 8, 22)
  ctx.fill()
  if (border) {
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'
    ctx.lineWidth = 3
    ctx.stroke()
  }
  ctx.fillStyle = fg
  ctx.textAlign = 'center'
  ctx.font = `700 ${Math.round(h * 0.26)}px "Helvetica Neue", Arial, sans-serif`
  ctx.fillText(text, w / 2, h * 0.48)
  if (sub) {
    ctx.fillStyle = accent
    ctx.font = `600 ${Math.round(h * 0.1)}px "Helvetica Neue", Arial, sans-serif`
    ctx.fillText(sub.toUpperCase(), w / 2, h * 0.68)
  }
  return tex(c, { repeat: false })
}
