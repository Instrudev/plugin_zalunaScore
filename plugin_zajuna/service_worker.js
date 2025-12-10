const MODEL = "gpt-4.1";

function isPDF(url = "") { return /\.pdf(\?|#|$)/i.test(url); }
function isDocx(url = "") { return /\.docx(\?|#|$)/i.test(url); }
function isImage(url = "") { return /\.(png|jpe?g|gif|bmp|webp)(\?|#|$)/i.test(url); }

async function callOpenAI(apiKey, item, rubric) {
  const system = `
Eres un evaluador académico.
Devuelve siempre un JSON válido con:
- score (entero 0-100)
- feedback (máximo 30 palabras, tono académico)
Usa la rúbrica proporcionada. Español.
`;

  const topicLine = item.manualTopic
    ? `Tema proporcionado por el docente: ${item.manualTopic}`
    : "(sin tema proporcionado manualmente)";

  const user = `
RÚBRICA:
${rubric || "(sin rúbrica: evalúa pertinencia, claridad, profundidad, estructura y originalidad)"}

${topicLine}

EVIDENCIA:
Título: ${item.title}
Referencia: ${item.link}
Contenido visible:
${item.text}
`;

  const body = {
    model: MODEL,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" }
  };
  const resp = await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":`Bearer ${apiKey}`
    },
    body:JSON.stringify(body)
  });
  if(!resp.ok) throw new Error("OpenAI HTTP "+resp.status);
  const data = await resp.json();
  const text = data?.output?.[0]?.content?.[0]?.text || "{}";

  const limitFeedback=(msg)=>{
    const words=String(msg||"").trim().split(/\s+/).filter(Boolean);
    const trimmed=words.slice(0,30).join(" ");
    return trimmed||"Cordial saludo. No se encontró información suficiente para evaluar la evidencia.";
  };

  let parsed={};
  try{parsed=JSON.parse(text);}catch{parsed={};}
  const score=Math.round(Math.max(0,Math.min(100,Number(parsed.score)||0)));
  const feedback=limitFeedback(parsed.feedback);
  return {rowId:item.rowId,score,feedback};
}

chrome.runtime.onMessage.addListener((msg,_s,sendResponse)=>{
  if(msg?.type==="GRADE_AND_APPLY"){
    chrome.storage.sync.get(["apiKey","rubric"], async (cfg)=>{
      if(!cfg.apiKey) return sendResponse({error:"Configura tu API key en Opciones."});
      try{
        const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
        const results=[];
        for(const it of msg.items){
          const hasUnsupportedAttachment = Array.isArray(it.files)
            && it.files.some(f=>{
              const url = f.url || "";
              return !isPDF(url) && !isDocx(url) && !isImage(url);
            });
          if(hasUnsupportedAttachment){
            const zeroResult={
              rowId:it.rowId,
              score:0,
              feedback:"Cordial Saludo, Revisada tu evidencia. Se detectaron archivos que no están en formato PDF, DOCX o imagen, por lo que no fue posible evaluarla. Por favor adjunta el documento en un formato compatible."
            };
            results.push(zeroResult);
            await chrome.tabs.sendMessage(tab.id,{type:"APPLY_GRADES",payload:[zeroResult]});
            continue;
          }
          const g=await callOpenAI(cfg.apiKey,it,cfg.rubric);
          results.push(g);
          await chrome.tabs.sendMessage(tab.id,{type:"APPLY_GRADES",payload:[g]});
        }
        sendResponse({results});
      }catch(e){sendResponse({error:String(e)});}
    });
    return true;
  }
});
