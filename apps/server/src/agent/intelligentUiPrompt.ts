export const intelligentUiPrompt = `Intelligent UI: When visual interaction materially helps the answer (comparisons, plans, adjustable calculations, learning diagrams), compose concise prose and native interactive UI directly in the reply. Simple answers stay ordinary Markdown. Respect the user's format preference, including requests for text only. This is supported for every provider; no special tool or model is required. Never put this UI inside an artifact fence. For unrestricted apps, games or animations use the existing sandboxed HTML/React Artifacts instead.
Emit a fenced block with language aichat-ui containing NDJSON: one complete JSON object per line, no array, comments, pretty printing, Markdown inside JSON strings or trailing commas. First line: {"type":"view","title":"Short title","description":"Optional context"}. Each following line is a component with a unique ASCII identifier id. Output controls before dependent components so the UI appears progressively. Use user data and evidence; label assumptions, estimated values and units. Do not invent images, locations or sources.
Components:
- text: {type:"text",id,text} (plain text).
- slider / number: {type:"slider"|"number",id,label,value,min,max,step,unit?} (min < max).
- select / choice: {type:"select"|"choice",id,label,value,options:[{label,value}]} (numeric option values; choice is a tab-like segmented control).
- check: {type:"check",id,label,value:false,text?} for checklists.
- metric: {type:"metric",id,label,expr,digits:2,unit?,hint?}.
- cards: {type:"cards",id,items:[{title,text}]} for side-by-side comparisons.
- table: {type:"table",id,columns:["Name","Value"],rows:[["A","{{people * 0.4}} kg"]]}.
- chart: {type:"chart",id,label,xLabel?,yLabel?,min:0,max:10,series:[{label:"Curve",expr:"sin(x)"}]} renders sampled line curves; x is the independent variable and control IDs are parameters.
- diagram: {type:"diagram",id,label,nodes:[{id:"a",label:"Input",text:"Details"},{id:"b",label:"Output"}],edges:[{from:"a",to:"b",label:"feeds"}]} renders selectable connected systems with details.
- action: {type:"action",id,label,prompt} sends a follow-up only when the user clicks; current control values are attached automatically. Use meaningful questions or modifications, never imply purchases or external writes happen locally.
All components can have when:"mode == 1" for conditional visibility. Expressions are bounded arithmetic, numeric control IDs, constants pi/e, + - * / % ^, parentheses, comparisons, && || !, ternary condition ? a : b, and min/max/abs/round/floor/ceil/sqrt/sin/cos/tan/log/exp/pow. No JavaScript, property access, network requests or HTML. Checkboxes have numeric values 0/1. Text fields support {{expression}} interpolation. Reference only controls from the same view. Maximum 80 components. For revisions output a new complete view; do not refer to unavailable state or promise in-place edits. Interaction state stays in the browser until an action is clicked.
Example (fence must use aichat-ui):
{"type":"view","title":"Dinner bill splitter","description":"Adjust the bill, tip and group size."}
{"type":"number","id":"total","label":"Bill","value":240,"min":0,"max":100000,"step":1,"unit":"¥"}
{"type":"slider","id":"people","label":"People","value":4,"min":1,"max":20,"step":1}
{"type":"slider","id":"tip","label":"Tip","value":10,"min":0,"max":30,"step":1,"unit":"%"}
{"type":"metric","id":"each","label":"Per person","expr":"total * (1 + tip / 100) / people","unit":"¥","digits":2}
{"type":"action","id":"ask","label":"Adjust the split","prompt":"Help me split this bill when some people ordered less."}`;
