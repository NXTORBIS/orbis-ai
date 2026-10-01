// src/shared/backdrop.ts
var particleCount = (width, height) => Math.round(width * height / 24e3);
function spawn(width, height, random = Math.random) {
  const angle = random() * Math.PI * 2;
  const speed = 0.03 + random() * 0.16;
  return {
    x: random() * width,
    y: random() * height,
    vx: Math.cos(angle) * speed,
    // Very slightly upward overall, which reads as drift rather than as rain.
    vy: Math.sin(angle) * speed - 0.02,
    // Mostly small points with a few larger glows.
    radius: 0.7 + random() ** 2 * 2.8,
    phase: random() * Math.PI * 2,
    twinkleSpeed: 0.5 + random() * 1.6
  };
}
function step(p, width, height) {
  p.x += p.vx;
  p.y += p.vy;
  if (p.x < -12) p.x = width + 12;
  else if (p.x > width + 12) p.x = -12;
  if (p.y < -12) p.y = height + 12;
  else if (p.y > height + 12) p.y = -12;
}
var twinkle = (p, time) => 0.45 + 0.55 * Math.abs(Math.sin(time * 7e-4 * p.twinkleSpeed + p.phase));
function makeGlowSprite(create) {
  const size = 64;
  const sprite = create();
  sprite.width = size;
  sprite.height = size;
  const g = sprite.getContext("2d");
  if (!g) return sprite;
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(220, 252, 255, 1)");
  gradient.addColorStop(0.16, "rgba(110, 225, 255, 0.95)");
  gradient.addColorStop(0.42, "rgba(56, 190, 255, 0.22)");
  gradient.addColorStop(1, "rgba(56, 190, 255, 0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  return sprite;
}
function startBackdrop(canvas2, page, options = { animated: true }) {
  const context = canvas2.getContext("2d");
  if (!context) return { resize: () => void 0, stop: () => void 0 };
  const ctx = context;
  const sprite = makeGlowSprite(() => page.createCanvas());
  let particles = [];
  let width = 0;
  let height = 0;
  let frame = 0;
  let stopped = false;
  const resize = () => {
    const dpr = Math.min(page.devicePixelRatio || 1, 2);
    width = canvas2.clientWidth || 0;
    height = canvas2.clientHeight || 0;
    canvas2.width = Math.round(width * dpr);
    canvas2.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    particles = Array.from({ length: particleCount(width, height) }, () => spawn(width, height));
    if (!options.animated) paint(0, false);
  };
  function paint(time, move) {
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      if (move) step(p, width, height);
      const size = p.radius * 7;
      ctx.globalAlpha = move ? twinkle(p, time) : 0.8;
      ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }
  const draw = (time) => {
    if (stopped) return;
    paint(time, true);
    frame = page.requestFrame(draw);
  };
  const onVisibility = () => {
    if (stopped || !options.animated) return;
    page.cancelFrame(frame);
    if (!page.hidden) frame = page.requestFrame(draw);
  };
  resize();
  if (options.animated) frame = page.requestFrame(draw);
  page.addEventListener("visibilitychange", onVisibility);
  return {
    resize,
    stop: () => {
      stopped = true;
      page.cancelFrame(frame);
      page.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

// orbis-ui/newtab/backdrop-mount.ts
function pageFor(doc) {
  return {
    get hidden() {
      return doc.hidden;
    },
    addEventListener: (type, listener) => doc.addEventListener(type, listener),
    removeEventListener: (type, listener) => doc.removeEventListener(type, listener),
    createCanvas: () => doc.createElement("canvas"),
    get devicePixelRatio() {
      return doc.defaultView ? doc.defaultView.devicePixelRatio : 1;
    },
    requestFrame: (run) => (doc.defaultView ?? globalThis).requestAnimationFrame(run),
    cancelFrame: (handle) => (doc.defaultView ?? globalThis).cancelAnimationFrame(handle)
  };
}
var running = null;
var canvas = null;
function setBackdrop(wanted, still) {
  if (!wanted) {
    running?.stop();
    running = null;
    canvas?.remove();
    canvas = null;
    return;
  }
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = "hud-particles";
    canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(canvas);
  }
  running?.stop();
  running = startBackdrop(canvas, pageFor(document), { animated: !still });
}
window.addEventListener("resize", () => running?.resize());
export {
  setBackdrop
};
