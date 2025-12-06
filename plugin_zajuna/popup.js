const out = document.getElementById('out');
const topicInput = document.getElementById('manualTopic');

async function ensureContentScripts(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["lib/pdfjs/pdf.js", "content.js"],
    });
  } catch (e) {
    console.warn("No se pudieron inyectar los content scripts:", e);
  }
}

function setFeedback(message) {
  const words = message.trim().split(/\s+/);
  return words.length > 30 ? `${words.slice(0, 30).join(" ")}…` : message;
}

// Guardar el último tema escrito (opcional)
chrome.storage.sync.get(["lastTopic"], (cfg) => {
  if (cfg.lastTopic) topicInput.value = cfg.lastTopic;
});

document.getElementById('run').onclick = async () => {
  const topic = topicInput.value.trim();
  if (!topic) {
    out.textContent = setFeedback("Por favor escribe el tema de la evidencia antes de calificar.");
    return;
  }

  // Guardar el tema para la próxima vez
  chrome.storage.sync.set({ lastTopic: topic });

  out.textContent = setFeedback("Analizando evidencias...");
  const [tab] = await chrome.tabs.query({active:true, currentWindow:true});

  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, {type:"COLLECT_EVIDENCES"});
  } catch (err) {
    // Si el content script no estaba presente, lo inyectamos y reintentamos.
    await ensureContentScripts(tab.id);
    try {
      res = await chrome.tabs.sendMessage(tab.id, {type:"COLLECT_EVIDENCES"});
    } catch (err2) {
      out.textContent = setFeedback("No pudimos comunicarnos con la página. Recarga la pestaña y vuelve a intentar.");
      console.error("Error al enviar mensaje al content script", err2);
      return;
    }
  }
  if (!res || !res.items?.length) {
    out.textContent = setFeedback("No se encontraron evidencias.");
    return;
  }

  // Añadimos el tema manual al objeto antes de enviarlo
  const items = res.items.map(it => ({ ...it, manualTopic: topic }));

  out.textContent = setFeedback(`Calificando ${items.length} evidencia(s)...`);
  const graded = await chrome.runtime.sendMessage({type:"GRADE_AND_APPLY", items});
  out.textContent = setFeedback(graded?.error ? `Error: ${graded.error}` : "Calificación completada ✅");
};
