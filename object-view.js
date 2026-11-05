'use strict';
const groups = [
 ['general','Общие данные',null], ['SA','Схемы автоматизации','схема автоматизации'],
 ['SP','Принципиальные схемы','схема принципиальная'], ['SV','Схемы внешних соединений','схема внешних соединений'],
 ['PL','План цепей управления','план'], ['spec','Спецификация','спецификация оборудования']
];
const cache = new Map();
const children = (node, tag) => Array.from(node.children).filter(e => e.localName === tag);
const text = (node, tag) => children(node,tag)[0]?.textContent.trim() || '';
const xml = node => new XMLSerializer().serializeToString(node);
const el = (tag, value, parent, cls) => { const e=document.createElement(tag); if(value != null)e.textContent=value; if(cls)e.className=cls; if(parent)parent.append(e); return e; };
async function load(name) {
 if(!cache.has(name)) cache.set(name, fetch(encodeURIComponent(name)+'.xml').then(async r => {
  if(!r.ok)throw Error('Не удалось загрузить '+name+'.xml ('+r.status+')');
  const bytes=new Uint8Array(await r.arrayBuffer());
  const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
  const doc=new DOMParser().parseFromString(new TextDecoder(encoding).decode(bytes),'application/xml');
  if(doc.querySelector('parsererror'))throw Error('Некорректный XML: '+name);
  return doc.documentElement;
 }));
 return (await cache.get(name)).cloneNode(true);
}
function holds(condition, values) {
 return !condition || condition.split(/\s+/).every(term => {
  const m=term.match(/^(\w+)(!=|>=|<=|=|>|<)(.*)$/); if(!m)return false;
  let a=values[m[1]]??'',b=m[3]; if(a!==''&&b!==''&&Number.isFinite(Number(a))&&Number.isFinite(Number(b))){a=Number(a);b=Number(b);}
  return ({'=':a==b,'!=':a!=b,'>':a>b,'<':a<b,'>=':a>=b,'<=':a<=b})[m[2]];
 });
}
function apply(root, values) {
 for(const n of Array.from(root.querySelectorAll('[IF]'))){if(!holds(n.getAttribute('IF'),values))n.remove();else n.removeAttribute('IF');}
 const replace = s => s.replace(/\{([^{}]+)\}/g,(all,key)=>{
  if(Object.hasOwn(values,key))return values[key];
  const expr=key.replace(/[A-Za-z_]\w*/g,name=>values[name]??name);
  if(!/^[\d.\s+*/-]+$/.test(expr))return all;
  let sum=0;
  for(const term of expr.replace(/\s/g,'').match(/[+-]?[^+-]+/g)||[]){
   const tokens=term.split(/([*/])/);let value=Number(tokens[0]);
   for(let i=1;i<tokens.length;i+=2)value=tokens[i]==='*'?value*Number(tokens[i+1]):value/Number(tokens[i+1]);
   sum+=value;
  }
  return Number.isFinite(sum)?String(sum):all;
 });
 for(const n of [root,...root.querySelectorAll('*')]){
  for(const a of Array.from(n.attributes))if(a.name!=='IF')n.setAttribute(a.name,replace(a.value));
  for(const t of Array.from(n.childNodes))if(t.nodeType===3)t.nodeValue=replace(t.nodeValue);
 }
}
async function expand(svg, tip, depth=0) {
 if(depth>25)throw Error('Слишком глубокая вложенность изображений');
 for(const ref of Array.from(svg.querySelectorAll('Bl,Bl0,El,Mdl'))){
  if(!svg.contains(ref))continue;
  const name=ref.getAttribute('Name');
  if(ref.localName==='Bl0'||name==='Font'){ref.remove();continue;}
  const obj=await load(name),views=children(obj,'svg');
  const view=obj.localName==='Bl'?views[0]:views.find(v=>v.getAttribute('tip')===tip)||views[0];
  if(!view)throw Error('Нет изображения: '+name);
  const g=document.createElementNS('http://www.w3.org/2000/svg','g');
  if(ref.hasAttribute('transform'))g.setAttribute('transform',ref.getAttribute('transform'));
  for(const node of Array.from(view.children))g.append(node.cloneNode(true));
  const params=children(ref,'Pr');
  for(const n of g.querySelectorAll('[id]')){
   const id=n.getAttribute('id'); n.removeAttribute('id');
   for(const p of params.filter(p=>p.getAttribute('bid')===id)){
    for(const a of Array.from(p.attributes))if(a.name!=='bid')n.setAttribute(a.name,a.value);
    if(p.childNodes.length)n.replaceChildren(...Array.from(p.childNodes).map(c=>c.cloneNode(true)));
   }
  }
  const local={};
  for(const v of children(obj,'var')){
   const id=v.getAttribute('id'),override=params.filter(p=>p.getAttribute('bid')===id).at(-1);
   local[id]=override?override.textContent:v.getAttribute('default')||'';
  }
  if(Object.keys(local).length)apply(g,local);
  await expand(g,tip,depth+1);ref.replaceWith(g);
 }
}
function table(parent, heads, rows) {
 if(!rows.length){el('p','Данные в XML не заданы.',parent,'empty');return;}
 const wrap=el('div',null,parent,'table-wrap'),t=el('table',null,wrap,'table table-sm table-bordered');
 const header=el('tr',null,el('thead',null,t)); for(const h of heads)el('th',h,header);
 const body=el('tbody',null,t);for(const row of rows){const tr=el('tr',null,body);for(const value of row)el('td',value,tr);}
}
function specRow(o) {return [text(o,'POS'),text(o,'SNAME')||o.getAttribute('Name')||'',text(o,'MARK'),text(o,'MAKER'),text(o,'UNIT'),text(o,'QTY')];}
async function material(o) {
 const result=o.cloneNode(true),tpl=text(o,'TPL');
 if(tpl){const base=await load(tpl);for(const tag of ['TYPE','MARK','MAKER','UNIT','SNAME'])if(!text(result,tag)){
  const value=tag==='SNAME'?base.getAttribute('Name'):text(base,tag);if(value){const n=result.ownerDocument.createElement(tag);n.textContent=value;result.append(n);}
 }}
 if(text(result,'UNIT')&&!text(result,'QTY')){const n=result.ownerDocument.createElement('QTY');n.textContent='1';result.append(n);}
 return result;
}
async function drawing(view, parent, label, tip, scope={}) {
 const card=el('article',null,parent,'view');el('h3',label,card);
 const area=el('div',null,card,'drawing');
 try{
  const svg=view.cloneNode(true);await expand(svg,tip);apply(svg,scope);

  const markup=xml(svg);area.innerHTML=markup;
  const details=el('details',null,card);el('summary','SVG',details);el('pre',markup,details);
 }catch(error){el('p',error.message,area,'text-danger');}
}
let original, values={};
async function render() {
 const root=original.cloneNode(true);apply(root,values);
 const content=document.getElementById('content');content.replaceChildren();
 const sections={};for(const [id,title] of groups){const section=el('section',null,content);section.id=id;el('h2',title,section);sections[id]=section;}
 const general=sections.general;
 const vars=children(original,'var');if(vars.length){el('h3','Параметры объекта',general);const form=el('div',null,general,'params');for(const v of vars){
  const label=el('label',v.getAttribute('name'),form);const opts=children(v,'opt');const input=el(opts.length?'select':'input',null,label,'form-control');
  if(opts.length)for(const o of opts){const option=el('option',o.getAttribute('name'),input);option.value=o.getAttribute('value');}
  else {input.type=v.getAttribute('type')==='i'?'number':'text';for(const a of ['min','max'])if(v.hasAttribute(a))input.setAttribute(a,v.getAttribute(a));}
  input.setAttribute('aria-label',v.getAttribute('name'));input.value=values[v.getAttribute("id")];input.addEventListener('change',async()=>{values[v.getAttribute("id")]=input.value;await render();});
 }}
 el('h3','Тексты и требования по вставке',general);
 const skip=new Set(['svg','var','DOCS','OBJS','LNKS','Elements','MARK','MAKER','UNIT','QTY']);
 const notes=Array.from(root.children).filter(n=>!skip.has(n.localName));
 const comments=Array.from(root.childNodes).filter(n=>n.nodeType===8&&n.textContent.trim());
 if(comments.length){const details=el('details',null,general);el('summary','Пояснения по графике и вставке из XML',details);for(const comment of comments)el('p',comment.textContent.trim(),details);}
 if(notes.length)table(general,['Свойство XML','Содержание'],notes.map(n=>[n.localName,n.children.length?xml(n):n.textContent.trim()]));
 const objects=root.localName==='El'?[root]:Array.from(root.querySelectorAll('OBJS OBJ')).filter(o=>!o.closest('DOC'));
 const docs=Array.from(root.querySelectorAll('DOCS > DOC'));
 for(const [id,,type] of groups){
  const section=sections[id];const images=el('div',null,section,'graphics');let count=0;
  for(const view of children(root,'svg')){
   const tip=view.getAttribute('tip');
   if((id===tip)||(id==='general'&&!groups.some(g=>g[0]===tip))){await drawing(view,images,view.getAttribute('PART')||tip||'Изображение',tip);count++;}
  }
  if(['SA','SP','SV','PL'].includes(id))for(const o of objects){
   if(!children(o,'VIEW').some(v=>text(v,'TYPE')===type)||!text(o,'TPL'))continue;
   const typical=await load(text(o,'TPL')),m=await material(o);
   const scope={...values,POS:text(o,'POS'),SNAME:text(m,'SNAME'),MARK:text(m,'MARK'),QTY:text(m,'QTY'),UNIT:text(m,'UNIT')};
   const positions=new Set([o,...o.querySelectorAll('OBJ')].map(n=>text(n,'POS')).filter(Boolean));
   for(const link of root.querySelectorAll('LNKS > LNK'))for(const end of ['FROM','TO']){
    const endpoint=children(link,end)[0];if(endpoint&&positions.has(text(endpoint,'SNAME')))scope['LNK_'+text(endpoint,'PIN')]=text(link,'POS');
   }
   for(const view of children(typical,'svg').filter(v=>v.getAttribute('tip')===id)){
    await drawing(view,images,[text(o,'POS'),text(m,'SNAME'),view.getAttribute('PART')].filter(Boolean).join(' — '),id,scope);count++;
   }
  }
  for(const doc of docs){for(const sheet of Array.from(doc.querySelectorAll('SHTS > SHT'))){
   const sheetType=text(sheet,'TYPE');if((id==='general'&&['текст','ведомость'].includes(sheetType))||sheetType===type){
    for(const view of children(sheet,'svg')){await drawing(view,images,text(sheet,'SNAME')||sheetType,id);count++;}
    if(!children(sheet,'svg').length)el('p',text(sheet,'SNAME')+' — лист собирается генератором по составу и связям XML.',section,'empty');
   }
  }}
  if(['SA','SP','SV','PL'].includes(id)&&!count)el('p','Графика этого вида в XML не задана.',section,'empty');
  if(['SP','SV'].includes(id)){
   el('h3','Угловая спецификация',section);
   const entries=[];
   for(const o of objects){const m=await material(o);const participates=children(o,'VIEW').some(v=>text(v,'TYPE')===type)||children(o,'svg').some(v=>v.getAttribute('tip')===id);
    if(participates&&text(m,'UNIT')&&(id!=='SV'||['кабель','труба'].includes(text(m,'TYPE'))))entries.push(specRow(m));
   }
   table(section,['Обозначение','Наименование','Количество','Примечание'],entries.map(r=>[r[0],[r[1],r[2]].filter(Boolean).join(', '),[r[5],r[4]].filter(Boolean).join(' '),'']));
  }
  if(id==='spec'){
   const specDocs=docs.filter(d=>text(d,'TYPE')===type);
   if(specDocs.length){
    const byId=new Map(objects.map(o=>[o.getAttribute("id"),o]));
    async function rows(parent){const result=[];for(const item of children(parent,'OBJ')){const ref=text(item,'REF'),source=byId.get(ref);
     if(ref&&!source)continue;
     const row=source?await material(source):item;
     const line=specRow(row);if(text(item,'SNAME'))line[1]=text(item,'SNAME');if(children(item,'OBJS').length){line[2]='';line[3]='';line[4]='';line[5]='';}
     result.push(line);for(const sub of children(item,'OBJS'))result.push(...await rows(sub));
    }return result;}
    for(const doc of specDocs)for(const list of children(doc,'OBJS'))table(section,['Позиция','Наименование','Марка','Изготовитель','Ед. изм.','Количество'],await rows(list));
   }else table(section,['Позиция','Наименование','Марка','Изготовитель','Ед. изм.','Количество'],await Promise.all(objects.map(async o=>specRow(await material(o)))));
  }
 }
 if(location.hash)document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
(async()=>{try{
 const name=new URLSearchParams(location.search).get('name');if(!name)throw Error('Выберите объект в каталоге.');
 original=await load(name);document.getElementById('title').textContent=original.getAttribute('Name')||name;
 document.title=(original.getAttribute('Name')||name)+' — pravtru';document.getElementById('file').textContent=name+'.xml';document.getElementById('source').textContent=xml(original);
 for(const v of children(original,'var'))values[v.getAttribute("id")]=v.getAttribute('default')||'';
 for(const [id,title] of groups){const a=el('a',title,document.getElementById('sections'));a.href='#'+id;}
 const font=await load('Font');
 if(!document.getElementById('gost-font')){const style=el('style',Array.from(font.querySelectorAll('style')).map(n=>n.textContent).join('\n'),document.head);style.id='gost-font';}
 await render();document.getElementById('status').remove();
}catch(error){document.getElementById('status').textContent=error.message;}})();
