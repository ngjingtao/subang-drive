/**
 * Small road-network router for the point-to-point Waze-style guidance.
 * Builds a graph from the baked OSM road polylines and uses A*.
 * One-way tags are ignored: the game lets you drive both ways anyway.
 */

class MinHeap {
  constructor() {
    this.a = []
  }
  get size() {
    return this.a.length
  }
  push(i, f) {
    const a = this.a
    a.push({ i, f })
    let n = a.length - 1
    while (n > 0) {
      const p = (n - 1) >> 1
      if (a[p].f <= a[n].f) break
      ;[a[p], a[n]] = [a[n], a[p]]
      n = p
    }
  }
  pop() {
    const a = this.a
    if (!a.length) return null
    const top = a[0]
    const last = a.pop()
    if (a.length && last) {
      a[0] = last
      let n = 0
      for (;;) {
        const l = n * 2 + 1
        const r = l + 1
        let m = n
        if (l < a.length && a[l].f < a[m].f) m = l
        if (r < a.length && a[r].f < a[m].f) m = r
        if (m === n) break
        ;[a[m], a[n]] = [a[n], a[m]]
        n = m
      }
    }
    return top
  }
}

const snapKey = (x, z) => `${Math.round(x / 2)},${Math.round(z / 2)}`
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz)

export class RoadRouter {
  constructor(roads) {
    this.roads = roads
    this.built = false
    this.nodes = []
    this.adj = []
    this.grid = new Map()
    this.cell = 48
  }

  build() {
    if (this.built) return this
    const index = new Map()
    const nodes = this.nodes
    const adj = this.adj

    const addNode = (x, z) => {
      const k = snapKey(x, z)
      let i = index.get(k)
      if (i !== undefined) return i
      i = nodes.length
      nodes.push({ x, z })
      adj.push([])
      index.set(k, i)
      return i
    }

    const addEdge = (a, b, w, name, ref, type) => {
      if (a === b || w < 0.4) return
      adj[a].push({ to: b, w, name, ref, type })
      adj[b].push({ to: a, w, name, ref, type })
    }

    for (const road of this.roads) {
      if (!road.p || road.p.length < 2) continue
      let prev = addNode(road.p[0][0], road.p[0][1])
      for (let i = 1; i < road.p.length; i++) {
        const [x, z] = road.p[i]
        const next = addNode(x, z)
        addEdge(prev, next, dist2(road.p[i - 1][0], road.p[i - 1][1], x, z), road.n || road.ref || '', road.ref || '', road.t)
        prev = next
      }
    }

    // spatial grid for nearest-node queries
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const k = `${Math.floor(n.x / this.cell)},${Math.floor(n.z / this.cell)}`
      let list = this.grid.get(k)
      if (!list) this.grid.set(k, (list = []))
      list.push(i)
    }

    this.built = true
    return this
  }

  nearestNode(x, z, maxDist = 220) {
    if (!this.built) this.build()
    const gx = Math.floor(x / this.cell)
    const gz = Math.floor(z / this.cell)
    let best = -1
    let bestD = maxDist
    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        const list = this.grid.get(`${gx + ox},${gz + oz}`)
        if (!list) continue
        for (const i of list) {
          const n = this.nodes[i]
          const d = Math.hypot(n.x - x, n.z - z)
          if (d < bestD) {
            bestD = d
            best = i
          }
        }
      }
    }
    return best < 0 ? null : { index: best, dist: bestD }
  }

  route(from, to, destName = 'destination') {
    this.build()
    const s = this.nearestNode(from.x, from.z, 300)
    const t = this.nearestNode(to.x, to.z, 300)
    if (!s || !t) return null

    const n = this.nodes.length
    const g = new Float64Array(n).fill(Infinity)
    const prev = new Int32Array(n).fill(-1)
    const prevName = new Array(n).fill('')
    const prevRef = new Array(n).fill('')
    const closed = new Uint8Array(n)
    const heap = new MinHeap()
    const tx = this.nodes[t.index].x
    const tz = this.nodes[t.index].z

    g[s.index] = 0
    heap.push(s.index, Math.hypot(this.nodes[s.index].x - tx, this.nodes[s.index].z - tz))

    while (heap.size) {
      const item = heap.pop()
      if (!item) break
      const u = item.i
      if (closed[u]) continue
      closed[u] = 1
      if (u === t.index) break
      const nux = this.nodes[u].x
      const nuz = this.nodes[u].z
      for (const edge of this.adj[u]) {
        const v = edge.to
        if (closed[v]) continue
        const ng = g[u] + edge.w
        if (ng < g[v]) {
          g[v] = ng
          prev[v] = u
          prevName[v] = edge.name
          prevRef[v] = edge.ref
          const h = Math.hypot(this.nodes[v].x - tx, this.nodes[v].z - tz)
          heap.push(v, ng + h)
        }
      }
    }

    if (!Number.isFinite(g[t.index])) return null

    const nodeIds = []
    let u = t.index
    while (u !== -1) {
      nodeIds.push(u)
      if (u === s.index) break
      u = prev[u]
    }
    nodeIds.reverse()
    if (nodeIds[0] !== s.index) return null

    const points = [
      { x: from.x, z: from.z },
      ...nodeIds.map((i) => ({ x: this.nodes[i].x, z: this.nodes[i].z })),
      { x: to.x, z: to.z },
    ]
    const edgeNames = []
    // the little connector from the car to the nearest graph node
    const firstEdge = this.adj[s.index]?.find((e) => e.name) || this.adj[s.index]?.[0]
    edgeNames.push(firstEdge?.name || firstEdge?.ref || '')
    for (let i = 1; i < nodeIds.length; i++) edgeNames.push(prevName[nodeIds[i]] || prevRef[nodeIds[i]] || '')
    // ...and the short tail from the last road node to the pin
    edgeNames.push('')

    const total = s.dist + g[t.index] + t.dist
    const instructions = this.buildInstructions(points, edgeNames, total, destName)
    return {
      points,
      edgeNames,
      distance: total,
      instructions,
      startNode: s.index,
      endNode: t.index,
      startDistance: s.dist,
      endDistance: t.dist,
      destination: { x: to.x, z: to.z, name: destName },
    }
  }

  buildInstructions(points, edgeNames, total, destName) {
    const out = []
    const names = edgeNames.length ? edgeNames : ['']
    const startName = names[0] || 'the road'
    out.push({ at: 0, type: 'start', text: `Head out on ${startName}`, road: names[0] || '' })

    let along = 0
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1]
      const b = points[i]
      const c = points[i + 1]
      const l = dist2(a.x, a.z, b.x, b.z)
      along += l
      const inx = b.x - a.x
      const inz = b.z - a.z
      const outx = c.x - b.x
      const outz = c.z - b.z
      const dot = inx * outx + inz * outz
      const cross = inx * outz - inz * outx
      const angle = Math.abs(Math.atan2(cross, dot))
      const nameIn = names[Math.min(i - 1, names.length - 1)] || ''
      const nameOut = names[Math.min(i, names.length - 1)] || ''
      const changed = nameIn && nameOut && nameIn !== nameOut
      if (angle > 0.5 || (changed && angle > 0.25)) {
        let type
        let verb
        if (dot < 0 && angle > 2.35) {
          type = 'uturn'
          verb = 'Make a U-turn'
        } else if (cross > 0.16) {
          type = 'right'
          verb = 'Turn right'
        } else if (cross < -0.16) {
          type = 'left'
          verb = 'Turn left'
        } else {
          type = 'continue'
          verb = `Continue onto`
        }
        const onto = nameOut || 'the road'
        out.push({
          at: along,
          type,
          text: `${verb} ${type === 'continue' ? '' : 'onto '}${onto}`.replace('  ', ' '),
          road: nameOut,
        })
      }
    }
    out.push({ at: total, type: 'arrive', text: `Arrive at ${destName}`, road: '' })
    return out
  }

  progress(route, x, z) {
    const pts = route.points
    if (!pts || pts.length < 2) return { along: 0, off: Infinity, index: 0 }
    let bestD = Infinity
    let bestAlong = 0
    let along = 0
    let bestIndex = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const l2 = dx * dx + dz * dz
      let t = l2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0
      t = Math.max(0, Math.min(1, t))
      const px = a.x + dx * t
      const pz = a.z + dz * t
      const d = Math.hypot(x - px, z - pz)
      if (d < bestD) {
        bestD = d
        bestAlong = along + Math.sqrt(l2) * t
        bestIndex = i
      }
      along += Math.sqrt(l2)
    }
    return { along: bestAlong, off: bestD, index: bestIndex, total: along }
  }

  nextInstruction(route, along) {
    let next = null
    for (const ins of route.instructions) {
      if (ins.at > along + 2) {
        next = ins
        break
      }
    }
    return next || route.instructions[route.instructions.length - 1]
  }
}
