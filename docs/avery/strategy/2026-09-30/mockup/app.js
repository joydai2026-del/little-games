// Avery Studio future-platform MOCKUP. All data below is sample; covers/previews are real Avery TPT art.
const W = s => s.split(/\s+(?=[\u4e00-\u9fff])/).map(x => { const [hz, py, gl] = x.split('|'); return { hz, py, gl }; });
const PACKS = [
  { id:'pumpkin', pack:'halloween-2026', zh:'万圣节南瓜手工', en:'Halloween Pumpkin Craft & Coloring', season:'halloween', skills:['crafts','games','writing'], pages:14, pageImgs:true, tpt:'#17774630',
    words:W('南瓜|nánguā|pumpkin 月亮|yuèliang|moon 黑猫|hēimāo|black cat 糖果|tángguǒ|candy 蝙蝠|biānfú|bat 幽灵|yōulíng|ghost 巫师帽|wūshīmào|witch hat 朋友|péngyou|friend'),
    inside:[['2','词语卡 8 picture word cards','全班'],['3–4','看字涂颜色 · 神秘图画 mystery pictures','K–2'],['5','掷骰子，做南瓜脸 roll & build','全班'],['6','转一转，涂南瓜 spinner race','K–2'],['7','南瓜转转轮 word-wheel craft','全班'],['8','排一排，写一写 sequencing','1–3'],['9–11','描一描 / 看图写字 / 我的万圣节 writing, 3 levels','K–5'],['13','课堂游戏 QR → Avery Games','教师']] },
  { id:'bat', pack:'halloween-bat', zh:'万圣节蝙蝠手工', en:'Halloween Bat Craft & Games', season:'halloween', skills:['crafts','games','writing'], pages:15,
    words:W('蝙蝠|biānfú|bat 翅膀|chìbǎng|wings 耳朵|ěrduo|ears 眼睛|yǎnjing|eyes 山洞|shāndòng|cave 晚上|wǎnshang|night 白天|báitiān|day 倒挂|dàoguà|hang upside down') },
  { id:'costumes', pack:'halloween-costumes', zh:'万圣节变装 我是…', en:'Costume Speaking Centers', season:'halloween', skills:['centers','games','reading'], pages:15,
    words:W('医生|yīshēng|doctor 警察|jǐngchá|police 老师|lǎoshī|teacher 厨师|chúshī|chef 猫|māo|cat 老虎|lǎohǔ|tiger 熊猫|xióngmāo|panda 兔子|tùzi|rabbit') },
  { id:'emotions-monsters', pack:'monsters-feelings', zh:'情绪小怪兽', en:'Emotions Monsters SEL Centers', season:'halloween', skills:['centers','games'], pages:15,
    words:W('高兴|gāoxìng|happy 生气|shēngqì|angry 害怕|hàipà|scared 难过|nánguò|sad 惊讶|jīngyà|surprised 害羞|hàixiū|shy 累|lèi|tired 平静|píngjìng|calm') },
  { id:'autumn', pack:'autumn-2026', zh:'秋天来了', en:'Autumn Activity Pack', season:'autumn', skills:['games','crafts','writing'], pages:14,
    words:W('秋天|qiūtiān|autumn 树叶|shùyè|leaf 松鼠|sōngshǔ|squirrel 松果|sōngguǒ|pinecone 苹果|píngguǒ|apple 稻草人|dàocǎorén|scarecrow 大雁|dàyàn|wild geese 篮子|lánzi|basket') },
  { id:'autumn-reader', pack:'autumn-reader', zh:'小松鼠的秋天', en:'Squirrel\'s Autumn · Reader', season:'autumn', skills:['reading','writing'], pages:15,
    words:W('秋天|qiūtiān|autumn 松鼠|sōngshǔ|squirrel 松果|sōngguǒ|pinecone 小兔子|xiǎotùzi|bunny 篮子|lánzi|basket 大风|dàfēng|big wind 树洞|shùdòng|tree hole 帮忙|bāngmáng|help') },
  { id:'thanksgiving', pack:'thanksgiving-2026', zh:'感恩节火鸡手工', en:'Thanksgiving Turkey Gratitude Craft', season:'thanksgiving', skills:['crafts','games','writing'], pages:14,
    words:W('感恩节|gǎnēnjié|Thanksgiving 火鸡|huǒjī|turkey 羽毛|yǔmáo|feather 谢谢|xièxie|thank you 家人|jiārén|family 大餐|dàcān|feast 玉米|yùmǐ|corn 土豆|tǔdòu|potato') },
  { id:'winter', pack:'winter-2026', zh:'冬天来了', en:'Winter: Clothes & Weather Unit', season:'winter', skills:['games','writing','reading'], pages:14,
    words:W('冬天|dōngtiān|winter 雪人|xuěrén|snowman 下雪|xiàxuě|snowing 冷|lěng|cold 围巾|wéijīn|scarf 帽子|màozi|hat 手套|shǒutào|gloves 外套|wàitào|coat') },
  { id:'winter-holidays', pack:'newyear-2027', zh:'冬季节日 · 新年快乐', en:'Winter Holidays & New Year', season:'newyear', skills:['crafts','games','writing'], pages:14,
    words:W('礼物|lǐwù|gift 新年|xīnnián|new year 贺卡|hèkǎ|card 饺子|jiǎozi|dumplings 灯|dēng|lights 蛋糕|dàngāo|cake 烟花|yānhuā|fireworks 家人|jiārén|family') },
];
const SEASONS = { autumn:['秋天','Autumn','t-accent'], halloween:['万圣节','Halloween','t-pink'], thanksgiving:['感恩节','Thanksgiving','t-butter'], winter:['冬天','Winter','t-sky'], newyear:['新年','New Year','t-sage'] };
const SKILLS = { reading:['阅读','Reading'], writing:['写字·笔顺','Writing / 笔顺'], crafts:['手工','Crafts'], centers:['学习中心','Centers'], games:['游戏','Games'] };
const GAMES = [
  { k:'vocab', zh:'词语游戏', en:'Vocab Games', g:'词', c:'var(--butter-soft)' },
  { k:'trace', zh:'笔顺比赛', en:'Trace Race', g:'笔', c:'var(--sky-soft)' },
  { k:'reveal', zh:'猜猜我是谁', en:'Stroke Reveal', g:'猜', c:'var(--pink-soft)' },
  { k:'tzg', zh:'田字格', en:'Writing sheets', g:'田', c:'var(--sage-soft)' },
  { k:'bingo', zh:'宾果', en:'Bingo Night', g:'宾', c:'var(--accent-soft)' },
  { k:'says', zh:'墨墨说', en:'Momo Says', g:'说', c:'var(--mascot)' },
];
const $ = s => document.querySelector(s);
function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),2200); }
function lvls(){ return '<span class="lvl l1">初级 K–1</span><span class="lvl l2">中级 1–3</span><span class="lvl l3">高级 2–5</span>'; }

/* ---------- Library ---------- */
const F = { grade:'all', season:'all', skill:new Set(), level:'all' };
function chip(group,val,label,on){ return `<button class="chip ${on?'on':''}" data-g="${group}" data-v="${val}">${label}</button>`; }
function renderFilters(){
  const g=['all','K','1','2','3','4','5'];
  $('#filters').innerHTML = `
    <h4>年级 <span class="en">Grade</span></h4><div class="chips">${g.map(x=>chip('grade',x,x==='all'?'全部 All':x,F.grade===x)).join('')}</div>
    <h4>季节 · 节日 <span class="en">Season / holiday</span></h4><div class="chips">${chip('season','all','全部 All',F.season==='all')}${Object.entries(SEASONS).map(([k,v])=>chip('season',k,v[0]+' '+v[1],F.season===k)).join('')}</div>
    <h4>主题 <span class="en">Theme</span></h4><div class="chips">${['动物 Animals','情绪 Feelings','衣服 Clothes','食物 Food','职业 Jobs'].map(x=>`<button class="chip" onclick="toast('Theme filter (mockup)')">${x}</button>`).join('')}</div>
    <h4>技能 <span class="en">Skill</span></h4><div class="chips">${Object.entries(SKILLS).map(([k,v])=>chip('skill',k,v[0]+' <span style=\"font-weight:600;opacity:.7\">'+v[1]+'</span>',F.skill.has(k))).join('')}</div>
    <h4>程度 <span class="en">Level</span></h4><div class="chips">${chip('level','all','全部',F.level==='all')}${chip('level','1','初级 K–1',F.level==='1')}${chip('level','2','中级 1–3',F.level==='2')}${chip('level','3','高级 2–5',F.level==='3')}</div>
    <div style="margin-top:16px;padding:12px;border-radius:14px;background:var(--pink-soft);font-weight:700;font-size:13px">找不到？<a href="#request" style="color:var(--pink-deep)">让墨墨做一套 →</a><br><span style="font-weight:600;font-size:12px">Can't find it? Request a pack.</span></div>`;
  $('#filters').querySelectorAll('[data-g]').forEach(b=>b.onclick=()=>{ const {g,v}=b.dataset;
    if(g==='skill'){ F.skill.has(v)?F.skill.delete(v):F.skill.add(v); } else F[g]=v; renderFilters(); renderGrid(); });
}
function packCard(p){
  const s=SEASONS[p.season];
  return `<div class="card pack" onclick="location.hash='pack/${p.id}'">
    <div class="cov"><img src="assets/covers/${p.id}.jpg" alt="${p.zh}"></div>
    <div class="body"><div class="badges"><span class="qa">✓ 老师+学生审核 Reviewed</span><span class="tpt">TPT template</span></div><h3>${p.zh}</h3><div class="en">${p.en}</div>
      <div class="row"><span class="tag ${s[2]}">${s[0]} ${s[1]}</span>${p.skills.map(k=>`<span class="tag t-sky">${SKILLS[k][0]}</span>`).join('')}</div>
      <div class="row" style="margin-top:8px">${lvls()}</div>
      <div class="foot"><span>K–5 · ${p.pages} 页 pages · ${p.words.length} 词</span><span class="play">▶ 玩这些词</span></div></div></div>`;
}
function renderGrid(){
  const list=PACKS.filter(p=>(F.season==='all'||p.season===F.season)&&[...F.skill].every(k=>p.skills.includes(k)));
  const order={halloween:0,autumn:1,thanksgiving:2,winter:3,newyear:4};
  list.sort((a,b)=>order[a.season]-order[b.season]);
  $('#libCount').textContent=`${list.length} 套教学包 packs`;
  $('#grid').innerHTML=list.length?list.map(packCard).join(''):`<div class="card empty" style="grid-column:1/-1">这个组合还没有教学包 — <a href="#request">请墨墨做一套 Request one</a></div>`;
}

/* ---------- Pack detail ---------- */
function renderPack(id){
  const p=PACKS.find(x=>x.id===id)||PACKS[0], s=SEASONS[p.season];
  $('#crumbSeason').textContent=s[0]+' '+s[1]; $('#crumbTitle').textContent=p.zh;
  $('#dTitle').textContent=p.zh; $('#dSub').textContent=p.en+' · K–5 · '+p.pages+' pages';
  $('#dBadges').innerHTML=`<span class="tag ${s[2]}">${s[0]} ${s[1]}</span><span class="tag t-butter">TPT ${p.tpt||'template'}</span><span class="tag t-sage">简体 Simplified</span>`;
  $('#dLevels').innerHTML=lvls();
  $('#gal').innerHTML=[1,2,3,4].map(i=>`<img src="assets/previews/${p.id}-${i}.jpg" alt="preview ${i}">`).join('');
  $('#pageCount').textContent=p.pages+' 页 pages';
  $('#strip').innerHTML = p.pageImgs ? [2,3,5,7,9,10,11].map(i=>`<img src="assets/pages/pumpkin-${String(i).padStart(2,'0')}.jpg" alt="">`).join('')+`<div class="more">+7</div>` : '';
  $('#dWords').innerHTML=p.words.map(w=>`<div class="w"><div class="py">${w.py}</div><div class="hz" style="${w.hz.length>2?'font-size:21px;line-height:1.55':''}">${w.hz}</div><div class="gl">${w.gl}</div></div>`).join('');
  $('#dPackId').textContent='?pack='+p.pack;
  $('#dGames').innerHTML=GAMES.map(g=>`<button class="gbtn" onclick="toast('Opens ${g.en} with ?pack=${p.pack} (mockup)')"><span class="gi" style="background:${g.c}">${g.g}</span><span>${g.zh}<small>${g.en}</small></span></button>`).join('');
  const inside=p.inside||[['1','封面 cover',''],['2','词语卡 word cards','全班'],['3–4','看字涂颜色 mystery pictures','K–2'],['5–8','游戏 + 手工 games & craft','全班'],['9–11','写字 3 levels, 30 mm 田字格','K–5'],['12','课堂游戏 QR → Avery Games','教师']];
  $('#insideBox').innerHTML=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><h3 style="font-size:19px">包里有什么</h3><span style="color:var(--ink-soft);font-weight:600">What's inside · 40-min lesson plan + 分层建议 included</span></div><table>${inside.map(r=>`<tr><td>p${r[0]}</td><td>${r[1]}</td><td style="text-align:right"><span class="tag t-sage">${r[2]}</span></td></tr>`).join('')}</table>`;
}

/* ---------- Request ---------- */
const STEPS=[['草稿','Draft','墨墨把你的词语放进验证过的模板 Momo fills proven templates (never invents layouts)'],['老师审核','Teacher check','Teacher Review vs. the Pumpkin v3 standard: stroke order, 楷体, no empty bottoms'],['学生审核','Student check','Student Review: is it fun and clear for a 6-year-old?'],['真人签发','Human sign-off','A person reads every page and approves it'],['完成','Ready','PDF download + the same words loaded in all six games']];
let stepNow=1;
function renderSteps(){
  $('#steps').innerHTML=STEPS.map((s,i)=>{const cls=i<stepNow?'done':i===stepNow?'now':''; const st=i<stepNow?'<span class="st" style="color:#2F6A48">✓ 通过 passed</span>':i===stepNow?'<span class="st" style="color:var(--pink-deep)">进行中 in progress</span>':'';
    return `<li class="${cls}"><span class="dot">${i<stepNow?'✓':i+1}</span><div><h4>${s[0]} · ${s[1]} ${st}</h4><p>${s[2]}</p></div></li>`}).join('');
  const say=['墨墨在选模板… Picking templates','墨墨请老师看一看… Teacher reviewer is checking','墨墨请小朋友看一看… Student reviewer is checking','等老师签字… Waiting for a person to sign off','做好啦！Your pack is ready'];
  $('#momoSay').textContent=say[Math.min(stepNow,4)];
  $('#ready').classList.toggle('on',stepNow>=4);
}
function runBuild(){ stepNow=0; renderSteps(); const t=setInterval(()=>{ stepNow++; renderSteps(); if(stepNow>=4){ clearInterval(t); stepNow=5; renderSteps(); toast('Pack ready (mockup timing)'); } },1100); }
function parseWords(){
  const raw=$('#fWords').value, seen=new Set(), out=[];
  (raw.match(/[\u4e00-\u9fff]+/g)||[]).forEach(w=>{ if(!seen.has(w)){seen.add(w);out.push(w);} });
  const dup=(raw.match(/[\u4e00-\u9fff]+/g)||[]).length-out.length;
  $('#parsed').innerHTML=out.map(w=>`<span class="pw">${w}</span>`).join('')+`<span class="note">✓ ${out.length} 个词语 found · skipped pinyin, numbers & punctuation${dup?` · removed ${dup} duplicate`:''}</span>`;
  $('#wc').textContent=out.length;
}
function singleChips(el,items,onIdx){ el.innerHTML=items.map((x,i)=>`<button class="chip ${i===onIdx?'on':''}">${x}</button>`).join(''); el.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{el.querySelectorAll('.chip').forEach(c=>c.classList.remove('on'));b.classList.add('on');}); }
function multiChips(el,items,on){ el.innerHTML=items.map((x,i)=>`<button class="chip ${on.includes(i)?'on':''}">${x}</button>`).join(''); el.querySelectorAll('.chip').forEach(b=>b.onclick=()=>b.classList.toggle('on')); }
function fillFromPlain(){ toast('墨墨 filled: Grade 1 · 秋天 · 2 games + 1 craft'); }

/* ---------- Classroom ---------- */
const CSEASONS={ autumn:{zh:'秋天',pack:'autumn-2026',bg:'linear-gradient(135deg,#FCE3CC,#F4B98A)',words:['秋天','树叶','松鼠','松果','苹果','篮子','大风','树洞','大雁','南瓜','稻草人','月亮','蘑菇','柿子','玉米','土豆'],call:['sōngshǔ','松鼠'],outfit:'围巾 scarf'},
  halloween:{zh:'万圣节',pack:'halloween-2026',bg:'linear-gradient(135deg,#5B4A70,#8A6FA3)',words:['南瓜','月亮','黑猫','糖果','蝙蝠','幽灵','眼睛','嘴巴','鼻子','翅膀','山洞','朋友','巫师帽','星星','晚上','万圣节'],call:['nánguā','南瓜'],outfit:'南瓜帽 pumpkin hat'},
  thanksgiving:{zh:'感恩节',pack:'thanksgiving-2026',bg:'linear-gradient(135deg,#FBEECB,#E9C77A)',words:['感恩节','火鸡','羽毛','谢谢','家人','朋友','大餐','玉米','土豆','南瓜','苹果','秋天','感谢','帮忙','爷爷','奶奶'],call:['xièxie','谢谢'],outfit:'羽毛 feathers'},
  winter:{zh:'冬天',pack:'winter-2026',bg:'linear-gradient(135deg,#DDEAF7,#A5C9E8)',words:['冬天','雪人','下雪','冷','围巾','帽子','手套','外套','靴子','天气','晴天','刮风','雪花','滑冰','热可可','毛衣'],call:['xuěrén','雪人'],outfit:'手套 mittens'},
  chunjie:{zh:'春节',pack:'chunjie-2027',bg:'linear-gradient(135deg,#F4869C,#C85B73)',words:['春节','红包','春联','灯笼','饺子','烟花','舞龙','舞狮','年糕','汤圆','福','羊','除夕','拜年','团圆饭','元宵'],call:['hóngbāo','红包'],outfit:'羊帽 goat hat'} };
let cSeason='halloween', cGame='bingo';
function renderClassroom(){
  const lists=[['万','万圣节 Week 4','12 词 · played 2 days ago','var(--pink-soft)'],['秋','秋天来了 · 一年级','12 词 · from Request #3','var(--accent-soft)'],['身','身体 Body parts','10 词 · Momo Says','var(--sage-soft)'],['色','颜色 Colors','8 词 · Bingo','var(--sky-soft)']];
  $('#lists').innerHTML=lists.map((l,i)=>`<div class="list-item ${i===0?'on':''}"><span class="n" style="background:${l[3]}">${l[0]}</span><div><b>${l[1]}</b><small>${l[2]}</small></div></div>`).join('');
  $('#lists').querySelectorAll('.list-item').forEach(el=>el.onclick=()=>{ $('#lists .on')?.classList.remove('on'); el.classList.add('on'); });
  $('#seasonSeg').innerHTML=Object.entries(CSEASONS).map(([k,v])=>`<button class="${k===cSeason?'on':''}" data-s="${k}">${v.zh}</button>`).join('');
  $('#seasonSeg').querySelectorAll('button').forEach(b=>b.onclick=()=>{cSeason=b.dataset.s;renderClassroom();toast('全班切换到 '+CSEASONS[cSeason].zh+' · every game now loads ?pack='+CSEASONS[cSeason].pack);});
  const S=CSEASONS[cSeason], dark=cSeason==='halloween';
  $('#packParam').textContent='?pack='+S.pack;
  $('#navSeason').textContent='本季 · '+(cSeason==='halloween'?'秋天 & 万圣节':S.zh);
  const hits=[0,5,6,9];
  let inner;
  if(cGame==='says'){
    inner=`<div class="caller"><img src="assets/momo-full.jpg"><div class="call"><div class="py">Mòmo shuō</div><div class="hz" style="font-size:25px;line-height:1.3">墨墨说：<br>摸摸你的鼻子！</div></div></div>
    <div class="board" style="grid-template-columns:repeat(3,1fr)" data-says>${['眼睛','鼻子','嘴巴','耳朵','手','脚'].map((w,i)=>`<div class="${i===1?'hit':''}">${w}</div>`).join('')}</div>`;
  } else {
    inner=`<div class="caller"><img src="assets/momo-full.jpg"><div class="call"><div class="py">${S.call[0]}</div><div class="hz">${S.call[1]}</div></div></div>
    <div class="board">${S.words.slice(0,16).map((w,i)=>`<div class="${hits.includes(i)?'hit':''}">${w}</div>`).join('')}</div>`;
  }
  $('#stage').style.setProperty('--stage',S.bg);
  $('#stage').innerHTML=`<div class="hud"><span>${cGame==='says'?'墨墨说 Momo Says':'宾果 Bingo Night'}</span><span>第 5 轮 Round 5</span><span>墨墨穿：${S.outfit}</span></div>`+inner;
  const lg=GAMES.filter(g=>['bingo','says','trace','reveal'].includes(g.k));
  $('#launch').innerHTML=lg.map(g=>`<button class="gbtn ${g.k===cGame?'on':''}" data-k="${g.k}"><span class="gi" style="background:${g.c}">${g.g}</span><span>${g.zh}<small>${g.en}${['bingo','says'].includes(g.k)?' · projector':' · class room'}</small></span></button>`).join('');
  $('#launch').querySelectorAll('.gbtn').forEach(b=>b.onclick=()=>{ if(['bingo','says'].includes(b.dataset.k)){cGame=b.dataset.k;renderClassroom();} else toast('Opens '+b.textContent.trim()+' with ?pack='+S.pack); });
  $('#saved').innerHTML=['pumpkin','bat','autumn','autumn-reader','thanksgiving'].map(id=>{const p=PACKS.find(x=>x.id===id);return `<a class="sp" href="#pack/${id}" style="text-decoration:none"><img src="assets/covers/${id}.jpg"><b>${p.zh}</b></a>`}).join('');
}

/* ---------- QR decoration ---------- */
function renderQR(){ const pat='1111101100010110111010101110101011101000001011111010101001101101101100110111100100111111100110'; $('#qr').innerHTML=[...Array(49)].map((_,i)=>`<i class="${pat[i]==='1'?'':'o'}"></i>`).join(''); }

/* ---------- Router ---------- */
function route(){
  const h=(location.hash||'#library').slice(1), [name,arg]=h.split('/');
  const scr=['library','pack','request','classroom','pricing'].includes(name)?name:'library';
  document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('on',s.id==='s-'+scr));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.go===scr));
  if(scr==='pack') renderPack(arg||'pumpkin');
  const q=new URLSearchParams(location.search);
  if(scr==='request'&&q.get('step')){ stepNow=+q.get('step'); renderSteps(); }
  if(q.get('game')){ cGame=q.get('game'); renderClassroom(); }
  window.scrollTo(0,0);
}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>location.hash=t.dataset.go);
renderFilters(); renderGrid(); renderSteps(); renderClassroom(); renderQR();
singleChips($('#fGrade'),['K','1 年级','2','3','4','5'],1);
singleChips($('#fTheme'),['秋天 Autumn','万圣节 Halloween','感恩节 Thanksgiving','冬天 Winter','春节 Lunar New Year','自己写 Other…'],0);
multiChips($('#fAct'),['阅读 Reading','写字·笔顺 Writing','手工 Craft','学习中心 Centers','游戏 Games ×2','田字格 sheet'],[1,2,4,5]);
$('#fWords').oninput=parseWords; parseWords();
$('#mixR').oninput=e=>{const a=+e.target.value,b=Math.round((100-a)*0.7),c=100-a-b;$('#mx1').textContent=a+'%';$('#mx2').textContent=b+'%';$('#mx3').textContent=c+'%';};
window.addEventListener('hashchange',route); route();
