/**
 * Tiny procedural engine + tyre noise synth. No audio files, instant load,
 * works on iOS after the first user gesture.
 */
export class CarAudio {
  constructor() {
    this.ctx = null
    this.started = false
    this.muted = false
    this.paused = false
    this.ready = false
  }

  async start() {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume()
      return
    }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    try {
      this.ctx = new AC()
    } catch {
      return
    }
    await this.ctx.resume()
    this.started = true

    const ctx = this.ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(ctx.destination)

    // engine bus
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0.0
    this.lowpass = ctx.createBiquadFilter()
    this.lowpass.type = 'lowpass'
    this.lowpass.frequency.value = 700
    this.lowpass.Q.value = 0.8
    this.engineGain.connect(this.lowpass)
    this.lowpass.connect(this.master)

    this.osc1 = ctx.createOscillator()
    this.osc1.type = 'sawtooth'
    this.osc1.frequency.value = 55
    const g1 = ctx.createGain()
    g1.gain.value = 0.36
    this.osc1.connect(g1).connect(this.engineGain)

    this.osc2 = ctx.createOscillator()
    this.osc2.type = 'square'
    this.osc2.frequency.value = 110
    this.osc2.detune.value = 6
    const g2 = ctx.createGain()
    g2.gain.value = 0.1
    this.osc2.connect(g2).connect(this.engineGain)

    this.osc3 = ctx.createOscillator()
    this.osc3.type = 'triangle'
    this.osc3.frequency.value = 27
    const g3 = ctx.createGain()
    g3.gain.value = 0.18
    this.osc3.connect(g3).connect(this.engineGain)

    this.osc1.start()
    this.osc2.start()
    this.osc3.start()

    // tyre / wind noise
    const bufferSize = ctx.sampleRate * 2
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1
    this.noise = ctx.createBufferSource()
    this.noise.buffer = noiseBuffer
    this.noise.loop = true
    this.noiseFilter = ctx.createBiquadFilter()
    this.noiseFilter.type = 'bandpass'
    this.noiseFilter.frequency.value = 700
    this.noiseFilter.Q.value = 0.45
    this.noiseGain = ctx.createGain()
    this.noiseGain.gain.value = 0.0
    this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master)
    this.noise.start()

    this.ready = true
  }

  update({ rpm = 900, speed = 0, throttle = 0, onRoad = true }) {
    if (!this.ready || !this.ctx) return
    const t = this.ctx.currentTime
    const f = Math.max(24, rpm / 30)
    const targetF = f
    this.osc1.frequency.setTargetAtTime(targetF, t, 0.06)
    this.osc2.frequency.setTargetAtTime(targetF * 2.01, t, 0.06)
    this.osc3.frequency.setTargetAtTime(targetF * 0.5, t, 0.08)
    this.lowpass.frequency.setTargetAtTime(420 + rpm * 0.32 + throttle * 400, t, 0.1)

    const speedNorm = Math.min(1, speed / 45)
    const engine = this.paused ? 0 : 0.026 + throttle * 0.05 + speedNorm * 0.03
    this.engineGain.gain.setTargetAtTime(engine, t, 0.09)
    this.noiseGain.gain.setTargetAtTime(this.paused ? 0 : speedNorm * 0.032 + (onRoad ? 0 : 0.006), t, 0.12)
    this.noiseFilter.frequency.setTargetAtTime(500 + speedNorm * 1300, t, 0.15)
  }

  setPaused(paused) {
    this.paused = paused
    if (this.ready) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15)
      this.noiseGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15)
    }
  }

  setMuted(muted) {
    this.muted = muted
    if (this.ready) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.08)
    }
  }

  horn() {
    if (!this.ready || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.16, t + 0.02)
    g.gain.setValueAtTime(0.16, t + 0.35)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55)
    g.connect(this.master)
    for (const freq of [415, 520]) {
      const o = ctx.createOscillator()
      o.type = 'square'
      o.frequency.value = freq
      o.connect(g)
      o.start(t)
      o.stop(t + 0.58)
    }
  }
}
