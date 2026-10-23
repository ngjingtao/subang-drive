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

const snapKey = (x, z) => `${Math.round(x * 10)},${Math.round(z * 10)}`
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

    const addOneWay = (a, b, w, name, ref, type) => {
      if (a === b || w < 0.4) return
      adj[a].push({ to: b, w, name, ref, type, oneway: true })
    }
    const addTwoWay = (a, b, w, name, ref, type) => {
      if (a === b || w < 0.4) return
      adj[a].push({ to: b, w, name, ref, type, oneway: false })
      adj[b].push({ to: a, w, name, ref, type, oneway: false })
    }

    for (const road of this.roads) {
      if (!road.p || road.p.length < 2) continue
      let prev = addNode(road.p[0][0], road.p[0][1])
      const oneWay = !!road.ow
      const oneWayBack = !!road.owb
      for (let i = 1; i < road.p.length; i++) {
        const [x, z] = road.p[i]
        const next = addNode(x, z)
        const w = dist2(road.p[i - 1][0], road.p[i - 1][1], x, z)
        const name = road.n || road.ref || ''
        const ref = road.ref || ''
        if (oneWay && !oneWayBack) addOneWay(prev, next, w, name, ref, road.t)
        else if (oneWayBack) addOneWay(next, prev, w, name, ref, road.t)
        else addTwoWay(prev, next, w, name, ref, road.t)
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

  nearestNode(x, z, maxDist = 220, headingX = 0, headingZ = 0) {
    if (!this.built) this.build()
    const gx = Math.floor(x / this.cell)
    const gz = Math.floor(z / this.cell)
    let best = -1
    let bestD = maxDist
    let bestFallback = -1
    let bestFallbackD = maxDist
    const checkHeading = Math.abs(headingX) + Math.abs(headingZ) > 0.01
    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        const list = this.grid.get(`${gx + ox},${gz + oz}`)
        if (!list) continue
        for (const i of list) {
          const n = this.nodes[i]
          const d = Math.hypot(n.x - x, n.z - z)
          if (d >= maxDist) continue
          if (d < bestFallbackD) {
            bestFallbackD = d
            bestFallback = i
          }
          if (!checkHeading) {
            if (d < bestD) {
              bestD = d
              best = i
            }
            continue
          }
          // Pick a node on the correct side of a dual carriageway: it must
          // have at least one outgoing edge pointing in the car's direction.
          let aligned = false
          for (const e of this.adj[i]) {
            const ex = this.nodes[e.to].x - n.x
            const ez = this.nodes[e.to].z - n.z
            const len = Math.hypot(ex, ez) || 1
            if ((ex / len) * headingX + (ez / len) * headingZ > 0.25) {
              aligned = true
              break
            }
          }
          if (aligned && d < bestD) {
            bestD = d
            best = i
          }
        }
      }
    }
    if (best < 0) best = bestFallback
    return best < 0 ? null : { index: best, dist: bestD === maxDist ? bestFallbackD : bestD }
  }

  nearestEdge(x, z, maxDist = 90, headingX = 0, headingZ = 0) {
    if (!this.built) this.build()
    const gx = Math.floor(x / this.cell)
    const gz = Math.floor(z / this.cell)
    const hlen = Math.hypot(headingX, headingZ)
    const checkHeading = hlen > 0.01
    if (checkHeading) {
      headingX /= hlen
      headingZ /= hlen
    }
    let best = null
    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        const list = this.grid.get(`${gx + ox},${gz + oz}`)
        if (!list) continue
        for (const u of list) {
          const a = this.nodes[u]
          for (const edge of this.adj[u]) {
            const b = this.nodes[edge.to]
            const dx = b.x - a.x
            const dz = b.z - a.z
            const l2 = dx * dx + dz * dz
            if (l2 < 0.01) continue
            const len = Math.sqrt(l2)
            if (checkHeading && (dx / len) * headingX + (dz / len) * headingZ < 0.25) continue
            let t = ((x - a.x) * dx + (z - a.z) * dz) / l2
            t = Math.max(0, Math.min(1, t))
            const px = a.x + dx * t
            const pz = a.z + dz * t
            const d = Math.hypot(x - px, z - pz)
            if (d > maxDist) continue
            const score = d + (edge.type && /_link$/.test(edge.type) ? 2.5 : 0)
            if (!best || score < best.score) {
              best = { u, v: edge.to, t, x: px, z: pz, dist: d, score, edge }
            }
          }
        }
      }
    }
    return best
  }

  route(from, to, destName = 'destination', heading = null) {
    this.build()
    const hx = heading && Number.isFinite(heading.x) ? heading.x : 0
    const hz = heading && Number.isFinite(heading.z) ? heading.z : 0
    const hlen = Math.hypot(hx, hz)
    const startHeadingX = hlen > 0 ? hx / hlen : 0
    const startHeadingZ = hlen > 0 ? hz / hlen : 0
    let startSources = []
    let startEdge = null
    // Start from the edge under the car. On a two-way road try both
    // endpoints, so A* can choose the direction instead of forcing a
    // U-turn or a little out-and-back at a junction.
    const nearStartEdge = this.nearestEdge(from.x, from.z, 75, startHeadingX, startHeadingZ)
    if (nearStartEdge) {
      startEdge = nearStartEdge
      const candidates = nearStartEdge.edge.oneway ? [nearStartEdge.v] : [nearStartEdge.u, nearStartEdge.v]
      for (const idx of [...new Set(candidates)]) {
        startSources.push({
          index: idx,
          dist: Math.hypot(from.x - this.nodes[idx].x, from.z - this.nodes[idx].z),
        })
      }
    }
    if (!startSources.length) {
      const s = this.nearestNode(from.x, from.z, 300, startHeadingX, startHeadingZ)
      if (!s) return null
      startSources.push(s)
    }
    const t = this.nearestNode(to.x, to.z, 300)
    if (!t) return null

    const n = this.nodes.length
    const g = new Float64Array(n).fill(Infinity)
    const prev = new Int32Array(n).fill(-1)
    const prevName = new Array(n).fill('')
    const prevRef = new Array(n).fill('')
    const closed = new Uint8Array(n)
    const heap = new MinHeap()
    const tx = this.nodes[t.index].x
    const tz = this.nodes[t.index].z

    for (const src of startSources) {
      g[src.index] = src.dist
      heap.push(src.index, src.dist + Math.hypot(this.nodes[src.index].x - tx, this.nodes[src.index].z - tz))
    }

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
      if (prev[u] === -1) break
      u = prev[u]
    }
    nodeIds.reverse()
    if (!nodeIds.length) return null
    const startIndex = nodeIds[0]
    const startInfo = startSources.find((src) => src.index === startIndex) || startSources[0]

    const points = [
      { x: from.x, z: from.z },
      ...nodeIds.map((i) => ({ x: this.nodes[i].x, z: this.nodes[i].z })),
      { x: to.x, z: to.z },
    ]
    const edgeNames = []
    // the little connector from the car to the first graph node
    edgeNames.push(startEdge ? (startEdge.edge.name || startEdge.edge.ref || '') : '')
    for (let i = 1; i < nodeIds.length; i++) edgeNames.push(prevName[nodeIds[i]] || prevRef[nodeIds[i]] || '')
    // ...and the short tail from the last road node to the pin
    edgeNames.push('')

    // If the pin lies on the last road edge before the snapped node, finish
    // at the pin instead of overshooting to that node and doubling back.
    if (points.length >= 4) {
      const a = points[points.length - 3]
      const b = points[points.length - 2]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const l2 = dx * dx + dz * dz
      if (l2 > 0.01) {
        let tproj = ((to.x - a.x) * dx + (to.z - a.z) * dz) / l2
        tproj = Math.max(0, Math.min(1, tproj))
        const px = a.x + dx * tproj
        const pz = a.z + dz * tproj
        const off = Math.hypot(to.x - px, to.z - pz)
        if (off < 9 && tproj > 0.04 && tproj < 0.96) {
          points.splice(points.length - 2, 2, { x: to.x, z: to.z })
          edgeNames.pop()
        }
      }
    }

    let total = 0
    for (let i = 0; i < points.length - 1; i++) total += dist2(points[i].x, points[i].z, points[i + 1].x, points[i + 1].z)
    const instructions = this.buildInstructions(points, edgeNames, total, destName)
    return {
      points,
      edgeNames,
      distance: total,
      instructions,
      startNode: startIndex,
      endNode: t.index,
      startDistance: startInfo.dist,
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
