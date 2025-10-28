const apiKeyEl = document.getElementById('apiKey');
const rubricEl = document.getElementById('rubric');

chrome.storage.sync.get(["apiKey","rubric"], (cfg) => {
  apiKeyEl.value = cfg.apiKey || "";
  rubricEl.value = cfg.rubric || "";
});

document.getElementById('save').onclick = () => {
  chrome.storage.sync.set({
    apiKey: apiKeyEl.value.trim(),
    rubric: rubricEl.value.trim()
  }, () => alert("Guardado"));
};
