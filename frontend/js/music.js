/**
 * LoL Monopoly — musique d'ambiance générée par le navigateur (Web Audio), sans fichier.
 *
 * Une boucle épique et calme en ré mineur : nappes de cordes (accords Rém – Si♭ – Fa – Do),
 * basse ronde, notes de harpe qui s'égrènent au hasard dans l'accord, et un tambour grave
 * discret à chaque mesure, le tout dans une réverbération de grande salle.
 *
 * Trois intensités (setIntensity) : 0 calme ; 1 tension (Baron, Ancien, événement) : plus rapide,
 * tambours, harmonie plus sombre ; 2 climax (fin de partie, joueur en danger) : basse martelée,
 * caisse claire et accents de cuivres.
 *
 * window.LolMusic.start() / stop() / setVolume(0..1) / setEnabled(bool) / setIntensity(0..2) / enabled
 */
(() => {
  const STORAGE = 'lolm.music';
  const BARS = [4.2, 3.5, 2.9]; // durée d'une mesure (s) selon l'intensité
  const BARS_PER_CHORD = 2;
  // accords : fondamentale (MIDI) et notes de l'accord
  const CHORDS = [
    { root: 50, notes: [62, 65, 69, 74] }, // Rém
    { root: 46, notes: [58, 62, 65, 70] }, // Si♭
    { root: 53, notes: [60, 65, 69, 72] }, // Fa
    { root: 48, notes: [60, 64, 67, 72] }, // Do
  ];
  // tension : Rém – Do – Si♭ – La (dominante, plus inquiétante)
  const TENSE = [
    { root: 50, notes: [62, 65, 69, 74] },
    { root: 48, notes: [60, 64, 67, 72] },
    { root: 46, notes: [58, 62, 65, 70] },
    { root: 45, notes: [57, 61, 64, 69] },
  ];
  const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
  let intensity = 0;

  let ctx = null;
  let master = null;
  let reverb = null;
  let timer = 0;
  let nextBar = 0;
  let barIndex = 0;
  let playing = false;
  let volume = 0.35;
  let enabled = (() => {
    try { return localStorage.getItem(STORAGE) !== 'off'; } catch { return true; }
  })();

  function setup() {
    if (ctx) return;
    ctx = window.App?.audio ?? new AudioContext();
    if (window.App) window.App.audio = ctx;
    master = ctx.createGain();
    master.gain.value = 0;
    // réverbération : réponse impulsionnelle de bruit qui décroît (~3 s)
    reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    reverb.connect(wet).connect(master);
    master.connect(ctx.destination);
  }

  /** Envoie un son à la fois en direct et dans la réverbération. */
  function out(node, dry = 0.6) {
    const d = ctx.createGain();
    d.gain.value = dry;
    node.connect(d).connect(master);
    node.connect(reverb);
  }

  function pad(chord, t, dur) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.linearRampToValueAtTime(1100 + intensity * 500, t + dur * 0.5);
    filter.frequency.linearRampToValueAtTime(600, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.05, t + 1.6);
    env.gain.setValueAtTime(0.05, t + dur - 1.4);
    env.gain.linearRampToValueAtTime(0, t + dur + 0.6);
    filter.connect(env);
    out(env, 0.5);
    for (const n of chord.notes.slice(0, 3)) {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = hz(n - 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + dur + 0.8);
      }
    }
  }

  function bass(chord, t, dur) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = hz(chord.root - 12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.09, t + 0.4);
    env.gain.exponentialRampToValueAtTime(0.02, t + dur);
    env.gain.linearRampToValueAtTime(0, t + dur + 0.3);
    osc.connect(env);
    out(env, 0.9);
    osc.start(t);
    osc.stop(t + dur + 0.4);
  }

  function harp(midi, t, gain = 0.05) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = hz(midi);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    osc.connect(env);
    out(env, 0.45);
    osc.start(t);
    osc.stop(t + 2.3);
  }

  function drum(t, gain = 0.22) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.35);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(env);
    out(env, 0.8);
    osc.start(t);
    osc.stop(t + 1);
  }

  /** Caisse claire : bruit filtré, sec. */
  function snare(t, gain = 0.07) {
    const len = Math.floor(ctx.sampleRate * 0.25);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1200;
    const env = ctx.createGain();
    env.gain.value = gain;
    src.connect(filter).connect(env);
    out(env, 0.7);
    src.start(t);
  }

  /** Accent de cuivres : accord court et brillant. */
  function brass(chord, t, gain = 0.028) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, t);
    filter.frequency.linearRampToValueAtTime(2600, t + 0.12);
    filter.frequency.exponentialRampToValueAtTime(700, t + 0.7);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.05);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    filter.connect(env);
    out(env, 0.6);
    for (const n of chord.notes.slice(0, 3)) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz(n);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + 1);
    }
  }

  /** Basse martelée (croches) pour le climax. */
  function ostinato(chord, t, bar) {
    for (let k = 0; k < 8; k++) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = hz(chord.root - 12 + (k % 4 === 3 ? 7 : 0));
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      const env = ctx.createGain();
      const s0 = t + (k * bar) / 8;
      env.gain.setValueAtTime(0, s0);
      env.gain.linearRampToValueAtTime(0.045, s0 + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, s0 + bar / 8);
      osc.connect(filter).connect(env);
      out(env, 0.85);
      osc.start(s0);
      osc.stop(s0 + bar / 8 + 0.05);
    }
  }

  /** Programme une mesure : nappe et basse au début de chaque accord, harpe et tambour. */
  function scheduleBar(t) {
    const BAR = BARS[intensity];
    const chords = intensity ? TENSE : CHORDS;
    const chord = chords[Math.floor(barIndex / BARS_PER_CHORD) % chords.length];
    if (barIndex % BARS_PER_CHORD === 0) {
      pad(chord, t, BAR * BARS_PER_CHORD);
      if (intensity < 2) bass(chord, t, BAR * BARS_PER_CHORD);
    }
    if (intensity >= 1) {
      // tension : tambours sur chaque temps, plus forts sur les temps forts
      for (let k = 1; k < 4; k++) drum(t + (k * BAR) / 4, k === 2 ? 0.14 : 0.09);
    }
    if (intensity >= 2) {
      ostinato(chord, t, BAR);
      snare(t + BAR / 4);
      snare(t + (3 * BAR) / 4);
      if (barIndex % 2 === 0) brass(chord, t);
    }
    // harpe : quelques notes de l'accord, plus haut, en arpège un peu libre
    const steps = 8;
    for (let k = 0; k < steps; k++) {
      if (Math.random() < (k % 2 ? 0.35 : 0.6)) {
        const n = chord.notes[Math.floor(Math.random() * chord.notes.length)] + (Math.random() < 0.3 ? 12 : 0);
        harp(n, t + (k * BAR) / steps + Math.random() * 0.03, 0.035 + Math.random() * 0.025);
      }
    }
    drum(t, barIndex % 4 === 0 ? 0.24 : 0.15);
    if (barIndex % 4 === 3) drum(t + BAR * 0.75, 0.1);
    barIndex += 1;
  }

  function tick() {
    while (nextBar < ctx.currentTime + 1.5) {
      const bar = BARS[intensity];
      scheduleBar(nextBar);
      nextBar += bar;
    }
  }

  function fadeTo(value, seconds) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(value, now + seconds);
  }

  const LolMusic = {
    get enabled() { return enabled; },
    get playing() { return playing; },
    /** Lance la boucle (si la musique est activée et le volume non nul). */
    start() {
      if (!enabled || playing || volume <= 0) return;
      try {
        setup();
        if (ctx.state === 'suspended') ctx.resume();
        playing = true;
        nextBar = ctx.currentTime + 0.1;
        barIndex = 0;
        tick();
        timer = setInterval(tick, 250);
        fadeTo(volume * 0.6, 3);
      } catch { playing = false; }
    },
    stop() {
      if (!playing) return;
      playing = false;
      clearInterval(timer);
      try { fadeTo(0, 1.2); } catch { /* rien */ }
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (!playing) return;
      if (volume <= 0) this.stop();
      else fadeTo(volume * 0.6, 0.4);
    },
    /** 0 calme, 1 tension, 2 climax (prend effet à la mesure suivante). */
    setIntensity(level) {
      intensity = Math.max(0, Math.min(2, Math.round(Number(level) || 0)));
    },
    get intensity() { return intensity; },
    setEnabled(on) {
      enabled = Boolean(on);
      try { localStorage.setItem(STORAGE, enabled ? 'on' : 'off'); } catch { /* rien */ }
    },
  };
  window.LolMusic = LolMusic;
})();
