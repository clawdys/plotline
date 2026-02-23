/* ============================================================
   PLOTLINE — Application Logic
   Vanilla JS, no frameworks, no dependencies
   ============================================================ */

(() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  const state = {
    projects: [],
    currentProject: null,
    audioContext: null,
    audioBuffer: null,
    isPlaying: false,
    playbackRate: 1,
    animFrameId: null,
    dragSrcIndex: null,
    pollTimer: null,
  };

  // ── DOM refs ───────────────────────────────────────────────
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const dom = {
    viewProjects: $('#view-projects'),
    viewEditor: $('#view-editor'),
    uploadZone: $('#upload-zone'),
    fileInput: $('#file-input'),
    projectsGrid: $('#projects-grid'),
    projectsEmpty: $('#projects-empty'),
    projectsLoading: $('#projects-loading'),
    btnBack: $('#btn-back'),
    projectName: $('#project-name'),
    statusBadge: $('#status-badge'),
    btnDelete: $('#btn-delete-project'),
    waveformCanvas: $('#waveform-canvas'),
    audioSeek: $('#audio-seek'),
    audioCurrent: $('#audio-current'),
    audioDuration: $('#audio-duration'),
    btnPlay: $('#btn-play'),
    iconPlay: $('#icon-play'),
    iconPause: $('#icon-pause'),
    audioEl: $('#audio-el'),
    transcriptCount: $('#transcript-count'),
    transcriptContainer: $('#transcript-container'),
    transcriptEmpty: $('#transcript-empty'),
    transcriptSegments: $('#transcript-segments'),
    panelScript: $('#panel-script'),
    scriptEmpty: $('#script-empty'),
    scriptElements: $('#script-elements'),
    actionTranscribe: $('#action-transcribe'),
    modelSelect: $('#model-select'),
    btnTranscribe: $('#btn-transcribe'),
    actionOrganize: $('#action-organize'),
    btnOrganizeToggle: $('#btn-organize-toggle'),
    organizePanel: $('#organize-panel'),
    organizeInstructions: $('#organize-instructions'),
    btnOrganizeCancel: $('#btn-organize-cancel'),
    btnOrganizeSubmit: $('#btn-organize-submit'),
    actionExport: $('#action-export'),
    btnExport: $('#btn-export'),
    exportMenu: $('#export-menu'),
    actionStatus: $('#action-status'),
    statusText: $('#status-text'),
    toastContainer: $('#toast-container'),
    // Paper Edit
    panelPaperEdit: $('#panel-paper-edit'),
    btnClosePaperEdit: $('#btn-close-paper-edit'),
    editScriptTextarea: $('#edit-script-textarea'),
    scriptFileInput: $('#script-file-input'),
    btnClearScript: $('#btn-clear-script'),
    alignmentResults: $('#alignment-results'),
    alignmentStats: $('#alignment-stats'),
    alignmentEntries: $('#alignment-entries'),
    actionPaperEdit: $('#action-paper-edit'),
    btnPaperEditToggle: $('#btn-paper-edit-toggle'),
    btnAlignScript: $('#btn-align-script'),
    btnGenerateAssembly: $('#btn-generate-assembly'),
    assemblyMenu: $('#assembly-menu'),
  };

  // ── Utility ────────────────────────────────────────────────

  function formatTime(sec) {
    if (!sec || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + s.toString().padStart(2, '0');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showToast(message, type) {
    type = type || 'error';
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    const icon = type === 'error' ? '✕' : '✓';
    toast.innerHTML = '<span class="toast-icon">' + icon + '</span><span class="toast-message">' + escapeHtml(message) + '</span>';
    dom.toastContainer.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('toast-removing');
      setTimeout(function () { toast.remove(); }, 300);
    }, 4000);
  }

  function setProcessing(active, text) {
    if (active) {
      dom.actionStatus.hidden = false;
      dom.statusText.textContent = text || 'Processing…';
    } else {
      dom.actionStatus.hidden = true;
    }
  }

  // ── API Layer ──────────────────────────────────────────────

  async function api(path, opts) {
    opts = opts || {};
    try {
      const res = await fetch(path, opts);
      if (!res.ok) {
        const body = await res.text();
        var msg;
        try { msg = JSON.parse(body).error; } catch (e) { msg = body || res.statusText; }
        throw new Error(msg);
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json')) return res.json();
      return res;
    } catch (err) {
      showToast(err.message || 'Network error');
      throw err;
    }
  }

  function fetchProjects() { return api('/api/projects'); }
  function fetchProject(id) { return api('/api/projects/' + id); }

  function uploadAudio(file) {
    var fd = new FormData();
    fd.append('audio', file);
    return api('/api/upload', { method: 'POST', body: fd });
  }

  function transcribeProject(id, model, language) {
    return api('/api/projects/' + id + '/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || 'base', language: language || 'en' }),
    });
  }

  function updateProject(id, data) {
    return api('/api/projects/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  function organizeProject(id, style, instructions) {
    return api('/api/projects/' + id + '/organize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style: style || 'screenplay', instructions: instructions || '' }),
    });
  }

  function deleteProjectAPI(id) {
    return api('/api/projects/' + id, { method: 'DELETE' });
  }

  async function exportProject(id, format) {
    var endpoint = format === 'resolve'
      ? '/api/projects/' + id + '/export/resolve'
      : '/api/projects/' + id + '/export/fcpxml';
    var res = await api(endpoint, { method: 'POST' });
    var blob = await res.blob();
    var ext = format === 'resolve' ? '.xml' : '.fcpxml';
    var name = (state.currentProject ? state.currentProject.name : 'export') + ext;
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Exported ' + name, 'success');
  }

  // ── Paper Edit API ─────────────────────────────────────────

  function saveEditScript(id, text) {
    return api('/api/projects/' + id + '/script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }),
    });
  }

  function alignScript(id) {
    return api('/api/projects/' + id + '/align', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async function exportAssembly(id, format) {
    var endpoint = '/api/projects/' + id + '/export/assembly';
    var res = await api(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: format || 'fcpxml' }),
    });
    var blob = await res.blob();
    var ext = format === 'resolve' ? '.xml' : '.fcpxml';
    var name = (state.currentProject ? state.currentProject.name : 'assembly') + '_assembly' + ext;
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Assembly cut exported: ' + name, 'success');
  }

  // ── Navigation ─────────────────────────────────────────────

  function showView(name) {
    dom.viewProjects.classList.toggle('active', name === 'projects');
    dom.viewEditor.classList.toggle('active', name === 'editor');
  }

  // ── Project List ───────────────────────────────────────────

  async function loadProjects() {
    dom.projectsLoading.hidden = false;
    dom.projectsEmpty.hidden = true;
    dom.projectsGrid.innerHTML = '';
    try {
      state.projects = await fetchProjects();
      renderProjectGrid();
    } catch (e) {
      /* toast already shown */
    } finally {
      dom.projectsLoading.hidden = true;
    }
  }

  function renderProjectGrid() {
    dom.projectsGrid.innerHTML = '';
    if (!state.projects || state.projects.length === 0) {
      dom.projectsEmpty.hidden = false;
      return;
    }
    dom.projectsEmpty.hidden = true;
    state.projects.forEach(function (proj, i) {
      var card = document.createElement('div');
      card.className = 'project-card';
      card.style.animation = 'fadeIn 300ms ease ' + (i * 50) + 'ms both';
      card.innerHTML =
        '<div class="project-card-name">' + escapeHtml(proj.name || 'Untitled') + '</div>' +
        '<div class="project-card-meta">' +
          '<span class="project-card-date">' + formatDate(proj.createdAt || proj.updatedAt) + '</span>' +
          '<span class="project-card-status" data-status="' + (proj.status || '') + '">' + (proj.status || '') + '</span>' +
        '</div>';
      card.addEventListener('click', function () { openProject(proj.id); });
      dom.projectsGrid.appendChild(card);
    });
  }

  // ── Open Project ───────────────────────────────────────────

  async function openProject(id) {
    setProcessing(true, 'Loading project…');
    try {
      state.currentProject = await fetchProject(id);
      showView('editor');
      renderEditor();
      loadAudio();
    } catch (e) {
      /* toast */
    } finally {
      setProcessing(false);
    }
  }

  // ── Render Editor ──────────────────────────────────────────

  function renderEditor() {
    var proj = state.currentProject;
    if (!proj) return;

    dom.projectName.value = proj.name || 'Untitled';
    updateStatusBadge(proj.status);

    var st = proj.status;
    dom.actionTranscribe.hidden = (st !== 'uploaded');

    // Reset transcribe button state
    var spinner = dom.btnTranscribe.querySelector('.btn-spinner');
    var label = dom.btnTranscribe.querySelector('.btn-label');
    if (spinner) spinner.hidden = true;
    if (label) label.textContent = 'Transcribe';
    dom.btnTranscribe.disabled = false;

    dom.actionOrganize.hidden = (st !== 'transcribed' && st !== 'organized');
    dom.actionExport.hidden = (st !== 'transcribed' && st !== 'organized');
    dom.actionPaperEdit.hidden = (st !== 'transcribed' && st !== 'organized');

    // Restore edit script if saved
    if (proj.editScript) {
      dom.editScriptTextarea.value = proj.editScript;
    } else {
      dom.editScriptTextarea.value = '';
    }

    // Restore alignment if exists
    if (proj.alignment) {
      renderAlignment(proj.alignment);
    } else {
      dom.alignmentResults.hidden = true;
    }

    renderTranscript();
    renderScript();

    stopPolling();
    if (st === 'transcribing') {
      startPolling();
    }
  }

  function updateStatusBadge(status) {
    dom.statusBadge.textContent = status;
    dom.statusBadge.setAttribute('data-status', status);
  }

  // ── Transcript Rendering ───────────────────────────────────

  function renderTranscript() {
    var proj = state.currentProject;
    var segments = proj && proj.transcript ? proj.transcript.segments : null;

    if (!segments || segments.length === 0) {
      dom.transcriptEmpty.style.display = 'flex';
      dom.transcriptSegments.innerHTML = '';
      dom.transcriptCount.textContent = '';
      return;
    }

    dom.transcriptEmpty.style.display = 'none';
    dom.transcriptCount.textContent = segments.length + ' segment' + (segments.length !== 1 ? 's' : '');
    dom.transcriptSegments.innerHTML = '';

    segments.forEach(function (seg, idx) {
      var el = document.createElement('div');
      el.className = 'segment';
      el.dataset.index = idx;
      el.dataset.start = seg.start;
      el.dataset.end = seg.end;
      el.innerHTML =
        '<span class="segment-drag-handle" draggable="true" title="Drag to reorder">⠿</span>' +
        '<span class="segment-time">' + formatTime(seg.start) + '</span>' +
        '<div class="segment-text" contenteditable="true" spellcheck="false">' + escapeHtml(seg.text) + '</div>' +
        '<button class="segment-delete" title="Delete segment">×</button>';
      dom.transcriptSegments.appendChild(el);
    });
  }

  // Transcript event delegation — attach once
  function initTranscriptEvents() {
    var container = dom.transcriptSegments;

    container.addEventListener('click', function (e) {
      var seg = e.target.closest('.segment');
      if (!seg) return;

      if (e.target.closest('.segment-delete')) {
        deleteSegment(parseInt(seg.dataset.index));
        return;
      }

      if (e.target.classList.contains('segment-text')) return;

      seekAudio(parseFloat(seg.dataset.start));
      playAudio();
    });

    container.addEventListener('input', function (e) {
      if (e.target.classList.contains('segment-text')) {
        var seg = e.target.closest('.segment');
        var idx = parseInt(seg.dataset.index);
        if (state.currentProject && state.currentProject.transcript && state.currentProject.transcript.segments[idx]) {
          state.currentProject.transcript.segments[idx].text = e.target.textContent;
          debouncedSave();
        }
      }
    });

    // Drag and drop
    container.addEventListener('dragstart', function (e) {
      var handle = e.target.closest('.segment-drag-handle');
      if (!handle) { e.preventDefault(); return; }
      var seg = handle.closest('.segment');
      state.dragSrcIndex = parseInt(seg.dataset.index);
      seg.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(state.dragSrcIndex));
    });

    container.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var seg = e.target.closest('.segment');
      if (!seg) return;
      $$('.segment', container).forEach(function (s) {
        s.classList.remove('drag-target-above', 'drag-target-below');
      });
      var rect = seg.getBoundingClientRect();
      var mid = rect.top + rect.height / 2;
      if (e.clientY < mid) {
        seg.classList.add('drag-target-above');
      } else {
        seg.classList.add('drag-target-below');
      }
    });

    container.addEventListener('dragleave', function (e) {
      var seg = e.target.closest('.segment');
      if (seg) {
        seg.classList.remove('drag-target-above', 'drag-target-below');
      }
    });

    container.addEventListener('drop', function (e) {
      e.preventDefault();
      $$('.segment', container).forEach(function (s) {
        s.classList.remove('dragging', 'drag-target-above', 'drag-target-below');
      });
      var seg = e.target.closest('.segment');
      if (!seg) return;
      var fromIdx = state.dragSrcIndex;
      var toIdx = parseInt(seg.dataset.index);
      var rect = seg.getBoundingClientRect();
      var mid = rect.top + rect.height / 2;
      if (e.clientY >= mid) toIdx += 1;
      if (fromIdx === null || fromIdx === toIdx) return;
      reorderSegment(fromIdx, toIdx);
    });

    container.addEventListener('dragend', function () {
      $$('.segment', container).forEach(function (s) {
        s.classList.remove('dragging', 'drag-target-above', 'drag-target-below');
      });
      state.dragSrcIndex = null;
    });
  }

  function deleteSegment(idx) {
    var segments = state.currentProject && state.currentProject.transcript ? state.currentProject.transcript.segments : null;
    if (!segments) return;
    segments.splice(idx, 1);
    segments.forEach(function (s, i) { s.id = i; });
    renderTranscript();
    debouncedSave();
  }

  function reorderSegment(fromIdx, toIdx) {
    var segments = state.currentProject && state.currentProject.transcript ? state.currentProject.transcript.segments : null;
    if (!segments) return;
    var moved = segments.splice(fromIdx, 1)[0];
    var insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
    segments.splice(insertAt, 0, moved);
    segments.forEach(function (s, i) { s.id = i; });
    renderTranscript();
    debouncedSave();
  }

  // ── Script Rendering ──────────────────────────────────────

  function renderScript() {
    var proj = state.currentProject;
    var elements = proj && proj.script ? proj.script.elements : null;

    if (!elements || elements.length === 0) {
      dom.panelScript.classList.remove('visible');
      dom.scriptEmpty.style.display = 'flex';
      dom.scriptElements.innerHTML = '';
      if (proj && proj.status === 'organized') {
        dom.panelScript.classList.add('visible');
      }
      return;
    }

    dom.panelScript.classList.add('visible');
    dom.scriptEmpty.style.display = 'none';
    dom.scriptElements.innerHTML = '';

    elements.forEach(function (elem) {
      var el = document.createElement('div');
      el.className = 'script-el';

      switch (elem.type) {
        case 'scene_heading':
          el.classList.add('script-el-scene-heading');
          el.textContent = elem.text;
          break;
        case 'dialogue':
          el.classList.add('script-el-dialogue');
          el.innerHTML =
            '<div class="script-el-character">' + escapeHtml(elem.character || '') + '</div>' +
            '<div class="script-el-dialogue-text">' + escapeHtml(elem.text) + '</div>';
          break;
        case 'action':
          el.classList.add('script-el-action');
          el.textContent = elem.text;
          break;
        case 'scene_break':
          el.classList.add('script-el-scene-break');
          el.textContent = '• • •';
          break;
        default:
          el.textContent = elem.text || '';
      }

      if (elem.start !== undefined && elem.start !== null) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', function () {
          seekAudio(elem.start);
          playAudio();
        });
      }

      dom.scriptElements.appendChild(el);
    });
  }

  // ── Audio ──────────────────────────────────────────────────

  function loadAudio() {
    var proj = state.currentProject;
    if (!proj || !proj.audioFile) return;

    var url = '/api/audio/' + proj.audioFile;
    dom.audioEl.src = url;
    dom.audioEl.playbackRate = state.playbackRate;

    if (!state.audioContext) {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    fetch(url)
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) { return state.audioContext.decodeAudioData(buf); })
      .then(function (decoded) {
        state.audioBuffer = decoded;
        drawWaveform();
      })
      .catch(function () {
        drawWaveformEmpty();
      });

    dom.audioEl.addEventListener('loadedmetadata', function () {
      dom.audioDuration.textContent = formatTime(dom.audioEl.duration);
      dom.audioSeek.max = dom.audioEl.duration || 100;
    });

    dom.audioEl.addEventListener('ended', function () {
      state.isPlaying = false;
      updatePlayButton();
      cancelAnimationFrame(state.animFrameId);
    });
  }

  function drawWaveform() {
    var canvas = dom.waveformCanvas;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    var width = rect.width;
    var height = rect.height;
    var buffer = state.audioBuffer;

    if (!buffer) { drawWaveformEmpty(); return; }

    var data = buffer.getChannelData(0);
    var mid = height / 2;
    var barWidth = 2;
    var gap = 1;
    var totalBarWidth = barWidth + gap;
    var numBars = Math.floor(width / totalBarWidth);
    var samplesPerBar = Math.floor(data.length / numBars);

    ctx.clearRect(0, 0, width, height);

    for (var i = 0; i < numBars; i++) {
      var min = 1.0, max = -1.0;
      var start = i * samplesPerBar;
      for (var j = 0; j < samplesPerBar; j++) {
        var val = data[start + j] || 0;
        if (val < min) min = val;
        if (val > max) max = val;
      }
      var barH = Math.max(2, (max - min) * mid * 0.9);
      var x = i * totalBarWidth;
      var y = mid - barH / 2;
      ctx.fillStyle = 'rgba(79, 140, 255, 0.4)';
      ctx.fillRect(x, y, barWidth, barH);
    }

    // Store drawing parameters for playback overlay
    canvas._waveData = {
      numBars: numBars,
      totalBarWidth: totalBarWidth,
      barWidth: barWidth,
      mid: mid,
      samplesPerBar: samplesPerBar,
      data: data
    };
  }

  function drawWaveformEmpty() {
    var canvas = dom.waveformCanvas;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No audio loaded', rect.width / 2, rect.height / 2 + 4);
  }

  function drawWaveformWithPlayhead() {
    var canvas = dom.waveformCanvas;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    var width = rect.width;
    var height = rect.height;

    if (!state.audioBuffer || !canvas._waveData) return;

    var wd = canvas._waveData;
    var progress = dom.audioEl.currentTime / (dom.audioEl.duration || 1);
    var playedBars = Math.floor(progress * wd.numBars);

    ctx.clearRect(0, 0, width, height);

    for (var i = 0; i < wd.numBars; i++) {
      var min = 1.0, max = -1.0;
      var start = i * wd.samplesPerBar;
      for (var j = 0; j < wd.samplesPerBar; j++) {
        var val = wd.data[start + j] || 0;
        if (val < min) min = val;
        if (val > max) max = val;
      }
      var barH = Math.max(2, (max - min) * wd.mid * 0.9);
      var x = i * wd.totalBarWidth;
      var y = wd.mid - barH / 2;
      ctx.fillStyle = i <= playedBars
        ? 'rgba(79, 140, 255, 0.8)'
        : 'rgba(79, 140, 255, 0.25)';
      ctx.fillRect(x, y, wd.barWidth, barH);
    }

    // Playhead line
    var px = progress * width;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
  }

  function playAudio() {
    if (!dom.audioEl.src) return;
    if (state.audioContext && state.audioContext.state === 'suspended') {
      state.audioContext.resume();
    }
    dom.audioEl.play();
    state.isPlaying = true;
    updatePlayButton();
    startAnimLoop();
  }

  function pauseAudio() {
    dom.audioEl.pause();
    state.isPlaying = false;
    updatePlayButton();
    cancelAnimationFrame(state.animFrameId);
  }

  function togglePlay() {
    if (state.isPlaying) pauseAudio();
    else playAudio();
  }

  function seekAudio(time) {
    if (!dom.audioEl.src) return;
    dom.audioEl.currentTime = time;
    dom.audioSeek.value = time;
    dom.audioCurrent.textContent = formatTime(time);
    if (state.audioBuffer) drawWaveformWithPlayhead();
    highlightActiveSegment();
    highlightActiveScriptEl();
  }

  function updatePlayButton() {
    dom.iconPlay.hidden = state.isPlaying;
    dom.iconPause.hidden = !state.isPlaying;
  }

  function startAnimLoop() {
    function tick() {
      if (!state.isPlaying) return;
      var t = dom.audioEl.currentTime;
      dom.audioCurrent.textContent = formatTime(t);
      dom.audioSeek.value = t;
      if (state.audioBuffer) drawWaveformWithPlayhead();
      highlightActiveSegment();
      highlightActiveScriptEl();
      state.animFrameId = requestAnimationFrame(tick);
    }
    cancelAnimationFrame(state.animFrameId);
    state.animFrameId = requestAnimationFrame(tick);
  }

  function highlightActiveSegment() {
    var t = dom.audioEl.currentTime;
    $$('.segment', dom.transcriptSegments).forEach(function (el) {
      var segStart = parseFloat(el.dataset.start);
      var segEnd = parseFloat(el.dataset.end);
      var isActive = t >= segStart && t < segEnd;
      el.classList.toggle('active', isActive);
      if (isActive && state.isPlaying) {
        var container = dom.transcriptContainer;
        var elRect = el.getBoundingClientRect();
        var contRect = container.getBoundingClientRect();
        if (elRect.top < contRect.top || elRect.bottom > contRect.bottom) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });
  }

  function highlightActiveScriptEl() {
    var t = dom.audioEl.currentTime;
    var proj = state.currentProject;
    var elements = proj && proj.script ? proj.script.elements : null;
    if (!elements) return;
    $$('.script-el', dom.scriptElements).forEach(function (el, i) {
      var elem = elements[i];
      if (!elem) return;
      var isActive = elem.start !== undefined && elem.end !== undefined && t >= elem.start && t < elem.end;
      el.classList.toggle('active', isActive);
    });
  }

  // ── Waveform click-to-seek ─────────────────────────────────

  function initWaveformSeek() {
    dom.waveformCanvas.addEventListener('click', function (e) {
      if (!dom.audioEl.duration) return;
      var rect = dom.waveformCanvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var pct = x / rect.width;
      seekAudio(pct * dom.audioEl.duration);
    });
  }

  // ── Debounced Save ─────────────────────────────────────────

  var saveTimeout = null;
  function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(function () {
      var proj = state.currentProject;
      if (!proj) return;
      updateProject(proj.id, {
        name: proj.name,
        transcript: proj.transcript,
        script: proj.script,
      }).catch(function () { /* toast on error */ });
    }, 1500);
  }

  // ── Polling for transcription ──────────────────────────────

  function startPolling() {
    stopPolling();
    setProcessing(true, 'Transcribing… this may take a few minutes');
    dom.btnTranscribe.disabled = true;
    var spinner = dom.btnTranscribe.querySelector('.btn-spinner');
    var label = dom.btnTranscribe.querySelector('.btn-label');
    if (spinner) spinner.hidden = false;
    if (label) label.textContent = 'Transcribing…';

    state.pollTimer = setInterval(async function () {
      try {
        var proj = await fetchProject(state.currentProject.id);
        if (proj.status !== 'transcribing') {
          state.currentProject = proj;
          stopPolling();
          setProcessing(false);
          renderEditor();
          showToast('Transcription complete!', 'success');
        }
      } catch (e) {
        /* keep polling */
      }
    }, 3000);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // ── Upload ─────────────────────────────────────────────────

  function initUpload() {
    var zone = dom.uploadZone;
    var input = dom.fileInput;

    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () {
      if (input.files.length > 0) handleUpload(input.files[0]);
      input.value = '';
    });
    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', function () { zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files[0]);
    });
  }

  async function handleUpload(file) {
    var validExts = ['wav', 'mp3', 'm4a', 'mp4', 'mov', 'aac', 'flac'];
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (validExts.indexOf(ext) === -1) {
      showToast('Unsupported file format. Use: ' + validExts.join(', '));
      return;
    }
    setProcessing(true, 'Uploading ' + file.name + '…');
    try {
      var proj = await uploadAudio(file);
      showToast('Uploaded successfully!', 'success');
      state.currentProject = proj;
      showView('editor');
      renderEditor();
      loadAudio();
    } catch (e) {
      /* toast */
    } finally {
      setProcessing(false);
    }
  }

  // ── Action Bar Events ─────────────────────────────────────

  function initActions() {
    // Transcribe
    dom.btnTranscribe.addEventListener('click', async function () {
      var proj = state.currentProject;
      if (!proj) return;
      var model = dom.modelSelect.value;
      dom.btnTranscribe.disabled = true;
      var spinner = dom.btnTranscribe.querySelector('.btn-spinner');
      var label = dom.btnTranscribe.querySelector('.btn-label');
      if (spinner) spinner.hidden = false;
      if (label) label.textContent = 'Starting…';
      setProcessing(true, 'Starting transcription…');
      try {
        var result = await transcribeProject(proj.id, model);
        state.currentProject = result;
        if (result.status === 'transcribing') {
          startPolling();
        } else {
          renderEditor();
          setProcessing(false);
          if (spinner) spinner.hidden = true;
          if (label) label.textContent = 'Transcribe';
          dom.btnTranscribe.disabled = false;
          showToast('Transcription complete!', 'success');
        }
      } catch (e) {
        setProcessing(false);
        if (spinner) spinner.hidden = true;
        if (label) label.textContent = 'Transcribe';
        dom.btnTranscribe.disabled = false;
      }
    });

    // Organize toggle
    dom.btnOrganizeToggle.addEventListener('click', function () {
      dom.organizePanel.hidden = !dom.organizePanel.hidden;
    });
    dom.btnOrganizeCancel.addEventListener('click', function () {
      dom.organizePanel.hidden = true;
    });
    dom.btnOrganizeSubmit.addEventListener('click', async function () {
      var proj = state.currentProject;
      if (!proj) return;
      var instructions = dom.organizeInstructions.value.trim();
      dom.organizePanel.hidden = true;
      dom.btnOrganizeToggle.disabled = true;
      dom.btnOrganizeToggle.textContent = 'Organizing…';
      setProcessing(true, 'AI organizing transcript…');
      try {
        var result = await organizeProject(proj.id, 'screenplay', instructions);
        state.currentProject = result;
        renderEditor();
        showToast('Script organized!', 'success');
      } catch (e) {
        /* toast */
      } finally {
        setProcessing(false);
        dom.btnOrganizeToggle.disabled = false;
        dom.btnOrganizeToggle.textContent = 'AI Organize';
      }
    });

    // Export
    dom.btnExport.addEventListener('click', function (e) {
      e.stopPropagation();
      dom.exportMenu.hidden = !dom.exportMenu.hidden;
    });
    $$('.dropdown-item', dom.exportMenu).forEach(function (item) {
      item.addEventListener('click', async function () {
        var format = item.dataset.export;
        dom.exportMenu.hidden = true;
        if (!state.currentProject) return;
        setProcessing(true, 'Exporting…');
        try {
          await exportProject(state.currentProject.id, format);
        } catch (e) {
          /* toast */
        } finally {
          setProcessing(false);
        }
      });
    });

    // Close dropdown on outside click
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.export-dropdown')) {
        dom.exportMenu.hidden = true;
      }
      if (!e.target.closest('#action-organize')) {
        dom.organizePanel.hidden = true;
      }
    });

    // Delete project
    dom.btnDelete.addEventListener('click', async function () {
      var proj = state.currentProject;
      if (!proj) return;
      if (!confirm('Delete "' + (proj.name || 'Untitled') + '"? This cannot be undone.')) return;
      setProcessing(true, 'Deleting…');
      try {
        await deleteProjectAPI(proj.id);
        showToast('Project deleted', 'success');
        goBack();
      } catch (e) {
        /* toast */
      } finally {
        setProcessing(false);
      }
    });

    // Back button
    dom.btnBack.addEventListener('click', goBack);

    // Project name editing
    dom.projectName.addEventListener('change', function () {
      var proj = state.currentProject;
      if (!proj) return;
      proj.name = dom.projectName.value.trim() || 'Untitled';
      debouncedSave();
    });
  }

  // ── Paper Edit Rendering ─────────────────────────────────────

  function renderAlignment(alignment) {
    if (!alignment || !alignment.entries) {
      dom.alignmentResults.hidden = true;
      return;
    }

    dom.alignmentResults.hidden = false;

    // Stats bar
    var s = alignment.stats;
    dom.alignmentStats.innerHTML =
      '<div class="align-stat"><span class="align-stat-num">' + s.totalLines + '</span><span class="align-stat-label">Lines</span></div>' +
      '<div class="align-stat align-stat-matched"><span class="align-stat-num">' + s.matched + '</span><span class="align-stat-label">Matched</span></div>' +
      '<div class="align-stat align-stat-approx"><span class="align-stat-num">' + s.approximate + '</span><span class="align-stat-label">Approx</span></div>' +
      '<div class="align-stat align-stat-unmatched"><span class="align-stat-num">' + s.unmatched + '</span><span class="align-stat-label">Unmatched</span></div>' +
      '<div class="align-stat"><span class="align-stat-num">' + (s.avgConfidence * 100).toFixed(0) + '%</span><span class="align-stat-label">Avg Conf</span></div>';

    // Entries
    dom.alignmentEntries.innerHTML = '';
    alignment.entries.forEach(function (entry) {
      var el = document.createElement('div');
      el.className = 'align-entry align-entry-' + entry.status;

      var timeStr = '';
      if (entry.trimmedStart != null && entry.trimmedEnd != null) {
        timeStr = formatTime(entry.trimmedStart) + ' → ' + formatTime(entry.trimmedEnd);
      }

      var confPct = (entry.confidence * 100).toFixed(0);

      el.innerHTML =
        '<div class="align-entry-header">' +
          '<span class="align-entry-status">' + entry.status + '</span>' +
          (timeStr ? '<span class="align-entry-time">' + timeStr + '</span>' : '') +
          '<span class="align-entry-conf">' + confPct + '%</span>' +
        '</div>' +
        '<div class="align-entry-script">' + escapeHtml(entry.scriptLine) + '</div>' +
        (entry.matchedText ? '<div class="align-entry-match">' + escapeHtml(entry.matchedText) + '</div>' : '');

      // Click to seek
      if (entry.trimmedStart != null) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', function () {
          seekAudio(entry.trimmedStart);
          playAudio();
        });
      }

      dom.alignmentEntries.appendChild(el);
    });

    // Show assembly button
    dom.btnAlignScript.hidden = false;
    dom.btnGenerateAssembly.hidden = false;
  }

  // ── Paper Edit Events ──────────────────────────────────────

  function initPaperEdit() {
    // Toggle Paper Edit panel
    dom.btnPaperEditToggle.addEventListener('click', function () {
      var isVisible = dom.panelPaperEdit.classList.contains('visible');
      dom.panelPaperEdit.classList.toggle('visible', !isVisible);
      dom.btnPaperEditToggle.classList.toggle('active', !isVisible);
      if (!isVisible) {
        dom.btnAlignScript.hidden = false;
      }
    });

    dom.btnClosePaperEdit.addEventListener('click', function () {
      dom.panelPaperEdit.classList.remove('visible');
      dom.btnPaperEditToggle.classList.remove('active');
    });

    // Import script file
    dom.scriptFileInput.addEventListener('change', function () {
      var file = dom.scriptFileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        dom.editScriptTextarea.value = e.target.result;
        showToast('Script imported: ' + file.name, 'success');
      };
      reader.readAsText(file);
      dom.scriptFileInput.value = '';
    });

    // Clear script
    dom.btnClearScript.addEventListener('click', function () {
      dom.editScriptTextarea.value = '';
      dom.alignmentResults.hidden = true;
      dom.btnGenerateAssembly.hidden = true;
    });

    // Align script
    dom.btnAlignScript.addEventListener('click', async function () {
      var proj = state.currentProject;
      if (!proj) return;
      var scriptText = dom.editScriptTextarea.value.trim();
      if (!scriptText) {
        showToast('Enter or import a script first');
        return;
      }

      dom.btnAlignScript.disabled = true;
      dom.btnAlignScript.textContent = 'Aligning…';
      setProcessing(true, 'Aligning script to transcript…');

      try {
        // Save script first
        await saveEditScript(proj.id, scriptText);
        proj.editScript = scriptText;

        // Run alignment
        var alignment = await alignScript(proj.id);
        proj.alignment = alignment;
        state.currentProject = proj;

        renderAlignment(alignment);
        showToast('Alignment complete! ' + alignment.stats.matched + '/' + alignment.stats.totalLines + ' lines matched', 'success');
      } catch (e) {
        /* toast already shown */
      } finally {
        setProcessing(false);
        dom.btnAlignScript.disabled = false;
        dom.btnAlignScript.textContent = 'Align Script';
      }
    });

    // Assembly cut dropdown
    dom.btnGenerateAssembly.addEventListener('click', function (e) {
      e.stopPropagation();
      dom.assemblyMenu.hidden = !dom.assemblyMenu.hidden;
    });

    $$('.dropdown-item', dom.assemblyMenu).forEach(function (item) {
      item.addEventListener('click', async function () {
        var format = item.dataset.assembly;
        dom.assemblyMenu.hidden = true;
        if (!state.currentProject) return;
        setProcessing(true, 'Generating assembly cut…');
        try {
          await exportAssembly(state.currentProject.id, format);
        } catch (e) {
          /* toast */
        } finally {
          setProcessing(false);
        }
      });
    });

    // Close assembly menu on outside click
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#btn-generate-assembly') && !e.target.closest('#assembly-menu')) {
        dom.assemblyMenu.hidden = true;
      }
    });
  }

  function goBack() {
    pauseAudio();
    stopPolling();
    state.currentProject = null;
    state.audioBuffer = null;
    dom.audioEl.src = '';
    cancelAnimationFrame(state.animFrameId);
    dom.panelPaperEdit.classList.remove('visible');
    dom.btnPaperEditToggle.classList.remove('active');
    dom.alignmentResults.hidden = true;
    showView('projects');
    loadProjects();
  }

  // ── Audio Controls ─────────────────────────────────────────

  function initAudioControls() {
    dom.btnPlay.addEventListener('click', togglePlay);

    dom.audioSeek.addEventListener('input', function () {
      seekAudio(parseFloat(dom.audioSeek.value));
    });

    $$('.btn-speed').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var speed = parseFloat(btn.dataset.speed);
        state.playbackRate = speed;
        dom.audioEl.playbackRate = speed;
        $$('.btn-speed').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });
  }

  // ── Keyboard Shortcuts ─────────────────────────────────────

  function initKeyboard() {
    document.addEventListener('keydown', function (e) {
      // Don't capture when typing in inputs
      var tag = e.target.tagName.toLowerCase();
      var isEditable = e.target.contentEditable === 'true';
      var isInput = tag === 'input' || tag === 'textarea' || isEditable;

      // Space = play/pause (only if not in input)
      if (e.code === 'Space' && !isInput && dom.viewEditor.classList.contains('active')) {
        e.preventDefault();
        togglePlay();
        return;
      }

      // Cmd+E = export
      if ((e.metaKey || e.ctrlKey) && e.key === 'e' && dom.viewEditor.classList.contains('active')) {
        e.preventDefault();
        if (!dom.actionExport.hidden) {
          dom.exportMenu.hidden = !dom.exportMenu.hidden;
        }
        return;
      }

      // Cmd+O = organize
      if ((e.metaKey || e.ctrlKey) && e.key === 'o' && dom.viewEditor.classList.contains('active')) {
        e.preventDefault();
        if (!dom.actionOrganize.hidden) {
          dom.organizePanel.hidden = !dom.organizePanel.hidden;
        }
        return;
      }

      // Escape = close panels, go back
      if (e.key === 'Escape') {
        if (!dom.organizePanel.hidden) { dom.organizePanel.hidden = true; return; }
        if (!dom.exportMenu.hidden) { dom.exportMenu.hidden = true; return; }
        if (dom.viewEditor.classList.contains('active')) { goBack(); return; }
      }
    });
  }

  // ── Window resize ──────────────────────────────────────────

  function initResize() {
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (state.audioBuffer) {
          drawWaveform();
          if (state.isPlaying || dom.audioEl.currentTime > 0) {
            drawWaveformWithPlayhead();
          }
        }
      }, 200);
    });
  }

  // ── Initialize ─────────────────────────────────────────────

  function init() {
    initUpload();
    initTranscriptEvents();
    initWaveformSeek();
    initAudioControls();
    initActions();
    initPaperEdit();
    initKeyboard();
    initResize();
    loadProjects();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
