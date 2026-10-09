// Viewport camera for physics simulators.
// Pure state machine — no React, no DOM. The simulation loop calls updateCamera
// each frame with the tracked body's screen-space focus point and velocity;
// the camera returns a pixel offset to apply via ctx.translate(-x, -y) so the
// visible region follows the body while world coordinates stay fixed.
//
// Modes:
//   'none'              — camera disabled, offset stays (0,0)
//   'edge'              — shift only when the body crosses a margin band
//   'continuous'        — keep the body centered, but freeze while resting
//   'follow-until-stop' — continuous until the body rests, then lock until reset
//
// Rest detection: when |velocity| < restEps for restFrames consecutive frames
// the body is considered stationary and the camera stops tracking (and, in
// 'follow-until-stop', locks permanently until reset).

export function createCamera() {
  return { x: 0, y: 0, manual: false, resting: 0, locked: false, everMoved: false };
}

// focus: {x, y} screen-pixel position of the body in the zero-camera frame.
// velocity: {x, y} in screen-pixel/s — only |velocity| is used for rest gating.
export function updateCamera(cam, focus, velocity, w, h, opts = {}) {
  const {
    mode = 'edge',
    margin = 0.18,
    smoothing = 0.10,
    threshold = 0.5,
    restEps = 2,
    restFrames = 30,
  } = opts;

  if (mode === 'none' || cam.manual) return cam;

  const speed = Math.hypot(velocity?.x || 0, velocity?.y || 0);
  const resting = speed < restEps;

  if (!resting) {
    cam.resting = 0;
    cam.locked = false;
    cam.everMoved = true;
  } else {
    cam.resting += 1;
  }

  // Only honour the lock once the body has actually moved and then settled.
  // This prevents the camera from locking at t=0 (before the body starts).
  if (mode === 'follow-until-stop' && cam.everMoved && cam.locked) return cam;
  if (mode === 'follow-until-stop' && cam.everMoved && cam.resting >= restFrames) {
    cam.locked = true; return cam;
  }

  let desiredX = cam.x, desiredY = cam.y;
  const ax = focus.x - cam.x, ay = focus.y - cam.y;

  if (mode === 'continuous' || mode === 'follow-until-stop') {
    if (!resting) { desiredX = focus.x - w / 2; desiredY = focus.y - h / 2; }
  } else {
    // edge: only shift when the body crosses a margin band
    const left = w * margin, right = w * (1 - margin);
    const top = h * margin, bottom = h * (1 - margin);
    if (ax < left) desiredX = focus.x - left;
    else if (ax > right) desiredX = focus.x - right;
    if (ay < top) desiredY = focus.y - top;
    else if (ay > bottom) desiredY = focus.y - bottom;
  }

  const dx = desiredX - cam.x, dy = desiredY - cam.y;
  if (Math.abs(dx) > threshold) cam.x += dx * smoothing;
  if (Math.abs(dy) > threshold) cam.y += dy * smoothing;

  // Hard clamp: guarantee the tracked body never leaves the viewport.
  // Overrides any smoothing lag so a fast-moving body stays on-screen.
  const pad = Math.min(w, h) * 0.08;
  const sx = focus.x - cam.x, sy = focus.y - cam.y;
  if (sx < pad) cam.x = focus.x - pad;
  else if (sx > w - pad) cam.x = focus.x - (w - pad);
  if (sy < pad) cam.y = focus.y - pad;
  else if (sy > h - pad) cam.y = focus.y - (h - pad);
  return cam;
}