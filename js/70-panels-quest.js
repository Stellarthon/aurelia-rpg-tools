// ═══════════════════════════════════════════════════════════════════════════
// DRAGGABLE & RESIZABLE FLOATING PANELS (Event Log + Initiative Tracker)
// ═══════════════════════════════════════════════════════════════════════════
// Uses the Pointer Events API rather than separate mouse/touch handlers —
// Pointer Events unify mouse, touch, and pen input into one consistent
// model and are well supported on iPadOS Safari, which is the main target
// here. Position/size are persisted per-panel to localStorage so layout
// survives a page reload.

function makePanelDraggable(panelId, headerId){
  const panel = document.getElementById(panelId);
  const header = document.getElementById(headerId);
  if(!panel || !header) return;

  // Restore saved position/size if present
  try {
    const saved = JSON.parse(localStorage.getItem('panelpos_' + panelId) || 'null');
    if(saved){
      panel.style.left = saved.left;
      panel.style.top = saved.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      if(saved.width) panel.style.width = saved.width;
      if(saved.height) panel.style.height = saved.height;
    }
  } catch(e){}

  let dragging = false;
  let startX, startY, startLeft, startTop;

  header.addEventListener('pointerdown', (e) => {
    // Don't start a drag if the click was on the collapse arrow/count —
    // header still has onclick=toggleEventLog()/toggleInitPanel(), so we
    // distinguish a drag from a tap by movement threshold below.
    //
    // IMPORTANT: clearing right/bottom here used to cause a visible jump
    // to the top-left corner on a plain tap (not just a drag), because
    // panels default to being positioned via right/bottom, and clearing
    // those without first pinning left/top to the panel's actual current
    // position falls back toward 0,0. We capture the real rendered
    // position via getBoundingClientRect() and pin left/top to THAT
    // before clearing right/bottom, so a tap that never moves the mouse
    // produces zero visible change.
    dragging = true;
    const uiS = getUIScale() / 100;
    startX = e.clientX / uiS; startY = e.clientY / uiS;
    const rect = panel.getBoundingClientRect();
    // getBoundingClientRect is in screen (scaled) space; divide by scale
    // to convert to CSS layout coords that style.left/top expect.
    // NOTE: panels are now outside #root so they are NOT affected by the
    // scale transform — rect coords equal layout coords, so uiS = 1 here
    // effectively. But keeping the division for correctness if scale ever
    // changes approach again.
    startLeft = rect.left / uiS;
    startTop  = rect.top  / uiS;
    panel.style.left = startLeft + 'px';
    panel.style.top  = startTop  + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    header.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  let moved = false;
  header.addEventListener('pointermove', (e) => {
    if(!dragging) return;
    const uiS2 = getUIScale() / 100;
    const dx = e.clientX / uiS2 - startX, dy = e.clientY / uiS2 - startY;
    if(Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    if(!moved) return;
    let newLeft = startLeft + dx, newTop = startTop + dy;
    // Keep panel on-screen
    const maxLeft = window.innerWidth - 60;
    const maxTop = window.innerHeight - 40;
    newLeft = Math.max(-panel.offsetWidth + 80, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));
    panel.style.left = newLeft + 'px';
    panel.style.top = newTop + 'px';
  });

  function endDrag(e){
    if(!dragging) return;
    dragging = false;
    try { header.releasePointerCapture(e.pointerId); } catch(err){}
    if(moved){
      savePanelPos(panelId, panel);
      // Suppress the click-to-toggle that would otherwise fire right after a drag
      header.dataset.suppressClick = '1';
      setTimeout(() => { header.dataset.suppressClick = ''; }, 50);
    }
    moved = false;
  }
  header.addEventListener('pointerup', endDrag);
  header.addEventListener('pointercancel', endDrag);
}

function makePanelResizable(panelId){
  const panel = document.getElementById(panelId);
  const handle = panel ? panel.querySelector('.panel-resize-handle') : null;
  if(!panel || !handle) return;

  let resizing = false;
  let startX, startY, startW, startH;

  handle.addEventListener('pointerdown', (e) => {
    resizing = true;
    const uiS = getUIScale() / 100;
    startX = e.clientX / uiS; startY = e.clientY / uiS;
    const rect = panel.getBoundingClientRect();
    startW = rect.width / uiS; startH = rect.height / uiS;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  });

  handle.addEventListener('pointermove', (e) => {
    if(!resizing) return;
    const uiS = getUIScale() / 100;
    const dx = e.clientX / uiS - startX, dy = e.clientY / uiS - startY;
    const newW = startW + dx, newH = startH + dy;
    panel.style.width = newW + 'px';
    panel.style.height = newH + 'px';
  });

  function endResize(e){
    if(!resizing) return;
    resizing = false;
    try { handle.releasePointerCapture(e.pointerId); } catch(err){}
    savePanelPos(panelId, panel);
  }
  handle.addEventListener('pointerup', endResize);
  handle.addEventListener('pointercancel', endResize);
}

function savePanelPos(panelId, panel){
  try {
    localStorage.setItem('panelpos_' + panelId, JSON.stringify({
      left: panel.style.left, top: panel.style.top,
      width: panel.style.width, height: panel.style.height
    }));
  } catch(e){}
}

function resetPanelPositions(){
  try {
    localStorage.removeItem('panelpos_event-log-wrap');
    localStorage.removeItem('panelpos_init-wrap');
  } catch(e){}
  location.reload();
}

// ═══════════════════════════════════════════════════════════════════════════
// QUEST LOG
// ═══════════════════════════════════════════════════════════════════════════
// Data shape per quest:
//   { id:string, title:string, status:'active'|'complete'|'hidden',
//     playerDesc:string, refNote:string,
//     objectives:[{id:string, text:string, done:bool, refNote:string}] }
//
// Stored as a single Supabase key 'quest-log' (shared:true), same pattern
// as reveal state, clock, and Design Mode overrides. Players poll for
// changes every 10s and re-render automatically.
//
// Visibility rules:
//   - hidden quests: referee only
//   - active/complete: players see title, playerDesc, objectives (text+done)
//   - refNote on quests and objectives: referee only, always

let questLog = [];        // array of quest objects
let questPanelOpen = false;
let questCollapsed = false;
let questEditingId = null; // id of quest being edited, or null for new

// ── Persistence ──────────────────────────────────────────────────────────

async function loadQuestLog(){
  try {
    const res = await supaStorage.get('quest-log', true);
    if(res.value != null) questLog = JSON.parse(res.value) || [];
  } catch(e){ questLog = []; }
}

async function saveQuestLog(){
  try { await supaStorage.set('quest-log', JSON.stringify(questLog), true); }
  catch(e){ console.error('Quest save failed:', e); }
}

// ── Panel toggle ─────────────────────────────────────────────────────────

function toggleQuestPanel(){
  questPanelOpen = !questPanelOpen;
  const wrap = document.getElementById('quest-wrap');
  const btn = document.getElementById('quest-btn');
  wrap.classList.toggle('hidden', !questPanelOpen);
  btn.classList.toggle('panel-open', questPanelOpen);
  if(questPanelOpen) renderQuestPanel();
}

function toggleQuestCollapse(){
  if(document.getElementById('quest-header').dataset.suppressClick === '1') return;
  questCollapsed = !questCollapsed;
  document.getElementById('quest-toggle').textContent = questCollapsed ? '▲' : '▼';
  document.getElementById('quest-body').classList.toggle('collapsed', questCollapsed);
  const foot = document.getElementById('quest-foot');
  if(foot) foot.classList.toggle('collapsed', questCollapsed);
  document.getElementById('quest-wrap').classList.toggle('panel-collapsed', questCollapsed);
}

// ── Render ────────────────────────────────────────────────────────────────

function renderQuestPanel(){
  const ref = isReferee();
  const body = document.getElementById('quest-body');
  if(!body) return;

  // Filter to what's visible for the current user
  const visible = questLog.filter(q => ref || q.status !== 'hidden');

  // Update count badge — shows active quests only (not hidden/complete noise)
  const activeCount = questLog.filter(q => q.status === 'active').length;
  const countEl = document.getElementById('quest-count');
  if(countEl) countEl.textContent = activeCount;

  if(!visible.length){
    body.innerHTML = `<div class="quest-empty">${ref ? 'No missions yet. Add one below.' : 'No active missions.'}</div>`;
    return;
  }

  body.innerHTML = visible.map(q => renderQuestCard(q, ref)).join('');
}

function renderQuestCard(q, ref){
  const statusLabel = {active:'Active', complete:'Complete', hidden:'Hidden'}[q.status] || q.status;

  const objHTML = (q.objectives||[]).length ? `
    <div class="quest-objectives">
      ${q.objectives.map((obj,i) => `
        <div class="quest-obj-row${obj.done?' done':''}">
          ${ref
            ? `<div class="quest-obj-check${obj.done?' checked':''}" onclick="toggleObjective('${q.id}',${i})" title="Toggle done">${obj.done?'✓':''}</div>`
            : `<div class="quest-obj-check${obj.done?' checked':''}" style="cursor:default">${obj.done?'✓':''}</div>`
          }
          <span class="quest-obj-text">${escQH(obj.text)}</span>
        </div>
        ${ref && obj.refNote ? `<div class="quest-obj-ref">↳ ${escQH(obj.refNote)}</div>` : ''}
      `).join('')}
    </div>` : '';

  const refNoteHTML = ref && q.refNote ? `
    <div class="quest-ref-note">
      <div class="quest-ref-note-lbl">Referee Note</div>
      ${escQH(q.refNote).replace(/\n/g,'<br>')}
    </div>` : '';

  const editBtn = ref ? `<button class="quest-edit-btn" onclick="openQuestEditor('${q.id}')">✏ Edit Mission</button>` : '';

  return `
    <div class="quest-card status-${q.status}" id="qcard-${q.id}">
      <div class="quest-card-header" onclick="toggleQuestCard('${q.id}')">
        <span class="quest-title">${escQH(q.title)}</span>
        <span class="quest-status-badge">${statusLabel}</span>
      </div>
      <div class="quest-card-body" id="qbody-${q.id}">
        ${q.playerDesc ? `<div class="quest-player-desc">${escQH(q.playerDesc).replace(/\n/g,'<br>')}</div>` : ''}
        ${objHTML}
        ${refNoteHTML}
        ${editBtn}
      </div>
    </div>`;
}

function escQH(s){
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

