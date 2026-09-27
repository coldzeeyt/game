// On-screen buttons for phones and tablets, drawn as 8-bit pixel art with the
// game's own font and palette. They press whatever keys are bound in
// Settings > Controls, so every screen (menus included) works with touch.
(() => {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) return;

  const SCALE = 3; // pixel art is drawn small, then scaled up crisply

  // --- button faces -------------------------------------------------------
  function pixelCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // Square D-pad / pause key with a notched pixel border.
  function squareFace(draw, pressed) {
    const c = pixelCanvas(20, 20);
    const x = c.getContext('2d');
    const off = pressed ? 1 : 0;
    x.fillStyle = '#000000';
    x.fillRect(1, 2, 18, 18); // drop shadow
    x.fillStyle = pressed ? '#3cbcfc' : '#1c1048';
    x.fillRect(1, 1 + off, 18, 17);
    x.fillStyle = '#a4e4fc';
    x.fillRect(2, off, 16, 1);
    x.fillRect(2, 17 + off, 16, 1);
    x.fillRect(0, 2 + off, 1, 14);
    x.fillRect(19, 2 + off, 1, 14);
    x.fillStyle = pressed ? '#fcfcfc' : '#342468';
    x.fillRect(2, 2 + off, 16, 1); // top highlight
    draw(x, off);
    return c.toDataURL();
  }

  // Pixel arrow pointing in a direction.
  function arrow(dir) {
    return (x, off) => {
      x.fillStyle = '#fcfcfc';
      for (let i = 0; i < 5; i++) {
        const len = 1 + i * 2;
        if (dir === 'left') x.fillRect(6 + i, 9 - i + off, 1, len);
        if (dir === 'right') x.fillRect(13 - i, 9 - i + off, 1, len);
        if (dir === 'up') x.fillRect(9 - i, 6 + i + off, len, 1);
        if (dir === 'down') x.fillRect(9 - i, 12 - i + off, len, 1);
      }
    };
  }

  const pauseIcon = (x, off) => {
    x.fillStyle = '#fcfcfc';
    x.fillRect(6, 5 + off, 3, 9);
    x.fillRect(11, 5 + off, 3, 9);
  };

  // Round NES-style action button with a label.
  function roundFace(label, color, dark, pressed) {
    const c = pixelCanvas(34, 36);
    const x = c.getContext('2d');
    const off = pressed ? 2 : 0;
    const disc = (cx, cy, r, col) => {
      x.fillStyle = col;
      for (let j = -r; j <= r; j++) {
        const h = Math.floor(Math.sqrt(r * r - j * j));
        x.fillRect(cx - h, cy + j, h * 2 + 1, 1);
      }
    };
    disc(17, 19, 16, '#000000'); // base / shadow
    disc(17, 17 + off, 16, '#000000');
    disc(17, 17 + off, 15, pressed ? dark : color);
    if (!pressed) {
      x.fillStyle = 'rgba(255,255,255,0.45)';
      x.fillRect(8, 7, 5, 2);
      x.fillRect(7, 9, 2, 4);
    }
    drawText(x, label, 17, 14 + off, '#fcfcfc', 1, 'center');
    return c.toDataURL();
  }

  // --- layout ---------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    #touch { position: fixed; inset: 0; pointer-events: none; z-index: 5; user-select: none; -webkit-user-select: none; }
    #touch button { position: absolute; pointer-events: auto; touch-action: none; border: 0; padding: 0;
      background: transparent no-repeat center / 100% 100%; image-rendering: pixelated; image-rendering: crisp-edges;
      -webkit-tap-highlight-color: transparent; opacity: 0.9; }
    #touch .pad { width: ${20 * SCALE}px; height: ${20 * SCALE}px; }
    #touch .big { width: ${34 * SCALE}px; height: ${36 * SCALE}px; }
    #rotate { display: none; position: fixed; inset: 0; z-index: 10; background: #0c0828;
      color: #a4e4fc; font: bold 16px monospace; letter-spacing: 2px;
      flex-direction: column; align-items: center; justify-content: center; gap: 24px; }
    #rotate .phone { width: 40px; height: 70px; border: 4px solid #a4e4fc;
      animation: turn 1.6s steps(6) infinite; }
    @keyframes turn { 0%, 30% { transform: rotate(0deg); } 60%, 100% { transform: rotate(-90deg); } }
    @media (orientation: portrait) and (max-width: 900px) { #rotate { display: flex; } }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'touch';
  document.body.appendChild(root);

  // Phones held upright: ask to rotate (the game is widescreen).
  const rotate = document.createElement('div');
  rotate.id = 'rotate';
  rotate.innerHTML = '<div class="phone"></div><div>ROTATE YOUR DEVICE</div>';
  document.body.appendChild(rotate);

  const P = SCALE * 20;
  // [action, css position, class, normal face, pressed face]
  const buttons = [
    ['left', `left:16px;bottom:${16 + P}px`, 'pad', squareFace(arrow('left'), false), squareFace(arrow('left'), true)],
    ['right', `left:${16 + P * 2}px;bottom:${16 + P}px`, 'pad', squareFace(arrow('right'), false), squareFace(arrow('right'), true)],
    ['up', `left:${16 + P}px;bottom:${16 + P * 2}px`, 'pad', squareFace(arrow('up'), false), squareFace(arrow('up'), true)],
    ['down', `left:${16 + P}px;bottom:16px`, 'pad', squareFace(arrow('down'), false), squareFace(arrow('down'), true)],
    ['jump', 'right:12px;bottom:20px', 'big', roundFace('JUMP', '#d82800', '#881400', false), roundFace('JUMP', '#d82800', '#881400', true)],
    ['dash', `right:${24 + SCALE * 34}px;bottom:${36 + SCALE * 22}px`, 'big', roundFace('DASH', '#0058f8', '#0000bc', false), roundFace('DASH', '#0058f8', '#0000bc', true)],
    ['pause', 'right:16px;top:16px', 'pad', squareFace(pauseIcon, false), squareFace(pauseIcon, true)],
  ];

  for (const [action, pos, cls, up, down] of buttons) {
    const b = document.createElement('button');
    b.className = cls;
    b.style.cssText = pos;
    b.style.backgroundImage = `url(${up})`;
    b.setAttribute('aria-label', action);
    let code = null;
    const press = (e) => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      if (code) return;
      code = (Config.keys[action] || [])[0] || DEFAULT_KEYS[action][0]; // follow the player's bindings
      b.style.backgroundImage = `url(${down})`;
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
    };
    const release = (e) => {
      e.preventDefault();
      if (!code) return;
      window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code }));
      code = null;
      b.style.backgroundImage = `url(${up})`;
    };
    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    root.appendChild(b);
  }
})();
