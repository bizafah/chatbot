/* ══════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════ */
let currentFile   = null;
let currentConfig = loadConfig();
let screeningHistory = JSON.parse(localStorage.getItem('atsHistory') || '[]');

/* ══════════════════════════════════════════════════════
   INIT — restore saved config on page load
══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  applyConfigToForm(currentConfig);
  renderHistory();

  // Live-update threshold label as slider moves
  document.getElementById('passThreshold').addEventListener('input', (e) => {
    document.getElementById('thresholdDisplay').textContent = e.target.value + '%';
  });
});

/* ══════════════════════════════════════════════════════
   CONFIG  — save / load / apply
══════════════════════════════════════════════════════ */
function saveConfig() {
  currentConfig = readConfigFromForm();
  localStorage.setItem('atsConfig', JSON.stringify(currentConfig));

  const msg = document.getElementById('configSavedMsg');
  msg.classList.add('show');
  setTimeout(() => msg.classList.remove('show'), 2500);
}

function loadConfig() {
  const stored = localStorage.getItem('atsConfig');
  return stored ? JSON.parse(stored) : {
    jobTitle:          '',
    jobDescription:    '',
    requiredSkills:    '',
    experienceYears:   2,
    passThreshold:     70,
    additionalCriteria: '',
  };
}

function readConfigFromForm() {
  return {
    jobTitle:           document.getElementById('jobTitle').value.trim(),
    jobDescription:     document.getElementById('jobDescription').value.trim(),
    requiredSkills:     document.getElementById('requiredSkills').value.trim(),
    experienceYears:    parseInt(document.getElementById('experienceYears').value) || 0,
    passThreshold:      parseInt(document.getElementById('passThreshold').value) || 70,
    additionalCriteria: document.getElementById('additionalCriteria').value.trim(),
  };
}

function applyConfigToForm(cfg) {
  document.getElementById('jobTitle').value           = cfg.jobTitle          || '';
  document.getElementById('jobDescription').value     = cfg.jobDescription    || '';
  document.getElementById('requiredSkills').value     = cfg.requiredSkills    || '';
  document.getElementById('experienceYears').value    = cfg.experienceYears   ?? 2;
  document.getElementById('passThreshold').value      = cfg.passThreshold     ?? 70;
  document.getElementById('additionalCriteria').value = cfg.additionalCriteria|| '';
  document.getElementById('thresholdDisplay').textContent = (cfg.passThreshold ?? 70) + '%';
}

/* ══════════════════════════════════════════════════════
   FILE HANDLING — drag-drop + browse
══════════════════════════════════════════════════════ */
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.add('drag-over');
}

function handleDragLeave(e) {
  document.getElementById('dropZone').classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) setFile(file);
}

function setFile(file) {
  const allowed = ['application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  const ext = file.name.split('.').pop().toLowerCase();

  if (!allowed.includes(file.type) && !['pdf','docx'].includes(ext)) {
    showError('Only PDF and DOCX files are supported.');
    return;
  }

  currentFile = file;
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileInfo').style.display  = 'flex';
  document.getElementById('analyzeBtn').disabled = false;
  hideResults();
}

function removeFile() {
  currentFile = null;
  document.getElementById('fileInput').value        = '';
  document.getElementById('fileInfo').style.display = 'none';
  document.getElementById('analyzeBtn').disabled    = true;
  hideResults();
}

/* ══════════════════════════════════════════════════════
   TEXT EXTRACTION — PDF via pdf.js, DOCX via mammoth
══════════════════════════════════════════════════════ */
async function extractText(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'pdf') {
    return extractFromPDF(file);
  } else if (ext === 'docx') {
    return extractFromDOCX(file);
  }
  throw new Error('Unsupported file type.');
}

async function extractFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }

  return fullText.trim();
}

async function extractFromDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

/* ══════════════════════════════════════════════════════
   MAIN ANALYZE FLOW
══════════════════════════════════════════════════════ */
async function analyzeResume() {
  // Always read the latest form values
  currentConfig = readConfigFromForm();

  if (!currentFile) {
    showError('Please upload a resume first.');
    return;
  }

  if (!currentConfig.jobDescription && !currentConfig.requiredSkills) {
    showError('Please fill in at least a Job Description or Required Skills in the config panel.');
    return;
  }

  setInputEnabled(false);
  hideResults();
  showLoading(true);

  try {
    // 1. Extract text from the CV
    const resumeText = await extractText(currentFile);

    if (!resumeText || resumeText.length < 50) {
      throw new Error('Could not extract readable text from this file. Try a different PDF/DOCX.');
    }

    // 2. Send to our serverless function
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resumeText,
        config: currentConfig,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${response.status}`);
    }

    const result = await response.json();

    // 3. Render results
    showLoading(false);
    renderResults(result, currentConfig);

    // 4. Save to history
    addToHistory({
      name:      result.candidateName || currentFile.name,
      score:     result.overallScore,
      verdict:   result.verdict,
      timestamp: new Date().toLocaleString(),
      result,
      config: { ...currentConfig },
    });

  } catch (err) {
    showLoading(false);
    showError(err.message);
  }

  setInputEnabled(true);
}

/* ══════════════════════════════════════════════════════
   RENDER RESULTS
══════════════════════════════════════════════════════ */
function renderResults(data, config) {
  const score     = Math.round(data.overallScore) || 0;
  const threshold = config.passThreshold || 70;

  // Determine tier
  let tier;
  if (score >= threshold)           tier = 'pass';
  else if (score >= threshold - 15) tier = 'warn';
  else                              tier = 'fail';

  /* Score ring animation */
  const circumference = 327; // 2π × 52
  const offset = circumference - (score / 100) * circumference;
  const ringFill = document.getElementById('ringFill');
  ringFill.style.strokeDashoffset = offset;
  ringFill.className = 'ring-fill ring-' + tier;

  /* Score number */
  animateNumber('scoreNumber', score);
  document.getElementById('scoreNumber').style.color =
    tier === 'pass' ? 'var(--success)' :
    tier === 'warn' ? 'var(--warning)' : 'var(--danger)';

  /* Verdict */
  const verdictEl  = document.getElementById('verdict');
  const verdictMap = {
    pass: '✅ Recommended',
    warn: '🟡 Review Recommended',
    fail: '❌ Not Recommended',
  };
  verdictEl.textContent = verdictMap[tier];
  verdictEl.className   = 'verdict ' + tier;

  document.getElementById('verdictSub').textContent =
    tier === 'pass' ? `Scored above the ${threshold}% pass threshold.` :
    tier === 'warn' ? `Close to the ${threshold}% threshold — manual review advised.` :
                     `Scored below the ${threshold}% pass threshold.`;

  /* Candidate name */
  if (data.candidateName) {
    document.getElementById('candidateName').textContent = data.candidateName;
    document.getElementById('candidateNameRow').style.display = 'flex';
  }

  /* Breakdown grid */
  const grid = document.getElementById('breakdownGrid');
  grid.innerHTML = '';
  const breakdown = data.breakdown || {};
  Object.entries(breakdown).forEach(([label, val]) => {
    const v    = Math.round(val);
    const tier = v >= 70 ? 'high' : v >= 45 ? 'medium' : 'low';
    grid.innerHTML += `
      <div class="breakdown-item">
        <div class="breakdown-label">${escapeHtml(label)}</div>
        <div class="breakdown-score ${tier}">${v}%</div>
      </div>`;
  });

  /* Detailed feedback */
  document.getElementById('feedbackContent').textContent = data.feedback || '';

  /* Strengths */
  const sList = document.getElementById('strengthsList');
  sList.innerHTML = '';
  (data.strengths || []).forEach(s => {
    const li = document.createElement('li');
    li.textContent = s;
    sList.appendChild(li);
  });

  /* Gaps */
  const gList = document.getElementById('gapsList');
  gList.innerHTML = '';
  (data.gaps || []).forEach(g => {
    const li = document.createElement('li');
    li.textContent = g;
    gList.appendChild(li);
  });

  /* Recommendation banner */
  const rec = document.getElementById('recommendationBlock');
  const recMap = {
    pass: { cls: 'recommend', text: '🚀 Recommendation: Proceed to interview stage.' },
    warn: { cls: 'review',    text: '👀 Recommendation: Conduct a brief screening call before deciding.' },
    fail: { cls: 'reject',    text: '🚫 Recommendation: Does not meet minimum requirements at this time.' },
  };
  rec.className   = 'recommendation-block ' + recMap[tier].cls;
  rec.textContent = recMap[tier].text;

  /* Show results panel */
  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ══════════════════════════════════════════════════════
   HISTORY
══════════════════════════════════════════════════════ */
function addToHistory(entry) {
  screeningHistory.unshift(entry);
  if (screeningHistory.length > 20) screeningHistory.pop(); // keep last 20
  localStorage.setItem('atsHistory', JSON.stringify(screeningHistory));
  renderHistory();
}

function renderHistory() {
  const section = document.getElementById('historySection');
  const grid    = document.getElementById('historyGrid');

  if (screeningHistory.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  grid.innerHTML = '';

  screeningHistory.forEach((entry, idx) => {
    const score = Math.round(entry.score);
    const tier  = getTier(score, entry.config?.passThreshold || 70);
    const card  = document.createElement('div');
    card.className = `history-card ${tier}`;
    card.innerHTML = `
      <div class="history-card-name">${escapeHtml(entry.name)}</div>
      <div class="history-card-score">${score}%</div>
      <div class="history-card-meta">${escapeHtml(entry.config?.jobTitle || 'No job title')} · ${escapeHtml(entry.timestamp)}</div>
    `;
    card.onclick = () => {
      applyConfigToForm(entry.config || {});
      currentConfig = entry.config || currentConfig;
      renderResults(entry.result, entry.config || currentConfig);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    grid.appendChild(card);
  });
}

function clearHistory() {
  screeningHistory = [];
  localStorage.removeItem('atsHistory');
  renderHistory();
}

/* ══════════════════════════════════════════════════════
   UI HELPERS
══════════════════════════════════════════════════════ */
function hideResults() {
  document.getElementById('resultsSection').style.display = 'none';
}

function showLoading(show) {
  document.getElementById('loadingState').style.display = show ? 'block' : 'none';
}

function setInputEnabled(enabled) {
  document.getElementById('analyzeBtn').disabled  = !enabled || !currentFile;
  document.getElementById('fileInput').disabled   = !enabled;
  document.getElementById('saveConfigBtn').disabled = !enabled;
}

function showError(msg) {
  // Simple inline error — replace results area temporarily
  const section = document.getElementById('resultsSection');
  section.style.display = 'block';
  section.innerHTML = `
    <div style="text-align:center;padding:40px 20px;">
      <div style="font-size:2.5rem;margin-bottom:12px;">⚠️</div>
      <p style="font-weight:700;color:#ef4444;font-size:1rem;margin-bottom:8px;">Something went wrong</p>
      <p style="color:#6b7280;font-size:.88rem;">${escapeHtml(msg)}</p>
      <button class="btn-new" style="margin-top:20px;max-width:240px;" onclick="resetResults()">Try Again</button>
    </div>`;
}

function resetResults() {
  removeFile();
  document.getElementById('resultsSection').style.display = 'none';
  // Restore results section structure if error wiped it
  location.reload();
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  let current = 0;
  const step = target / 40;
  const timer = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = Math.round(current);
    if (current >= target) clearInterval(timer);
  }, 20);
}

function getTier(score, threshold) {
  if (score >= threshold)           return 'pass';
  if (score >= threshold - 15)      return 'warn';
  return 'fail';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
