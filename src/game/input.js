const ACTION_KEYS = {
  KeyC: 'camera',
  KeyT: 'time',
  KeyR: 'respawn',
  KeyM: 'mute',
  KeyH: 'horn',
  Escape: 'pause',
  KeyP: 'pause',
}

export class Input {
  constructor(canvas, { onAction } = {}) {
    this.canvas = canvas
    this.onAction = onAction || (() => {})
    this.keys = new Set()
    this.touch = {
      throttle: false,
      brake: false,
      left: false,
      right: false,
      handbrake: false,
    }
    this.look = { yaw: 0, pitch: 0, dragging: false, lastActive: 0 }
    this.enabled = true
    this._drag = null
    this._bind()
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
      if (e.repeat) return
      this.keys.add(e.code)
      const action = ACTION_KEYS[e.code]
      if (action) this.onAction(action)
    })
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code)
    })
    window.addEventListener('blur', () => this.keys.clear())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.keys.clear()
    })

    // dragging to look around
    const el = this.canvas
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return
      if (e.target !== el) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY }
      this.look.dragging = true
      el.classList.add('dragging')
      try { el.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    })
    el.addEventListener('pointermove', (e) => {
      if (!this._drag || e.pointerId !== this._drag.id) return
      const dx = e.clientX - this._drag.lx
      const dy = e.clientY - this._drag.ly
      this._drag.lx = e.clientX
      this._drag.ly = e.clientY
      this.look.yaw -= dx * 0.0042
      this.look.pitch -= dy * 0.0034
      this.look.yaw = Math.max(-1.55, Math.min(1.55, this.look.yaw))
      this.look.pitch = Math.max(-0.5, Math.min(0.55, this.look.pitch))
      this.look.lastActive = performance.now()
    })
    const end = (e) => {
      if (!this._drag || e.pointerId !== this._drag.id) return
      this._drag = null
      this.look.dragging = false
      el.classList.remove('dragging')
    }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('lostpointercapture', end)
    el.addEventListener('contextmenu', (e) => e.preventDefault())

    // touch buttons
    const bindHold = (id, key) => {
      const node = document.getElementById(id)
      if (!node) return
      const on = (e) => {
        e.preventDefault()
        this.touch[key] = true
        node.classList.add('active')
        try { node.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      }
      const off = (e) => {
        e.preventDefault()
        this.touch[key] = false
        node.classList.remove('active')
      }
      node.addEventListener('pointerdown', on)
      node.addEventListener('pointerup', off)
      node.addEventListener('pointercancel', off)
      node.addEventListener('pointerleave', off)
    }
    bindHold('t-gas', 'throttle')
    bindHold('t-brake', 'brake')
    bindHold('t-left', 'left')
    bindHold('t-right', 'right')
    bindHold('t-case', 'handbrake')

    const tap = (id, action) => {
      const node = document.getElementById(id)
      if (!node) return
      node.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        node.classList.add('active')
        this.onAction(action)
      })
      const off = () => node.classList.remove('active')
      node.addEventListener('pointerup', off)
      node.addEventListener('pointercancel', off)
      node.addEventListener('pointerleave', off)
    }
    tap('t-cam', 'camera')
    tap('btn-cam', 'camera')
    tap('btn-time', 'time')
    tap('btn-sound', 'mute')
    tap('btn-help', 'pause')
  }

  setLook(yaw, pitch) {
    this.look.yaw = yaw
    this.look.pitch = pitch
    this.look.lastActive = performance.now()
  }

  recenterLook() {
    this.look.yaw = 0
    this.look.pitch = 0
  }

  get throttle() {
    return (this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.touch.throttle) ? 1 : 0
  }

  get brake() {
    return (this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.touch.brake) ? 1 : 0
  }

  get steer() {
    let s = 0
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.touch.left) s += 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.touch.right) s -= 1
    return s
  }

  get handbrake() {
    return this.keys.has('Space') || this.touch.handbrake
  }

  state() {
    return {
      throttle: this.throttle,
      brake: this.brake,
      steer: this.steer,
      handbrake: this.handbrake,
    }
  }
}
