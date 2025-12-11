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
function isDocx(url='') { return /\.docx(\?|#|$)/i.test(url); }

async function inflateRaw(data) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Response(stream).arrayBuffer();
}

async function extractDocxXmlEntry(buffer, entryName) {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();

  function readString(start, length) {
    return decoder.decode(buffer.slice(start, start + length));
  }

  function findEndOfCentralDirectory() {
    for (let i = buffer.byteLength - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  const eocd = findEndOfCentralDirectory();
  if (eocd === -1) return null;

  const centralDirSize = view.getUint32(eocd + 12, true);
  const centralDirOffset = view.getUint32(eocd + 16, true);
  const end = centralDirOffset + centralDirSize;

  let offset = centralDirOffset;
  while (offset < end) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const fileNameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = readString(offset + 46, fileNameLen);

    if (name === entryName) {
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return null;
      const compressionMethod = view.getUint16(localHeaderOffset + 8, true);
      const fileNameLength = view.getUint16(localHeaderOffset + 26, true);
      const extraFieldLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + fileNameLength + extraFieldLength;
      const compressedSize = view.getUint32(localHeaderOffset + 18, true);
      const slice = buffer.slice(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) return new Uint8Array(slice);
      if (compressionMethod === 8) return new Uint8Array(await inflateRaw(slice));
      return null;
    }

    offset += 46 + fileNameLen + extraLen + commentLen;
  }

  return null;
}

async function extractTextFromDocxUrl(url, maxChars = 60000) {
  try {
    const buffer = await fetchArrayBufferWithCookies(url);
    const xmlBytes = await extractDocxXmlEntry(buffer, 'word/document.xml');
    if (!xmlBytes) return '';
    const xml = new TextDecoder().decode(xmlBytes);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const texts = Array.from(doc.getElementsByTagName('w:t')).map(n => n.textContent || '');
    return texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
  } catch (e) {
    console.warn('No se pudo leer el DOCX:', url, e);
    return '';
  }
}

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
    const docxs = base.files.filter(f => isDocx(f.url));
    if (pdfs.length || docxs.length) {
      let combined = '';
      for (const f of pdfs) {
        const txt = await extractTextFromPDFUrl(f.url);
        combined += txt
          ? `\n[EXTRACTO PDF: ${f.filename}]\n${txt}\n`
          : `\n[NO SE PUDO LEER PDF: ${f.filename} -> ${f.url}]\n`;
        if (combined.length > 90000) break;
      }
      for (const f of docxs) {
        const txt = await extractTextFromDocxUrl(f.url);
        combined += txt
          ? `\n[EXTRACTO DOCX: ${f.filename}]\n${txt}\n`
          : `\n[NO SE PUDO LEER DOCX: ${f.filename} -> ${f.url}]\n`;
        if (combined.length > 90000) break;
      }
      if (combined) base.text = (`[Evidencia de ${base.fullname}]\n` + combined).slice(0, 95000);
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
