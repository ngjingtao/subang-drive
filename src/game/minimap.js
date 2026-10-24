const AREA_COLORS = {
  residential: '#e4e0d6',
  commercial: '#e8e4da',
  retail: '#e9e5db',
  industrial: '#dfdbd2',
  construction: '#e0d6c8',
  greenfield: '#d6e6c7',
  brownfield: '#ded6c6',
  grass: '#d3e4c4',
  park: '#cfe4c1',
  wood: '#c3dcb7',
  scrub: '#d0e1c2',
  cemetery: '#d8e0cf',
  pitch: '#c4e2ba',
  playground: '#e7dcc7',
  parking: '#ddd9d0',
  water: '#b5e1f1',
}

const ROAD_COLORS = {
  motorway: '#ffcf70',
  trunk: '#ffcf70',
  primary: '#ffdda0',
  secondary: '#fff3cf',
  tertiary: '#ffffff',
  unclassified: '#ffffff',
  residential: '#ffffff',
  living_street: '#ffffff',
  service: '#f7f3e9',
  motorway_link: '#ffdda0',
  trunk_link: '#ffdda0',
  primary_link: '#ffdda0',
  secondary_link: '#fff3cf',
  tertiary_link: '#ffffff',
  raceway: '#ffffff',
  road: '#ffffff',
}

/**
 * Waze-like phone map. The circular minimap is gone: the map now lives in a
 * phone-shaped panel with heading-up rotation, a destination picker and a
 * blue route line.
 */
export class Minimap {
  constructor(data, { mobile = false } = {}) {
    this.canvas = document.getElementById('phone-map')
    this.ctx = this.canvas.getContext('2d')
    this.data = data
    this.W = 360
    this.H = 640
    this.dpr = 2
    this.canvas.width = this.W * this.dpr
    this.canvas.height = this.H * this.dpr
    this.viewMeters = 560
    this.nav = null
    this.full = this.buildMapCanvas(data.meta.bounds, mobile ? 1536 : 2048)
    this.coreBounds = {
      minX: -7000,
      maxX: 7000,
      minZ: -7000,
      maxZ: 7000,
    }
    this.core = this.buildMapCanvas(this.coreBounds, mobile ? 3072 : 4096)
  }

  // Kept for any external callers; the live map chooses the detailed core
  // canvas or the low-resolution outer fallback in draw().
  toMap(x, z) {
    return this.full.toMap(x, z)
  }

  buildMapCanvas(bounds, size) {
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const ctx = c.getContext('2d')
    const worldW = bounds.maxX - bounds.minX
    const worldH = bounds.maxZ - bounds.minZ
    const span = Math.max(worldW, worldH)
    const scale = size / span
    const offsetX = (size - worldW * scale) / 2
    const offsetY = (size - worldH * scale) / 2
    const toMap = (x, z) => [
      offsetX + (x - bounds.minX) * scale,
      offsetY + (z - bounds.minZ) * scale,
    ]

    ctx.fillStyle = '#e9e7df'
    ctx.fillRect(0, 0, size, size)

    // land use
    for (const area of this.data.areas) {
      if (!area.p || area.p.length < 3) continue
      ctx.beginPath()
      for (let i = 0; i < area.p.length; i++) {
        const [x, y] = toMap(area.p[i][0], area.p[i][1])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fillStyle = AREA_COLORS[area.k] || '#e4e0d6'
      ctx.fill()
    }

    // footpaths and rail
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const path of this.data.paths) {
      if (!path.p || path.p.length < 2) continue
      ctx.beginPath()
      for (let i = 0; i < path.p.length; i++) {
        const [x, y] = toMap(path.p[i][0], path.p[i][1])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = path.t === 'railway' ? '#b9b3a7' : '#d8d2c5'
      ctx.lineWidth = Math.max(0.15, (path.t === 'railway' ? 1.8 : 1.2) * scale * 6)
      ctx.stroke()
    }

    // roads: casing then white/yellow fill. Widths are in source pixels and
    // scale with the canvas so the core map stays sharp when the phone zooms.
    const roadWidth = (road) => Math.max(0.12, road.w * scale * 1.15)
    for (const road of this.data.roads) {
      if (!road.p || road.p.length < 2) continue
      const width = roadWidth(road)
      this.strokeRoad(ctx, toMap, road.p, width + scale * 1.8, 'rgba(177,170,157,0.55)')
    }
    for (const road of this.data.roads) {
      if (!road.p || road.p.length < 2) continue
      this.strokeRoad(ctx, toMap, road.p, roadWidth(road), ROAD_COLORS[road.t] || '#ffffff')
    }

    // subtle edge vignette so the white map does not blow out
    const vg = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size * 0.7)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, 'rgba(98,88,70,0.10)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, size, size)

    return { canvas: c, bounds, size, scale, offsetX, offsetY, toMap }
  }

  drawHighwayShield(ctx, ref) {
    const roads = this.data.roads.filter((r) => (r.ref || '').startsWith(ref))
    if (!roads.length) return
    roads.sort((a, b) => (b.p?.length || 0) - (a.p?.length || 0))
    const road = roads[0]
    const p = road.p[Math.floor(road.p.length / 2)]
    const [x, y] = this.toMap(p[0], p[1])
    const w = 94
    const h = 42
    ctx.save()
    ctx.translate(x, y)
    ctx.fillStyle = '#2e6fae'
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h / 2, w, h, 8)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.font = '700 25px "Helvetica Neue", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(ref, 0, 1)
    ctx.restore()
  }

  strokeRoad(ctx, toMap, pts, width, color) {
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = toMap(pts[i][0], pts[i][1])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.stroke()
  }

  setNav(nav) {
    this.nav = nav
  }

  draw(state, nav = this.nav) {
    const ctx = this.ctx
    const W = this.W
    const H = this.H
    const b = this.coreBounds
    const useCore = state.x >= b.minX && state.x <= b.maxX && state.z >= b.minZ && state.z <= b.maxZ
    const map = useCore ? this.core : this.full
    const mapPoint = map.toMap
    const [carX, carY] = mapPoint(state.x, state.z)
    const cx = W / 2
    const cy = H * 0.46
    const srcW = this.viewMeters * map.scale
    const k = W / srcW
    const D = Math.hypot(W, H) * 1.10
    const srcSize = D / k

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#e9e7df'
    ctx.fillRect(0, 0, W, H)

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(state.yaw)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(
      map.canvas,
      carX - srcSize / 2,
      carY - srcSize / 2,
      srcSize,
      srcSize,
      -D / 2,
      -D / 2,
      D,
      D,
    )

    if (nav && nav.route && nav.route.points.length > 1) {
      const pts = nav.route.points
      ctx.beginPath()
      for (let i = 0; i < pts.length; i++) {
        const x = (mapPoint(pts[i].x, pts[i].z)[0] - carX) * k
        const y = (mapPoint(pts[i].x, pts[i].z)[1] - carY) * k
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = 'rgba(255,255,255,0.96)'
      ctx.lineWidth = 12
      ctx.stroke()
      ctx.strokeStyle = '#6b4fd8'
      ctx.lineWidth = 7.2
      ctx.stroke()
    }
    ctx.restore()

    // destination pin, upright and not rotated with the map
    let destScreen = null
    if (nav && nav.dest) {
      const [dxm, dym] = mapPoint(nav.dest.x, nav.dest.z)
      const dx = (dxm - carX) * k
      const dy = (dym - carY) * k
      const cos = Math.cos(state.yaw)
      const sin = Math.sin(state.yaw)
      const sx = cx + dx * cos - dy * sin
      const sy = cy + dx * sin + dy * cos
      destScreen = { x: sx, y: sy }
      if (sx > 16 && sx < W - 16 && sy > 64 && sy < H * 0.64) {
        this.drawPin(ctx, sx, sy, nav.dest.color || '#e2557f')
      }
    }

    // car marker (heading is always up in this view)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.shadowColor = 'rgba(30, 40, 55, 0.45)'
    ctx.shadowBlur = 10
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(0, 0, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#10b5a5'
    ctx.beginPath()
    ctx.moveTo(0, -12)
    ctx.lineTo(8, 8)
    ctx.lineTo(0, 4)
    ctx.lineTo(-8, 8)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // Waze-style current-road pill near the car
    if (state.roadName) {
      let label = state.roadName
      ctx.font = '700 12px "Helvetica Neue", Arial, sans-serif'
      let tw = ctx.measureText(label).width
      if (tw > 156) {
        ctx.font = '700 10.5px "Helvetica Neue", Arial, sans-serif'
        tw = ctx.measureText(label).width
      }
      while (tw > 168 && label.length > 8) {
        label = label.slice(0, -2)
        tw = ctx.measureText(label + '…').width
      }
      if (label !== state.roadName) label += '…'
      const pillW = Math.min(190, tw + 20)
      const pillH = 21
      const px = cx - pillW / 2
      const py = cy + 29
      ctx.save()
      ctx.fillStyle = 'rgba(255,255,255,0.96)'
      ctx.shadowColor = 'rgba(30,25,18,0.25)'
      ctx.shadowBlur = 7
      ctx.shadowOffsetY = 2
      ctx.beginPath()
      ctx.roundRect(px, py, pillW, pillH, 10)
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.fillStyle = '#1f1e1b'
      ctx.font = '700 12px "Helvetica Neue", Arial, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, cx, py + pillH / 2 + 0.5)
      ctx.restore()
    }

    // nearest traffic light icon (Waze-ish)
    if (this.data.signals && this.data.signals.length) {
      let best = null
      let bestD = 260
      for (const [sxw, szw] of this.data.signals) {
        const d = Math.hypot(sxw - state.x, szw - state.z)
        if (d < bestD) { bestD = d; best = [sxw, szw] }
      }
      if (best) {
        const [sxm, sym] = mapPoint(best[0], best[1])
        const dx = (sxm - carX) * k
        const dy = (sym - carY) * k
        const cos = Math.cos(state.yaw)
        const sin = Math.sin(state.yaw)
        const sx = cx + dx * cos - dy * sin
        const sy = cy + dx * sin + dy * cos
        if (sx > 14 && sx < W - 14 && sy > 68 && sy < H * 0.60) {
          ctx.save()
          ctx.translate(sx, sy)
          ctx.fillStyle = 'rgba(12,13,15,0.94)'
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.roundRect(-6, -12, 12, 24, 4)
          ctx.fill()
          ctx.stroke()
          const dots = [['#ff453a', -6.8], ['#ffcc00', 0], ['#34c759', 6.8]]
          for (const [col, oy] of dots) {
            ctx.fillStyle = col
            ctx.beginPath()
            ctx.arc(0, oy, 2.1, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.restore()
        }
      }
    }

    // if the destination is off the phone map, leave a small edge arrow
    if (destScreen && (destScreen.x < 14 || destScreen.x > W - 14 || destScreen.y < 58 || destScreen.y > H * 0.65)) {
      const ax = Math.max(18, Math.min(W - 18, destScreen.x))
      const ay = Math.max(88, Math.min(H * 0.60, destScreen.y))
      ctx.save()
      ctx.translate(ax, ay)
      ctx.fillStyle = nav.dest?.color || '#e2557f'
      ctx.beginPath()
      ctx.arc(0, 0, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()
    }
  }

  drawPin(ctx, x, y, color) {
    ctx.save()
    ctx.translate(x, y)
    ctx.shadowColor = 'rgba(40, 25, 30, 0.35)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetY = 2
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(0, -9, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-6, -3)
    ctx.lineTo(6, -3)
    ctx.lineTo(0, 9)
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, -9, 9, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(0, -9, 3.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}
