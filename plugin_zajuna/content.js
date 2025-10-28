// pdf.js expone pdfjsLib como global. Configura el worker:
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdfjs/pdf.worker.js');
}

async function fetchArrayBufferWithCookies(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status} al descargar PDF`);
  return r.arrayBuffer();
}



async function extractTextFromPDFUrl(url, maxChars = 60000) {
  try {
    const data = await fetchArrayBufferWithCookies(url);
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n';
      if (text.length >= maxChars) break;
    }
    return text.slice(0, maxChars);
  } catch (e) {
    console.warn('No se pudo leer el PDF:', url, e);
    return '';
  }
}

function isPDF(url='') { return /\.pdf(\?|#|$)/i.test(url); }

function baseParseRow(tr, idx) {
  const q = s => tr.querySelector(s);
  const rowId = tr.id || `row-${idx}`;
  const fullname = q('.c2 a')?.textContent.trim() || '';
  const onlineTextLink = q('.c9 a[href*="onlinetext"]')?.href || null;
  const files = Array.from(tr.querySelectorAll('.c10 a[href]')).map(a => ({ filename: a.textContent.trim(), url: a.href }));

  const header = `[Evidencia de ${fullname}]`;
  const fileList = files.map(f => `[Archivo] ${f.filename} -> ${f.url}`).join('\n');
  const inlineLine = onlineTextLink ? `[Texto en línea] ${onlineTextLink}` : '';
  const fallbackText = [header, fileList, inlineLine].filter(Boolean).join('\n');

  return {
    rowId,
    fullname,
    title: `Entrega de ${fullname}`,
    link: onlineTextLink || location.href,
    files,
    text: fallbackText
  };
}

async function collectEvidencesWithPDFs() {
  const rows = Array.from(document.querySelectorAll('table.generaltable tbody tr'))
    .filter(tr => tr.querySelector('.c2'));
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const base = baseParseRow(rows[i], i);
    const pdfs = base.files.filter(f => isPDF(f.url));
    if (pdfs.length) {
      let combined = '';
      for (const f of pdfs) {
        const txt = await extractTextFromPDFUrl(f.url);
        combined += txt
          ? `\n[EXTRACTO PDF: ${f.filename}]\n${txt}\n`
          : `\n[NO SE PUDO LEER PDF: ${f.filename} -> ${f.url}]\n`;
        if (combined.length > 90000) break;
      }
      base.text = (`[Evidencia de ${base.fullname}]\n` + combined).slice(0, 95000);
    }
    items.push(base);
  }
  return items;
}

function applyGrades(payload) {
  const results = [];
  for (const r of payload || []) {
    const tr = document.getElementById(r.rowId);
    if (!tr) { results.push({rowId:r.rowId, ok:false, reason:'row not found'}); continue; }
    const gradeInput = tr.querySelector('.c6 input.quickgrade');
    const feedbackTextarea = tr.querySelector('.c13 textarea, .c13 textarea.quickgrade');
    if (typeof r.score === 'number' && gradeInput) gradeInput.value = r.score;
    if (typeof r.feedback === 'string' && feedbackTextarea) feedbackTextarea.value = r.feedback;
    results.push({rowId:r.rowId, ok:true});
  }
  return results;
}

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type === 'COLLECT_EVIDENCES') {
    (async () => {
      try { sendResponse({ items: await collectEvidencesWithPDFs() }); }
      catch (e) { sendResponse({ error: String(e) }); }
    })();
    return true;
  }
  if (msg?.type === "GET_EVIDENCE_TOPIC") {
    const topic = getEvidenceNameFromMaincontent?.() || '';
    sendResponse({topic});
  }
  if (msg?.type === 'APPLY_GRADES') {
    sendResponse({ applied: applyGrades(msg.payload) });
  }
});
