export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      speed: document.getElementById('speed'),
      gear: document.getElementById('gear'),
      rpmArc: document.getElementById('rpm-arc'),
      locRoad: document.getElementById('loc-road'),
      locArea: document.getElementById('loc-area'),
      timeLabel: document.getElementById('time-label'),
      camLabel: document.getElementById('btn-cam'),
      toast: document.getElementById('toast'),
      soundBtn: document.getElementById('btn-sound'),
      pauseLoc: document.getElementById('pause-loc'),
      wcTime: document.getElementById('wc-time'),
      roadRef: document.getElementById('road-ref'),
      roadBotName: document.getElementById('road-bot-name'),
      roadGuide: document.getElementById('roadguide'),
      guideText: document.getElementById('guide-text'),
    }
    this.lastRoad = ''
    this.lastRef = ''
    this._guideText = ''
    this._guideAllow = null
    this.toastTimer = 0
    this.lastSpeed = -1
    this.lastGear = ''
  }

  show() { this.el.hud.classList.remove('hidden') }
  hide() { this.el.hud.classList.add('hidden') }

  setCamera(name) {
    const labels = { cockpit: 'COCKPIT', chase: 'CHASE', hood: 'HOOD' }
    this.el.camLabel.textContent = labels[name] || name.toUpperCase()
  }

  setTimeLabel(label) {
    this.el.timeLabel.textContent = label
    if (this.el.wcTime) this.el.wcTime.textContent = label
  }

  setSound(muted) {
    this.el.soundBtn.classList.toggle('off', muted)
  }

  setLocation(road, area = 'USJ 3 · Subang Jaya', ref = '') {
    const name = road || 'Off the tarmac'
    if (name !== this.lastRoad || ref !== this.lastRef) {
      this.lastRoad = name
      this.lastRef = ref
      this.el.locRoad.textContent = name
      this.el.pauseLoc.textContent = name
      this.el.roadBotName.textContent = name
      const shortRef = ref ? ref.split(/\s+/)[0] : ''
      if (shortRef) {
        this.el.roadRef.textContent = shortRef
        this.el.roadRef.classList.add('show')
      } else {
        this.el.roadRef.classList.remove('show')
      }
    }
    if (area && this.el.locArea.textContent !== area) this.el.locArea.textContent = area
  }

  update(state) {
    const kmh = Math.round(state.speedKmh)
    if (kmh !== this.lastSpeed) {
      this.lastSpeed = kmh
      this.el.speed.textContent = String(kmh)
    }
    if (state.gearLabel !== this.lastGear) {
      this.lastGear = state.gearLabel
      this.el.gear.textContent = state.gearLabel
    }

    const t = Math.min(1, state.rpm / 7000)
    const circ = 405
    this.el.rpmArc.style.strokeDasharray = `${(circ * t).toFixed(1)} 541`
  }

  setGuide(text, allow = false) {
    if (text === this._guideText && allow === this._guideAllow) return
    this._guideText = text
    this._guideAllow = allow
    this.el.guideText.textContent = text
    this.el.roadGuide.classList.toggle('allow', allow)
  }

  toast(text, ms = 2200) {
    this.el.toast.textContent = text
    this.el.toast.classList.add('show')
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('show'), ms)
  }
}
