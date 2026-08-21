/* =============================================================
 *  theme.js — config.theme の色を CSS 変数に流し込む＋花火エフェクト
 * ============================================================= */
(function (global) {
  'use strict';
  const CFG = global.APP_CONFIG;

  /* ---------- CSS 変数の適用 ---------- */
  function applyTheme() {
    const t = CFG.theme, r = document.documentElement.style;
    r.setProperty('--bg-top',    t.bgTop);
    r.setProperty('--bg-bottom', t.bgBottom);
    r.setProperty('--surface',   t.surface);
    r.setProperty('--border',    t.border);
    r.setProperty('--lantern',   t.lantern);
    r.setProperty('--gold',      t.gold);
    r.setProperty('--hanabi-a',  t.hanabiA);
    r.setProperty('--hanabi-b',  t.hanabiB);
    r.setProperty('--hanabi-c',  t.hanabiC);
    r.setProperty('--text',      t.text);
    r.setProperty('--muted',     t.textMuted);
  }
  applyTheme();
  document.addEventListener('DOMContentLoaded', applyTheme);

  /* ---------- 花火エフェクト ---------- */
  function Fireworks(canvas) {
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = Math.min(devicePixelRatio || 1, 2);
    const rockets = [], sparks = [];
    const COLORS = [CFG.theme.hanabiA, CFG.theme.hanabiB, CFG.theme.hanabiC,
                    CFG.theme.gold, CFG.theme.lantern, '#ffffff'];

    function resize() {
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    addEventListener('resize', resize);

    function launch(x, targetY, color) {
      rockets.push({
        x: x != null ? x : W * (0.15 + Math.random() * 0.7),
        y: H + 10,
        vy: -(H * 0.011 + Math.random() * H * 0.004),
        ty: targetY != null ? targetY : H * (0.12 + Math.random() * 0.35),
        color: color || COLORS[(Math.random() * COLORS.length) | 0]
      });
    }

    function burst(x, y, color) {
      const n = 46 + ((Math.random() * 34) | 0);
      const speed = 1.7 + Math.random() * 1.6;
      const ring = Math.random() < 0.45;
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.12;
        const s = ring ? speed : speed * (0.35 + Math.random() * 0.9);
        sparks.push({
          x, y,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: 1, decay: 0.008 + Math.random() * 0.012,
          color: Math.random() < 0.18 ? '#ffffff' : color,
          size: 1.2 + Math.random() * 1.6
        });
      }
    }

    function frame() {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.19)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.y += r.vy; r.vy += 0.06;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 2.1, 0, 7);
        ctx.fillStyle = r.color;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(r.x, r.y); ctx.lineTo(r.x, r.y + 14);
        ctx.strokeStyle = r.color; ctx.globalAlpha = 0.22;
        ctx.lineWidth = 1.4; ctx.stroke(); ctx.globalAlpha = 1;
        if (r.y <= r.ty || r.vy >= 0) { burst(r.x, r.y, r.color); rockets.splice(i, 1); }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.021; p.vx *= 0.988; p.vy *= 0.988;
        p.life -= p.decay;
        if (p.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, 7);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      requestAnimationFrame(frame);
    }
    frame();

    let timer = null;
    if (CFG.fireworks.enabled) {
      timer = setInterval(() => {
        if (document.hidden) return;
        launch();
        if (Math.random() < 0.3) setTimeout(launch, 320);
      }, CFG.fireworks.ambientIntervalMs);
      launch();
    }

    return {
      launch,
      celebrate(n) {
        const count = n || CFG.fireworks.celebrateBurst;
        for (let i = 0; i < count; i++) setTimeout(() => launch(), i * 150);
      },
      destroy() { clearInterval(timer); }
    };
  }

  global.Fireworks = Fireworks;
})(window);
