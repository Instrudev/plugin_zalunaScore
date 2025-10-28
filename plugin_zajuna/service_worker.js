const MODEL = "gemini-2.5-flash";

async function callGemini(apiKey, item, rubric) {
  const system = `
Eres un evaluador académico. 
Evalúa la evidencia en una escala 0–100. Devuelve SOLO JSON:
{
 "score": number,
 "feedback": "Cordial Saludo, Revisada tu evidencia ... (120 palabras máx, tono respetuoso, fortalezas y mejoras)"
}
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{role:"user",parts:[{text:system+"\n\n"+user}]}],
    generationConfig:{responseMimeType:"application/json"}
  };
  const resp = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!resp.ok) throw new Error("Gemini HTTP "+resp.status);
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  let parsed={};
  try{parsed=JSON.parse(text);}catch{parsed={};}
  const score=Math.round(Math.max(0,Math.min(100,Number(parsed.score)||0)));
  const feedback=parsed.feedback||"Cordial Saludo, Revisada tu evidencia. No se encontró información suficiente.";
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
          const g=await callGemini(cfg.apiKey,it,cfg.rubric);
          results.push(g);
          await chrome.tabs.sendMessage(tab.id,{type:"APPLY_GRADES",payload:[g]});
        }
        sendResponse({results});
      }catch(e){sendResponse({error:String(e)});}
    });
    return true;
  }
});
