/**
 * The atmosphere, actually making sound.
 *
 * Every sound here is built from noise and filters at the moment it plays, which has three consequences worth
 * knowing: it works with no network, it never loops audibly, and it only covers the sounds filtered noise genuinely
 * resembles. The ones that need a recording are listed as unavailable rather than approximated -- see
 * shared/student/atmosphere.ts for why that line is drawn where it is.
 *
 * Nothing starts by itself. The audio engine is created on the first play, after a real press, because a browser is
 * right to refuse audio nobody asked for and because a study tool that makes a noise when it opens is a study tool
 * somebody mutes for ever.
 */

interface Layer {
  noise: 'white' | 'pink' | 'brown'
  filter?: { type: 'lowpass' | 'highpass' | 'bandpass'; frequency: number; q?: number }
  wobble?: { rate: number; depth: number }
  drops?: { rate: number; decay: number; frequency: number }
  gain: number
}

interface Running {
  source: AudioBufferSourceNode
  gain: GainNode
  wobble?: OscillatorNode
  drops?: ReturnType<typeof setInterval>
  nodes: AudioNode[]
}

/** Ten seconds of noise, looped. Long enough that the loop is not a texture somebody starts hearing. */
const SECONDS = 10

export class Atmosphere {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  /**
   * A tap on the output, for anything that wants to move with the sound.
   *
   * Made only when something first asks: an analyser that nobody reads is a timer running for no reason, and this
   * engine is meant to be able to play for three hours without being noticed.
   */
  private analyser: AnalyserNode | null = null
  private readings: Uint8Array<ArrayBuffer> | null = null
  private readonly playing = new Map<string, Running>()
  private readonly buffers = new Map<string, AudioBuffer>()
  private volume = 0.5

  /** Whether anything is making a sound right now. */
  get active(): boolean {
    return this.playing.size > 0
  }

  get sounds(): string[] {
    return [...this.playing.keys()]
  }

  /**
   * How loud it is at this instant, 0 to 1.
   *
   * Zero whenever nothing is playing, there is no audio at all, or the browser will not give a reading -- so a
   * caller can use this without checking anything, and a page with no sound simply gets a still picture.
   */
  loudness(): number {
    if (this.playing.size === 0) return 0
    const started = this.start()
    if (!started) return 0
    if (!this.analyser) {
      try {
        const analyser = started.context.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.75
        started.master.connect(analyser)
        this.analyser = analyser
        this.readings = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
      } catch {
        return 0
      }
    }
    if (!this.analyser || !this.readings) return 0
    try {
      this.analyser.getByteTimeDomainData(this.readings)
    } catch {
      return 0
    }
    /*
     * Root mean square around the middle, not the peak.
     *
     * Noise is full of peaks and a peak-driven animation looks like a fault. The average is what a person actually
     * hears getting louder and quieter.
     */
    let sum = 0
    for (const reading of this.readings) {
      const offset = (reading - 128) / 128
      sum += offset * offset
    }
    const rms = Math.sqrt(sum / this.readings.length)
    return Math.max(0, Math.min(1, rms * 3.2))
  }

  private start(): { context: AudioContext; master: GainNode } | null {
    if (this.context && this.master) return { context: this.context, master: this.master }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    const context = new Ctor()
    const master = context.createGain()
    master.gain.value = this.volume
    master.connect(context.destination)
    this.context = context
    this.master = master
    return { context, master }
  }

  /**
   * Noise, made once per kind and reused.
   *
   * Pink and brown are the same white noise shaped: pink through a cheap but well-behaved filter bank, brown by
   * integrating. Both are what people mean by "that steady sound" -- white alone is harsher than anybody wants for
   * three hours.
   */
  private noiseBuffer(context: AudioContext, kind: Layer['noise']): AudioBuffer {
    const held = this.buffers.get(kind)
    if (held) return held
    const length = context.sampleRate * SECONDS
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)

    if (kind === 'white') {
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
    } else if (kind === 'brown') {
      let last = 0
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1
        last = (last + 0.02 * white) / 1.02
        data[i] = last * 3.5
      }
    } else {
      // Paul Kellett's pink-noise filter: six one-pole sections, which is the usual approximation and sounds right.
      let b0 = 0
      let b1 = 0
      let b2 = 0
      let b3 = 0
      let b4 = 0
      let b5 = 0
      let b6 = 0
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1
        b0 = 0.99886 * b0 + white * 0.0555179
        b1 = 0.99332 * b1 + white * 0.0750759
        b2 = 0.969 * b2 + white * 0.153852
        b3 = 0.8665 * b3 + white * 0.3104856
        b4 = 0.55 * b4 + white * 0.5329522
        b5 = -0.7616 * b5 - white * 0.016898
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
        b6 = white * 0.115926
      }
    }
    // The ends are faded into each other, so the loop point is not a click.
    const fade = Math.min(2000, Math.floor(length / 20))
    for (let i = 0; i < fade; i += 1) {
      const mix = i / fade
      data[i] = data[i] * mix + data[length - fade + i] * (1 - mix)
    }
    this.buffers.set(kind, buffer)
    return buffer
  }

  private layersFor(id: string): Layer[] {
    switch (id) {
      case 'brown':
        return [{ noise: 'brown', gain: 0.9, filter: { type: 'lowpass', frequency: 1600 } }]
      case 'pink':
        return [{ noise: 'pink', gain: 0.75 }]
      case 'white':
        return [{ noise: 'white', gain: 0.5, filter: { type: 'lowpass', frequency: 9000 } }]
      case 'rain':
        return [
          { noise: 'pink', gain: 0.5, filter: { type: 'bandpass', frequency: 1200, q: 0.6 }, wobble: { rate: 0.08, depth: 0.25 } },
          { noise: 'white', gain: 0.18, filter: { type: 'highpass', frequency: 3500 }, drops: { rate: 14, decay: 0.05, frequency: 5200 } }
        ]
      case 'ocean':
        return [{ noise: 'brown', gain: 0.95, filter: { type: 'lowpass', frequency: 900 }, wobble: { rate: 0.07, depth: 0.7 } }]
      case 'wind':
        return [{ noise: 'pink', gain: 0.6, filter: { type: 'bandpass', frequency: 500, q: 1.2 }, wobble: { rate: 0.05, depth: 0.6 } }]
      case 'space':
        return [{ noise: 'brown', gain: 1, filter: { type: 'lowpass', frequency: 180 }, wobble: { rate: 0.03, depth: 0.3 } }]
      default:
        return []
    }
  }

  /** Starts one sound, or changes how loud it already is. Returns false when there is nothing Orbis can generate. */
  play(id: string, gain = 1): boolean {
    const layers = this.layersFor(id)
    if (layers.length === 0) return false
    const engine = this.start()
    if (!engine) return false
    const { context, master } = engine
    if (context.state === 'suspended') void context.resume()

    const held = this.playing.get(id)
    if (held) {
      held.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, gain)), context.currentTime, 0.2)
      return true
    }

    const outer = context.createGain()
    outer.gain.value = 0
    outer.connect(master)
    const nodes: AudioNode[] = [outer]

    let first: AudioBufferSourceNode | null = null
    let wobbleOsc: OscillatorNode | undefined
    let drops: ReturnType<typeof setInterval> | undefined

    for (const layer of layers) {
      const source = context.createBufferSource()
      source.buffer = this.noiseBuffer(context, layer.noise)
      source.loop = true
      let tail: AudioNode = source
      if (layer.filter) {
        const filter = context.createBiquadFilter()
        filter.type = layer.filter.type
        filter.frequency.value = layer.filter.frequency
        if (layer.filter.q !== undefined) filter.Q.value = layer.filter.q
        tail.connect(filter)
        tail = filter
        nodes.push(filter)
      }
      const layerGain = context.createGain()
      layerGain.gain.value = layer.gain
      tail.connect(layerGain)
      layerGain.connect(outer)
      nodes.push(layerGain, source)

      if (layer.wobble) {
        // A slow oscillator on the volume. Without it, generated sound is recognisably a machine within a minute.
        const osc = context.createOscillator()
        const depth = context.createGain()
        osc.frequency.value = layer.wobble.rate
        depth.gain.value = layer.wobble.depth * layer.gain
        osc.connect(depth)
        depth.connect(layerGain.gain)
        osc.start()
        wobbleOsc = osc
        nodes.push(depth)
      }
      if (layer.drops) {
        const every = 1000 / layer.drops.rate
        drops = setInterval(() => {
          if (!this.context) return
          const burst = this.context.createGain()
          const band = this.context.createBiquadFilter()
          band.type = 'bandpass'
          band.frequency.value = layer.drops!.frequency * (0.7 + Math.random() * 0.6)
          band.Q.value = 6
          const noise = this.context.createBufferSource()
          noise.buffer = this.noiseBuffer(this.context, 'white')
          noise.loop = true
          const now = this.context.currentTime
          burst.gain.setValueAtTime(0.14 + Math.random() * 0.1, now)
          burst.gain.exponentialRampToValueAtTime(0.0001, now + layer.drops!.decay)
          noise.connect(band)
          band.connect(burst)
          burst.connect(outer)
          noise.start(now)
          noise.stop(now + layer.drops!.decay + 0.05)
        }, every)
      }
      source.start()
      first ??= source
    }

    // Faded in: an atmosphere that arrives at full volume is a jump scare.
    outer.gain.setTargetAtTime(Math.max(0, Math.min(1, gain)), context.currentTime, 0.6)
    if (first) this.playing.set(id, { source: first, gain: outer, wobble: wobbleOsc, drops, nodes })
    return true
  }

  /** Fades one sound out and lets go of everything it used. */
  stop(id: string): void {
    const held = this.playing.get(id)
    if (!held || !this.context) return
    this.playing.delete(id)
    if (held.drops) clearInterval(held.drops)
    const end = this.context.currentTime + 0.5
    held.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.2)
    try {
      held.wobble?.stop(end)
      held.source.stop(end)
    } catch {
      // Already stopped. Nothing to do and nothing worth saying.
    }
    setTimeout(() => {
      for (const node of held.nodes) node.disconnect()
    }, 700)
  }

  stopAll(): void {
    for (const id of [...this.playing.keys()]) this.stop(id)
  }

  /** The whole atmosphere's volume, kept apart from music and from the interface's own sounds. */
  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value))
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.1)
  }

  /** Plays exactly this mix: starts what is missing, stops what is not wanted, adjusts the rest. */
  setMix(layers: Readonly<Record<string, number>>): void {
    for (const id of [...this.playing.keys()]) if (!(id in layers)) this.stop(id)
    for (const [id, gain] of Object.entries(layers)) this.play(id, gain)
  }

  /** Lets go of the audio engine entirely. Called when Student is closed, so nothing is left running. */
  private forgetAnalyser(): void {
    try {
      this.analyser?.disconnect()
    } catch {
      // It was already gone.
    }
    this.analyser = null
    this.readings = null
  }

  release(): void {
    this.forgetAnalyser()
    this.stopAll()
    const context = this.context
    this.context = null
    this.master = null
    this.buffers.clear()
    setTimeout(() => void context?.close().catch(() => undefined), 800)
  }
}

/** One engine for the window. Two would be two sets of speakers fighting over the same mix. */
let shared: Atmosphere | null = null

export function atmosphere(): Atmosphere {
  shared ??= new Atmosphere()
  return shared
}
