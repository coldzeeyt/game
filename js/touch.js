// On-screen buttons for phones and tablets. They press the same keys the
// keyboard does, so every screen (menus included) works with touch.
(() => {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) return;

  const style = document.createElement('style');
  style.textContent = `
    #touch { position: fixed; inset: 0; pointer-events: none; z-index: 5;
      font: bold 13px monospace; user-select: none; -webkit-user-select: none; }
    #touch button { position: absolute; pointer-events: auto; touch-action: none;
      border: 3px solid #a4e4fc; background: rgba(12, 8, 40, 0.55); color: #fcfcfc;
      font: inherit; border-radius: 10px; padding: 0; -webkit-tap-highlight-color: transparent; }
    #touch button.on { background: rgba(60, 188, 252, 0.55); }
    #touch .pad { width: 58px; height: 58px; }
    #touch .big { width: 76px; height: 76px; border-radius: 50%; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'touch';
  document.body.appendChild(root);

  // [label, key code, css position, class]
  const buttons = [
    ['◀', 'KeyA', 'left:16px;bottom:78px', 'pad'],
    ['▶', 'KeyD', 'left:136px;bottom:78px', 'pad'],
    ['▲', 'KeyW', 'left:76px;bottom:138px', 'pad'],
    ['▼', 'KeyS', 'left:76px;bottom:18px', 'pad'],
    ['JUMP', 'Space', 'right:16px;bottom:40px', 'big'],
    ['DASH', 'ShiftLeft', 'right:104px;bottom:96px', 'big'],
    ['II', 'Escape', 'right:16px;top:16px', 'pad'],
  ];

  for (const [label, code, pos, cls] of buttons) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = cls;
    b.style.cssText = pos;
    const press = (e) => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      b.classList.add('on');
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
    };
    const release = (e) => {
      e.preventDefault();
      if (!b.classList.contains('on')) return;
      b.classList.remove('on');
      window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code }));
    };
    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    root.appendChild(b);
  }
})();
