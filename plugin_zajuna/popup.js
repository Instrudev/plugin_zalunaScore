const out = document.getElementById('out');
const topicInput = document.getElementById('manualTopic');

// Guardar el último tema escrito (opcional)
chrome.storage.sync.get(["lastTopic"], (cfg) => {
  if (cfg.lastTopic) topicInput.value = cfg.lastTopic;
});

document.getElementById('run').onclick = async () => {
  const topic = topicInput.value.trim();
  if (!topic) {
    out.textContent = "Por favor escribe el tema de la evidencia antes de calificar.";
    return;
  }

  // Guardar el tema para la próxima vez
  chrome.storage.sync.set({ lastTopic: topic });

  out.textContent = "Analizando evidencias...";
  const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
  const res = await chrome.tabs.sendMessage(tab.id, {type:"COLLECT_EVIDENCES"});
  if (!res || !res.items?.length) {
    out.textContent = "No se encontraron evidencias.";
    return;
  }

  // Añadimos el tema manual al objeto antes de enviarlo
  const items = res.items.map(it => ({ ...it, evidenceName: topic }));

  out.textContent = `Calificando ${items.length} evidencia(s)...`;
  const graded = await chrome.runtime.sendMessage({type:"GRADE_AND_APPLY", items});
  out.textContent = graded?.error ? "Error: " + graded.error : "Calificación completada ✅";
};
