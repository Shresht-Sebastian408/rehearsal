// Decorative cursor: a gold ring that trails the pointer and drops a little marigold confetti.
// Mouse only, off for reduced-motion users, never hides the real cursor, and stops drawing when idle.
const enabled = matchMedia('(pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches;
if (enabled) start();

function start() {
  const canvas = document.createElement('canvas');
  canvas.className = 'cursor-fx';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');

  let colors;
  const readColors = () => {
    const css = getComputedStyle(document.documentElement);
    colors = { gold: css.getPropertyValue('--gold').trim(), accent: css.getPropertyValue('--accent').trim() };
  };
  readColors();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);

  let w = 0, h = 0;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth;
    h = innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    kick();
  };

  const OFF = -100;
  const mouse = { x: OFF, y: OFF };
  const ring = { x: OFF, y: OFF, r: 14 };
  let targetR = 14;
  const sparks = [];
  let running = false;

  const spark = (x, y, speed) => {
    if (sparks.length > 120) return;
    const a = Math.random() * Math.PI * 2;
    sparks.push({
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 0.4,
      size: 2.5 + Math.random() * 3,
      color: Math.random() < 0.7 ? colors.gold : colors.accent,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.25,
      life: 1,
    });
  };

  function kick() {
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  }

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const moved = Math.hypot(e.clientX - mouse.x, e.clientY - mouse.y);
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    targetR = e.target.closest?.('a, button, input, select, textarea, label, summary') ? 22 : 14;
    if (moved > 8) spark(mouse.x, mouse.y, 0.6);
    kick();
  }, { passive: true });

  addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    for (let i = 0; i < 14; i++) spark(e.clientX, e.clientY, 1.5 + Math.random() * 2);
    kick();
  }, { passive: true });

  // Pointer left the window: let the ring drift off-screen instead of freezing at the edge.
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) {
      mouse.x = mouse.y = OFF;
      kick();
    }
  });

  function frame() {
    ctx.clearRect(0, 0, w, h);
    ring.x += (mouse.x - ring.x) * 0.2;
    ring.y += (mouse.y - ring.y) * 0.2;
    ring.r += (targetR - ring.r) * 0.2;

    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = colors.gold;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= 0.97;
      s.vy += 0.05; // confetti drifts down
      s.rot += s.spin;
      s.life -= 0.016;
      if (s.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = s.life;
      ctx.fillStyle = s.color;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.fillRect(-s.size, -s.size / 2, s.size * 2, s.size);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    const settled = !sparks.length && Math.abs(mouse.x - ring.x) < 0.3 && Math.abs(mouse.y - ring.y) < 0.3 && Math.abs(targetR - ring.r) < 0.1;
    if (settled) running = false; // last frame stays on the canvas; no work until the mouse moves again
    else requestAnimationFrame(frame);
  }

  addEventListener('resize', resize);
  resize();
}
