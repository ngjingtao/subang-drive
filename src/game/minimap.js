const AREA_COLORS = {
  residential: '#181b1a',
  commercial: '#202120',
  retail: '#222221',
  industrial: '#1f211f',
  construction: '#242119',
  greenfield: '#22301c',
  brownfield: '#231f18',
  grass: '#22331d',
  park: '#24371f',
  wood: '#1d2e18',
  scrub: '#212f1b',
  cemetery: '#23281d',
  pitch: '#223a22',
  playground: '#2c291e',
  parking: '#1a1c1c',
  water: '#12313e',
}

const ROAD_COLORS = {
  motorway: '#c8a45d',
  trunk: '#c8a45d',
  primary: '#b08f52',
  secondary: '#969b95',
  tertiary: '#7c837c',
  unclassified: '#68706a',
  residential: '#5e6660',
  living_street: '#5e6660',
  service: '#484e4a',
  motorway_link: '#a98f57',
  trunk_link: '#a98f57',
  primary_link: '#a98f57',
  secondary_link: '#8b918b',
  tertiary_link: '#7c837c',
  raceway: '#6d756e',
  road: '#5e6660',
}

export class Minimap {
  constructor(data) {
    this.canvas = document.getElementById('minimap')
    this.ctx = this.canvas.getContext('2d')
    this.data = data
    this.size = 3072
    this.bounds = data.meta.bounds
    this.worldW = this.bounds.maxX - this.bounds.minX
    this.worldH = this.bounds.maxZ - this.bounds.minZ
    this.span = Math.max(this.worldW, this.worldH)
    this.scale = this.size / this.span
    this.offsetX = (this.size - this.worldW * this.scale) / 2
    this.offsetY = (this.size - this.worldH * this.scale) / 2
    this.viewMeters = 620
    this.build()
  }

  toMap(x, z) {
    return [
      this.offsetX + (x - this.bounds.minX) * this.scale,
      this.offsetY + (z - this.bounds.minZ) * this.scale,
    ]
  }

  build() {
    const c = document.createElement('canvas')
    c.width = this.size
    c.height = this.size
    const ctx = c.getContext('2d')

    // base
    ctx.fillStyle = '#0c1210'
    ctx.fillRect(0, 0, this.size, this.size)
    const g = ctx.createRadialGradient(this.size / 2, this.size / 2, 50, this.size / 2, this.size / 2, this.size * 0.65)
    g.addColorStop(0, 'rgba(28,42,35,0.9)')
    g.addColorStop(1, 'rgba(8,12,10,0.9)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, this.size, this.size)

    // areas
    for (const area of this.data.areas) {
      const pts = area.p
      if (!pts || pts.length < 3) continue
      ctx.beginPath()
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = this.toMap(pts[i][0], pts[i][1])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fillStyle = AREA_COLORS[area.k] || '#171a19'
      ctx.fill()
    }

    // paths
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const path of this.data.paths) {
      if (path.p.length < 2) continue
      ctx.beginPath()
      for (let i = 0; i < path.p.length; i++) {
        const [x, y] = this.toMap(path.p[i][0], path.p[i][1])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = path.t === 'railway' ? '#4b4c46' : '#343b36'
      ctx.lineWidth = path.t === 'railway' ? 1.6 : 1.1
      ctx.stroke()
    }

    // roads: casing then fill
    for (const road of this.data.roads) {
      if (road.p.length < 2) continue
      const width = Math.max(1.5, road.w * this.scale * 0.9)
      this.strokeRoad(ctx, road.p, width + 2.2, 'rgba(0,0,0,0.55)')
      this.strokeRoad(ctx, road.p, width, ROAD_COLORS[road.t] || '#5e6660')
    }

    // a hint of the highway
    for (const road of this.data.roads) {
      if (!['motorway', 'trunk'].includes(road.t)) continue
      this.strokeRoad(ctx, road.p, 1.0, 'rgba(255,220,150,0.42)')
    }

    this.drawRefBadges(ctx)

    this.mapCanvas = c
  }

  drawRefBadges(ctx) {
    const groups = new Map()
    for (const road of this.data.roads) {
      const ref = (road.ref || '').match(/^E\d+/)?.[0]
      if (!ref || !['E5', 'E6'].includes(ref)) continue
      let len = 0
      for (let i = 0; i < road.p.length - 1; i++) {
        len += Math.hypot(road.p[i + 1][0] - road.p[i][0], road.p[i + 1][1] - road.p[i][1])
      }
      if (len < 80) continue
      if (!groups.has(ref)) groups.set(ref, [])
      groups.get(ref).push({ road, len })
    }

    for (const [ref, list] of groups) {
      list.sort((a, b) => b.len - a.len)
      const picked = []
      for (const item of list) {
        if (picked.length >= 2) break
        const mid = item.road.p[Math.floor(item.road.p.length / 2)]
        if (picked.some((p) => Math.hypot(p[0] - mid[0], p[1] - mid[1]) < 140)) continue
        picked.push(mid)
      }
      for (const [x, z] of picked) {
        const [px, py] = this.toMap(x, z)
        const w = 34
        const h = 20
        ctx.save()
        ctx.translate(px, py)
        ctx.fillStyle = 'rgba(20,74,124,0.94)'
        ctx.strokeStyle = 'rgba(255,255,255,0.82)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.roundRect(-w / 2, -h / 2, w, h, 5)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,0.96)'
        ctx.font = '700 13px "Helvetica Neue", Arial, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(ref, 0, 1)
        ctx.restore()
      }
    }
  }

  strokeRoad(ctx, pts, width, color) {
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = this.toMap(pts[i][0], pts[i][1])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.stroke()
  }

  draw(state) {
    const ctx = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height
    const [px, py] = this.toMap(state.x, state.z)
    const srcSize = this.viewMeters * this.scale
    const sx = px - srcSize / 2
    const sy = py - srcSize / 2

    ctx.clearRect(0, 0, W, H)
    ctx.save()
    ctx.beginPath()
    ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2)
    ctx.clip()

    // dark backing outside map extent
    ctx.fillStyle = '#0a0f0d'
    ctx.fillRect(0, 0, W, H)
    ctx.drawImage(this.mapCanvas, sx, sy, srcSize, srcSize, 0, 0, W, H)

    // heading cone
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.rotate(-state.yaw)
    const cone = ctx.createLinearGradient(0, 0, 0, -80)
    cone.addColorStop(0, 'rgba(255,200,87,0.34)')
    cone.addColorStop(1, 'rgba(255,200,87,0)')
    ctx.fillStyle = cone
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, 80, -Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3)
    ctx.closePath()
    ctx.fill()

    // player arrow
    ctx.beginPath()
    ctx.moveTo(0, -9)
    ctx.lineTo(6.5, 7)
    ctx.lineTo(0, 4)
    ctx.lineTo(-6.5, 7)
    ctx.closePath()
    ctx.fillStyle = '#ffc857'
    ctx.shadowColor = 'rgba(255,200,87,0.9)'
    ctx.shadowBlur = 10
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.restore()

    // subtle van dyke vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.52)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, 'rgba(0,0,0,0.45)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }
}
