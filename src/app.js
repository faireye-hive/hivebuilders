(function(){
'use strict';

/* ═══════════ CONFIG ═══════════ */
var CUSTOM_JSON_ID = 'hivebuilds_silva'; // Change to your own ID
var HAFSQL_BASE    = 'https://hafsql-api.mahdiyari.info/operations/custom_json';
var ITEMS_PER_PAGE = 20;

/* ═══════════ SECURITY HELPERS ═══════════ */

// Escape all HTML — ALWAYS use for any user-derived text in innerHTML
function esc(v){
  return String(v==null?'':v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#x27;').replace(/\//g,'&#x2F;');
}

// Strict URL allowlist: only https:// and http://, no javascript: / data: / etc.
function safeUrl(raw){
  try{
    var s=String(raw||'').trim();
    if(!s)return '';
    var u=new URL(s);
    if(u.protocol!=='https:'&&u.protocol!=='http:')return '';
    return u.href;
  }catch(e){return '';}
}

// Hive username: only a-z 0-9 . - between 3 and 16 chars
function validUsername(u){
  return /^[a-z0-9.\-]{3,16}$/.test(u);
}

// Extract a single safe emoji from input; fallback to default
function safeEmoji(raw){
  var s=String(raw||'').trim();
  if(!s)return '\uD83D\uDD37';
  var emojiOnly=s.replace(/[^\p{Emoji}]/gu,'');
  if(!emojiOnly)return '\uD83D\uDD37';
  var chars=Array.from(emojiOnly);
  return chars.slice(0,2).join('');
}

// Strip HTML tags and control chars, trim, enforce max length
function sanitizeText(raw, maxLen){
  maxLen = maxLen || 500;
  var stringBruta = String(raw == null ? '' : raw).trim();
  if (!stringBruta) return '';
  var textoLimpo = DOMPurify.sanitize(stringBruta, { ALLOWED_TAGS: [] });
  textoLimpo = textoLimpo.slice(0, maxLen);
  return esc(textoLimpo);
}

// Sanitize comma-separated tags
function sanitizeTags(raw){
  return String(raw||'').split(',')
    .map(function(t){ return sanitizeText(t,30).toLowerCase().replace(/[^a-z0-9\-_]/g,''); })
    .filter(Boolean).slice(0,8);
}

var VALID_CATS    =['bridge','exchange','frontend','dapp','docs','tool','wallet','game','defi','nft','search','social','lib','other'];
var VALID_STATUSES=['live','beta','dev','deprecated'];
function inList(v,list){ return list.indexOf(v)!==-1; }

/* ═══════════ THEME ═══════════ */
var currentTheme=localStorage.getItem('hb_theme')||'dark';
function applyTheme(t){
  currentTheme=t;
  document.documentElement.setAttribute('data-theme',t);
  document.getElementById('theme-toggle').textContent=t==='dark'?'\uD83C\uDF19':'\u2600\uFE0F';
  localStorage.setItem('hb_theme',t);
}
function toggleTheme(){ applyTheme(currentTheme==='dark'?'light':'dark'); }
applyTheme(currentTheme);

/* ═══════════ CANVAS ═══════════ */
(function(){
  var canvas=document.getElementById('bg-canvas');
  var ctx=canvas.getContext('2d');
  var nodes=[]; var W,H;
  function resize(){ W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight; }
  resize(); window.addEventListener('resize',resize);
  for(var i=0;i<50;i++) nodes.push({x:Math.random()*1920,y:Math.random()*1080,vx:(Math.random()-.5)*.25,vy:(Math.random()-.5)*.25,r:Math.random()*2+1});
  function draw(){
    ctx.clearRect(0,0,W,H);
    nodes.forEach(function(n){
      n.x+=n.vx; n.y+=n.vy;
      if(n.x<0)n.x=W; if(n.x>W)n.x=0;
      if(n.y<0)n.y=H; if(n.y>H)n.y=0;
    });
    ctx.strokeStyle='rgba(0,212,170,0.18)'; ctx.lineWidth=.5;
    for(var i=0;i<nodes.length;i++){
      for(var j=i+1;j<nodes.length;j++){
        var dx=nodes[i].x-nodes[j].x,dy=nodes[i].y-nodes[j].y,d=Math.sqrt(dx*dx+dy*dy);
        if(d<180){ ctx.globalAlpha=(1-d/180)*.4; ctx.beginPath(); ctx.moveTo(nodes[i].x,nodes[i].y); ctx.lineTo(nodes[j].x,nodes[j].y); ctx.stroke(); }
      }
    }
    ctx.globalAlpha=1;
    nodes.forEach(function(n){ ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,Math.PI*2); ctx.fillStyle='rgba(0,212,170,.35)'; ctx.fill(); });
    requestAnimationFrame(draw);
  }
  draw();
})();

/* ═══════════ STATE ═══════════ */
var currentUser=null;
var allProjects=[];
var filtered=[];
var currentCat='all';
var currentSort='newest';
var searchQuery='';
var currentPage=0;
var uniqueAuthors=Object.create(null);
var pendingScreenshots=[];

/* ═══════════ CATEGORY META ═══════════ */
var CAT_META={
  bridge:   { color: '#2500cc', label: 'Bridge' },
  exchange:   { color: '#b95a00', label: 'Exchange' },
  frontend:   { color: '#dd0055', label: 'FrontEnd' },
  dapp:{color:'#00d4aa',label:'dApp'},
  docs:{color:'#e5ff00',label:'Docs'},
  tool:{color:'#8b5cf6',label:'Tool'},
  wallet:{color:'#f59e0b',label:'Wallet'},
  game:{color:'#e84142',label:'Game'},
  defi:{color:'#10b981',label:'DeFi'},
  nft:{color:'#ec4899',label:'NFT'},
  search:{color:'#3b82f6',label:'Search'},
  social:{color:'#3b82f6',label:'Social'},
  lib:{color:'#6366f1',label:'Library'},
  other:{color:'#64748b',label:'Other'}
};

/* ═══════════ HAFSQL ═══════════ */
async function fetchProjects(startBlock){
  var url=HAFSQL_BASE+'/'+encodeURIComponent(CUSTOM_JSON_ID)+'?limit=100';
  if(startBlock!=null) url+='&start='+parseInt(startBlock,10);
  try{
    var res=await fetch(url,{signal:AbortSignal.timeout(15000)});
    if(!res.ok)throw new Error('HTTP '+res.status);
    var data=await res.json();
    return Array.isArray(data)?data:(data.data||data.result||[]);
  }catch(e){ console.error('HAFSQL error:',e); return null; }
}

function parseProjectRow(row){
  try{
    var json=row.json||(row.value&&row.value.json)||(row.op&&row.op[1]&&row.op[1].json);
    if(!json)return null;
    var p=typeof json==='string'?JSON.parse(json):json;
    if(typeof p!=='object'||p===null)return null;
    if(!p.name||!p.description)return null;

    var name    =sanitizeText(p.name,80);
    var desc    =sanitizeText(p.description,160);
    var fullDesc=sanitizeText(p.full_description||p.fullDesc||'',800);
    var cat     =inList(String(p.category||'').toLowerCase(),VALID_CATS)?String(p.category).toLowerCase():'other';
    var status  =inList(String(p.status||''),VALID_STATUSES)?String(p.status):'live';
    var url     =safeUrl(p.url||p.website||'');
    var github  =safeUrl(p.github||'');
    var tags    =sanitizeTags(Array.isArray(p.tags)?p.tags.join(','):(p.tags||''));
    var logo    = safeUrl(p.logo || p.icon || '');
    var launchPost = safeUrl(p.launch_post || p.launchPost || '');

    var screenshots = [];
    if (Array.isArray(p.screenshots)) {
      screenshots = p.screenshots
        .map(function(s) { return safeUrl(s); })
        .filter(Boolean)
        .slice(0, 4);
    }

    var rawAuthor = 'unknown';
    if (row.required_posting_auths && row.required_posting_auths.length > 0) {
      rawAuthor = row.required_posting_auths[0];
    } else if (row.required_auths && row.required_auths.length > 0) {
      rawAuthor = row.required_auths[0];
    } else if (p.author) {
      rawAuthor = p.author;
    }

    var author = sanitizeText(String(rawAuthor), 16).toLowerCase().replace(/[^a-z0-9.\-]/g, '');

    if(!name||!desc)return null;

    return {
      id:String(row.trx_id||row.transaction_id||row.block_num+'_'+Math.random()).slice(0,80),
      block:parseInt(row.block_num||row.block||0,10)||0,
      timestamp:row.timestamp||null,
      author:author,name:name,description:desc,fullDesc:fullDesc,
      logo:logo,launchPost:launchPost,category:cat,status:status,url:url,github:github,
      tags:tags,screenshots:screenshots
    };
  }catch(e){ return null; }
}

async function loadProjects(startBlock){
  setGridLoading(true);
  var rows=await fetchProjects(startBlock);
  if(rows===null){ setGridError(); return; }

  var seen=Object.create(null);
  allProjects.forEach(function(p){ seen[p.id]=true; });
  var newOnes=rows.map(parseProjectRow).filter(function(p){ return p&&!seen[p.id]; });
  allProjects=allProjects.concat(newOnes);

  allProjects.forEach(function(p){ uniqueAuthors[p.author]=true; });
  document.getElementById('stat-projects').textContent=allProjects.length;
  document.getElementById('stat-contributors').textContent=Object.keys(uniqueAuthors).length;

  applyFilters();
  setGridLoading(false);
}

/* ═══════════ RENDER ═══════════ */
function applyFilters(){
  var list=allProjects.slice();
  if(currentCat!=='all') list=list.filter(function(p){ return p.category===currentCat; });
  if(searchQuery){
    var q=searchQuery.toLowerCase();
    list=list.filter(function(p){
      return p.name.toLowerCase().indexOf(q)!==-1||
             p.description.toLowerCase().indexOf(q)!==-1||
             p.author.toLowerCase().indexOf(q)!==-1||
             p.tags.some(function(t){ return t.indexOf(q)!==-1; });
    });
  }
  if(currentSort==='newest') list.sort(function(a,b){ return b.block-a.block; });
  if(currentSort==='oldest') list.sort(function(a,b){ return a.block-b.block; });
  if(currentSort==='name')   list.sort(function(a,b){ return a.name.localeCompare(b.name); });
  filtered=list;
  renderPage(0);
}

function renderPage(page){
  currentPage=page;
  var start=page*ITEMS_PER_PAGE;
  var slice=filtered.slice(start,start+ITEMS_PER_PAGE);
  var grid=document.getElementById('projects-grid');

  if(!filtered.length){
    grid.innerHTML='<div class="empty-state"><div class="empty-icon">\uD83D\uDD0D</div><h3>No projects found</h3><p>Try adjusting your filters or be the first to submit one!</p></div>';
    document.getElementById('pagination').style.display='none';
    return;
  }

  grid.innerHTML='';
  slice.forEach(function(p,i){
    var card=buildCard(p,allProjects.indexOf(p));
    grid.appendChild(card);
  });

  var totalPages=Math.ceil(filtered.length/ITEMS_PER_PAGE);
  var pag=document.getElementById('pagination');
  if(totalPages>1){
    pag.style.display='flex';
    document.getElementById('page-info').textContent='Page '+(page+1)+' of '+totalPages;
    document.getElementById('prev-btn').disabled=page===0;
    document.getElementById('next-btn').disabled=page>=totalPages-1;
  } else { pag.style.display='none'; }
}

function buildCard(p,idx){
  var cat=CAT_META[p.category]||CAT_META.other;
  var date=p.timestamp
    ? new Date(p.timestamp).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
    : 'Block #'+p.block;
  var statusColors={live:'#10b981',beta:'#f59e0b',dev:'#8b5cf6',deprecated:'#64748b'};
  var sc=p.screenshots.slice(0,3);

  var card=document.createElement('div');
  card.className='card';
  card.style.setProperty('--accent-color',cat.color);
  card.addEventListener('click',function(){ openDetail(p); });

  // Accent bar
  var accent=document.createElement('div');
  accent.className='card-accent';
  card.appendChild(accent);

  // Body
  var body=document.createElement('div');
  body.className='card-body';

  // Header row
  var header=document.createElement('div');
  header.className='card-header';
  var iconEl=document.createElement('div');
  iconEl.className='card-icon';
  if(p.logo){
    var logoImg = document.createElement('img');
    logoImg.src = p.logo;
    logoImg.alt = p.name;
    logoImg.onerror = function(){ iconEl.textContent = '📦'; };
    iconEl.appendChild(logoImg);
  } else {
    iconEl.textContent = '📦';
  }
  header.appendChild(iconEl);
  var meta=document.createElement('div');
  meta.className='card-meta';

  var titleEl=document.createElement('div');
  titleEl.className='card-title';
  titleEl.title=p.name;
  titleEl.textContent=p.name;
  meta.appendChild(titleEl);
  var authorEl=document.createElement('div');
  authorEl.className='card-author';
  authorEl.appendChild(document.createTextNode('by '));
  var authorLink=document.createElement('a');
  authorLink.href='https://peakd.com/@'+p.author;
  authorLink.target='_blank';
  authorLink.rel='noopener noreferrer';
  authorLink.textContent='@'+p.author;
  authorLink.addEventListener('click',function(e){ e.stopPropagation(); });
  authorEl.appendChild(authorLink);
  meta.appendChild(authorEl);
  header.appendChild(meta);
  body.appendChild(header);

  // Screenshots strip (Mantido padrão, estável e estático nos cartões)
  if(sc.length){
    var strip=document.createElement('div');
    strip.className='card-screenshots';
    sc.forEach(function(src){
      var wrap=document.createElement('div');
      wrap.className='card-screenshot';
      var img=document.createElement('img');
      img.loading='lazy';
      img.alt='Screenshot';
      img.onerror=function(){ wrap.style.display='none'; };
      img.src=src;
      wrap.appendChild(img);
      strip.appendChild(wrap);
    });
    body.appendChild(strip);
  }

  // Description
  var descEl=document.createElement('div');
  descEl.className='card-desc';
  descEl.textContent=p.description;
  body.appendChild(descEl);

  // Tags
  var tagsEl=document.createElement('div');
  tagsEl.className='card-tags';
  var catBadge=document.createElement('span');
  catBadge.className='badge badge-cat';
  catBadge.textContent=cat.label;
  tagsEl.appendChild(catBadge);
  var stBadge=document.createElement('span');
  stBadge.className='badge';
  var sc2=statusColors[p.status]||'#64748b';
  stBadge.style.cssText='color:'+sc2+';border-color:'+sc2+'33;background:'+sc2+'11';
  stBadge.textContent=p.status;
  tagsEl.appendChild(stBadge);
  p.tags.slice(0,2).forEach(function(t){ var b=document.createElement('span'); b.className='badge'; b.textContent=t; tagsEl.appendChild(b); });
  body.appendChild(tagsEl);
  card.appendChild(body);

  // Footer
  var footer=document.createElement('div');
  footer.className='card-footer';
  var ob=document.createElement('div');
  ob.className='onchain-badge';
  ob.textContent='on-chain';
  footer.appendChild(ob);
  var links=document.createElement('div');
  links.className='card-links';
  if(p.url){
    var a=document.createElement('a');
    a.className='card-link'; a.href=p.url; a.target='_blank'; a.rel='noopener noreferrer';
    a.textContent='\uD83C\uDF10 Website';
    a.addEventListener('click',function(e){ e.stopPropagation(); });
    links.appendChild(a);
  }
  if(p.github){
    var ag=document.createElement('a');
    ag.className='card-link'; ag.href=p.github; ag.target='_blank'; ag.rel='noopener noreferrer';
    ag.textContent='\u2B1B GitHub';
    ag.addEventListener('click',function(e){ e.stopPropagation(); });
    links.appendChild(ag);
  }
  var dateSpan=document.createElement('span');
  dateSpan.textContent=date;
  links.appendChild(dateSpan);
  footer.appendChild(links);
  card.appendChild(footer);

  return card;
}

function setGridLoading(v){
  if(v) document.getElementById('projects-grid').innerHTML='<div class="loader"><div class="spinner"></div> Loading on-chain projects\u2026</div>';
}
function setGridError(){
  document.getElementById('projects-grid').innerHTML='<div class="empty-state"><div class="empty-icon">\u26A0\uFE0F</div><h3>Could not load projects</h3><p>Failed to reach the Hive indexer. Check your connection.</p><br/><button class="btn btn-ghost btn-sm" onclick="loadProjects()">Retry</button></div>';
}

/* ═══════════ DETAIL MODAL ═══════════ */
function openDetail(p){
  if(!p)return;
  var cat=CAT_META[p.category]||CAT_META.other;
  var date=p.timestamp?new Date(p.timestamp).toLocaleString():'Block #'+p.block;

  var el=document.getElementById('detail-content');
  el.innerHTML='';

  // Banner Inteligente com Imagem de Fundo (Blur)
  var banner=document.createElement('div');
  banner.className='detail-banner';

  if(p.screenshots && p.screenshots.length > 0) {
    banner.style.backgroundImage = 'linear-gradient(to bottom, rgba(0,0,0,0.2), rgba(0,0,0,0.6)), url("' + p.screenshots[0] + '")';
    banner.style.backgroundSize = 'cover';
    banner.style.backgroundPosition = 'center';
    banner.style.backdropFilter = 'blur(8px)';
  } else {
    banner.style.background='linear-gradient(135deg,'+cat.color+'22,'+cat.color+'44)';
  }

  if(p.logo){
    var detLogo = document.createElement('img');
    detLogo.src = p.logo;
    detLogo.className = 'detail-logo-img';
    detLogo.onerror = function(){
      banner.style.background = 'linear-gradient(135deg,'+cat.color+'22,'+cat.color+'44)';
      banner.innerHTML = '<span style="font-size: 32px;">📦</span>';
    };
    banner.appendChild(detLogo);
  } else {
    var fallback = document.createElement('span');
    fallback.style.fontSize = '32px';
    fallback.textContent = '📦';
    banner.appendChild(fallback);
  }
  el.appendChild(banner);

  var body=document.createElement('div');
  body.className='detail-body';

  // Close
  var cls=document.createElement('button');
  cls.className='modal-close'; cls.style.cssText='float:right;margin-top:-4px';
  cls.textContent='\xD7'; cls.onclick=function(){ closeModal('detail-modal'); };
  body.appendChild(cls);

  // Title
  var t=document.createElement('div'); t.className='detail-title'; t.textContent=p.name; body.appendChild(t);

  // Author
  var au=document.createElement('div'); au.className='detail-author';
  au.appendChild(document.createTextNode('by '));
  var al=document.createElement('a'); al.href='https://peakd.com/@'+p.author; al.target='_blank'; al.rel='noopener noreferrer';
  al.style.color='var(--teal)'; al.textContent='@'+p.author; au.appendChild(al);
  au.appendChild(document.createTextNode(' \xB7 '+date));
  body.appendChild(au);

  // Tags
  var tg=document.createElement('div'); tg.className='card-tags'; tg.style.marginBottom='14px';
  var cb=document.createElement('span'); cb.className='badge badge-cat'; cb.textContent=cat.label; tg.appendChild(cb);
  var sb=document.createElement('span'); sb.className='badge'; sb.textContent=p.status; tg.appendChild(sb);
  p.tags.forEach(function(tt){ var b=document.createElement('span'); b.className='badge'; b.textContent=tt; tg.appendChild(b); });
  body.appendChild(tg);

  // Description
  var d=document.createElement('div'); d.className='detail-desc'; d.textContent=p.description; body.appendChild(d);
  if(p.fullDesc){ var fd=document.createElement('div'); fd.className='detail-desc'; fd.textContent=p.fullDesc; body.appendChild(fd); }

  // Screenshots - COM A FUNÇÃO DRAG ATIVA EXCLUSIVAMENTE AQUI
// ═══════════ TRECHO ATUALIZADO DENTRO DE openDetail(p) ═══════════
  if(p.screenshots && p.screenshots.length){
    var ssTitle = document.createElement('div'); 
    ssTitle.className = 'section-title'; 
    ssTitle.style.marginTop = '18px';
    ssTitle.textContent = 'Screenshots'; 
    body.appendChild(ssTitle);

    // 1. Criamos um container para envelopar a lista e os botões de seta
    var wrapper = document.createElement('div');
    wrapper.className = 'screenshots-carousel-wrapper';

    // 2. Criamos a lista que rola de fato
    var strip = document.createElement('div'); 
    strip.className = 'detail-screenshots';

    // Popular a lista com as imagens
    p.screenshots.forEach(function(src, i){
      var w = document.createElement('div'); 
      w.className = 'detail-screenshot';
      var img = document.createElement('img'); 
      img.loading = 'lazy'; 
      img.alt = 'Screenshot ' + (i + 1);
      img.onerror = function(){ w.style.display = 'none'; };
      img.onclick = function(){ openLightbox(src, p.screenshots); };
      img.src = src;
      
      // Evita o travamento prevenindo o comportamento fantasma de arrastar nativo do browser
      img.addEventListener('dragstart', function(e) { e.preventDefault(); });
      
      w.appendChild(img); 
      strip.appendChild(w);
    });

    wrapper.appendChild(strip);

    // 3. Adicionamos os botões de navegação apenas se houver mais de uma imagem
    if(p.screenshots.length > 1) {
      var btnPrev = document.createElement('button');
      btnPrev.className = 'carousel-nav-btn prev';
      btnPrev.innerHTML = '&#10216;'; // Sinal de <
      btnPrev.title = 'Previous';
      btnPrev.onclick = function() {
        // Rola para a esquerda baseado na largura de um card de screenshot + gap
        strip.scrollBy({ left: -272, behavior: 'smooth' });
      };

      var btnNext = document.createElement('button');
      btnNext.className = 'carousel-nav-btn next';
      btnNext.innerHTML = '&#10217;'; // Sinal de >
      btnNext.title = 'Next';
      btnNext.onclick = function() {
        // Rola para a direita baseado na largura de um card de screenshot + gap
        strip.scrollBy({ left: 272, behavior: 'smooth' });
      };

      wrapper.appendChild(btnPrev);
      wrapper.appendChild(btnNext);
    }

    body.appendChild(wrapper);
  }
  // ═════════════════════════════════════════════════════════════════

  // Links
  var lk=document.createElement('div'); lk.className='detail-links'; lk.style.marginTop='14px';
  if(p.url){ var wa=document.createElement('a'); wa.href=p.url; wa.target='_blank'; wa.rel='noopener noreferrer'; wa.className='btn btn-teal btn-sm'; wa.textContent='🌐 Website'; lk.appendChild(wa); }
  if(p.github){ var ga=document.createElement('a'); ga.href=p.github; ga.target='_blank'; ga.rel='noopener noreferrer'; ga.className='btn btn-ghost btn-sm'; ga.textContent='⬛ GitHub'; lk.appendChild(ga); }

  if(p.launchPost){
    var pa=document.createElement('a');
    pa.href=p.launchPost; pa.target='_blank'; pa.rel='noopener noreferrer';
    pa.className='btn btn-ghost btn-sm'; pa.style.borderColor='var(--purple)'; pa.style.color='var(--purple)';
    pa.textContent='📰 Launch Post';
    lk.appendChild(pa);
  }
  body.appendChild(lk);

  // On-chain info
  var ct=document.createElement('div'); ct.className='section-title'; ct.style.marginTop='18px'; ct.textContent='On-chain info'; body.appendChild(ct);
  var ci=document.createElement('div'); ci.style.cssText='font-size:12px;color:var(--muted)';
  ci.textContent='Block: '+p.block; body.appendChild(ci);

  el.appendChild(body);
  openModal('detail-modal');
}

/* ═══════════ LIGHTBOX ═══════════ */
/* ═══════════ LIGHTBOX ═══════════ */
var lightboxImages = []; // Guarda o array de screenshots do projeto ativo
var lightboxIndex = 0;   // Guarda o índice da imagem exibida no momento

function openLightbox(src, allScreenshots) {
  if (typeof src !== 'string' || !safeUrl(src)) return;
  
  // Salva o contexto das screenshots para permitir navegação
  lightboxImages = Array.isArray(allScreenshots) ? allScreenshots : [src];
  lightboxIndex = lightboxImages.indexOf(src);
  if (lightboxIndex === -1) lightboxIndex = 0;

  updateLightboxContent();
  document.getElementById('lightbox').classList.add('open');
}

function updateLightboxContent() {
  var currentSrc = lightboxImages[lightboxIndex];
  document.getElementById('lightbox-img').src = currentSrc;

  // Oculta ou exibe os botões se houver apenas 1 imagem
  var showNav = lightboxImages.length > 1;
  document.getElementById('lightbox-prev').style.display = showNav ? 'flex' : 'none';
  document.getElementById('lightbox-next').style.display = showNav ? 'flex' : 'none';
}

function lightboxNext(e) {
  if (e) e.stopPropagation(); // Impede fechar o modal ao clicar na imagem ou no botão
  if (lightboxImages.length <= 1) return;

  lightboxIndex = (lightboxIndex + 1) % lightboxImages.length; // Volta pro início se for a última
  updateLightboxContent();
}

function lightboxPrev(e) {
  if (e) e.stopPropagation(); // Impede fechar o modal ao clicar no botão
  if (lightboxImages.length <= 1) return;

  lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length; // Vai pra última se retroceder da primeira
  updateLightboxContent();
}

function handleLightboxOverlayClick(e) {
  // Só fecha se o clique foi diretamente no fundo escuro (overlay)
  if (e.target === document.getElementById('lightbox')) {
    closeLightbox();
  }
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightbox-img').src = '';
  lightboxImages = [];
  lightboxIndex = 0;
}

/* ═══════════ AUTH ═══════════ */
function openLoginModal(){
  var hasKc=typeof window.hive_keychain!=='undefined';
  document.getElementById('keychain-check-msg').style.display=hasKc?'none':'flex';
  openModal('login-modal');
}

function doLogin(){
  var raw=document.getElementById('login-username').value.trim().replace(/^@/,'').toLowerCase();
  if(!raw){ showToast('Enter your Hive username','error'); return; }
  if(!validUsername(raw)){ showToast('Invalid username format (3-16 chars, a-z 0-9 . -)','error'); return; }
  if(typeof window.hive_keychain==='undefined'){ showToast('Hive Keychain not found','error'); return; }
  hive_keychain.requestSignBuffer(raw,'HiveBuilds login '+Date.now(),'Posting',function(resp){
    if(resp.success){
      currentUser=raw; localStorage.setItem('hb_user', raw); updateAuthUI(); closeModal('login-modal');
      showToast('Welcome, @'+raw+'! \uD83D\uDC4B','success');
    } else {
      showToast(resp.message||'Login cancelled','error');
    }
  });
}

function logout(){ currentUser=null; localStorage.removeItem('hb_user'); updateAuthUI(); showToast('Logged out','info'); }

function updateAuthUI(){
  var area=document.getElementById('auth-area');
  area.innerHTML='';
  if(currentUser){
    var wrap=document.createElement('div'); 
    wrap.style.cssText='display:flex;align-items:center;gap:10px';
    
    // Criamos o botão com a estrutura de textos chaveáveis por CSS
    var sb=document.createElement('button'); 
    sb.className='btn btn-teal btn-sm nav-submit-btn'; 
    sb.title='Submit Project'; 
    sb.onclick=handleSubmitClick;
    
    // Ícone SVG + textos para Desktop e Mobile
    sb.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
                   '<span class="btn-text-desktop"> Submit Project</span>' +
                   '<span class="btn-text-mobile"> +</span>';
    wrap.appendChild(sb);
    
    // Badge do Usuário
    var badge=document.createElement('div'); 
    badge.className='user-badge';
    
    var av=document.createElement('div'); 
    av.className='avatar user-avatar'; // adicionada a classe user-avatar para controle do tamanho
    
    var img=document.createElement('img'); 
    img.src='https://images.hive.blog/u/'+currentUser+'/avatar/small'; 
    img.alt=currentUser;
    img.onerror=function(){ 
      av.innerHTML=''; 
      av.textContent=currentUser.slice(0,2).toUpperCase(); 
    };
    av.appendChild(img); 
    badge.appendChild(av);
    
    // Injetamos o nome envolvido em uma tag span gerenciável
    var nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.textContent = '@' + currentUser;
    badge.appendChild(nameSpan);
    
    // Botão de Logout personalizado
    var lb=document.createElement('button'); 
    lb.textContent='\xD7'; 
    lb.title='Logout';
    lb.style.cssText='color:var(--muted);font-size:18px;line-height:1;margin-left:4px;cursor:pointer;background:none;border:none;padding:0 2px'; 
    lb.onclick=logout;
    
    badge.appendChild(lb); 
    wrap.appendChild(badge); 
    area.appendChild(wrap);
  } else {
    var btn=document.createElement('button'); 
    btn.className='btn btn-ghost login-btn'; 
    btn.onclick=openLoginModal;
    btn.innerHTML='<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> <span class="login-text">Login with Keychain</span>';
    area.appendChild(btn);
  }
}

// Função global para ativar o efeito "Clique e Arraste"
function enableDragToScroll(container) {
  var isDown = false;
  var startX;
  var scrollLeft;

  container.addEventListener('mousedown', function(e) {
    isDown = true;
    container.classList.add('grabbing');
    startX = e.pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
  });

  container.addEventListener('mouseleave', function() {
    isDown = false;
    container.classList.remove('grabbing');
  });

  container.addEventListener('mouseup', function() {
    isDown = false;
    container.classList.remove('grabbing');
  });

  container.addEventListener('mousemove', function(e) {
    if(!isDown) return;
    e.preventDefault();
    var x = e.pageX - container.offsetLeft;
    var walk = (x - startX) * 1.5;
    container.scrollLeft = scrollLeft - walk;
  });
}

/* ═══════════ SUBMIT ═══════════ */
function handleSubmitClick(){
  if(!currentUser){ openLoginModal(); return; }
  openModal('submit-modal');
}

function submitProject(){
  var screenshotsLinks = String(document.getElementById('f-screenshots-links').value || '')
    .split(',')
    .map(function(s) { return safeUrl(s.trim()); })
    .filter(Boolean)
    .slice(0, 4);

  var errEl=document.getElementById('submit-error');
  errEl.style.display='none';

  var name    =sanitizeText(document.getElementById('f-name').value,80);
  var desc    =sanitizeText(document.getElementById('f-desc').value,160);
  var fullDesc=sanitizeText(document.getElementById('f-fulldesc').value,800);
  var rawCat  =document.getElementById('f-cat').value;
  var rawSt   =document.getElementById('f-status').value;
  var url     =safeUrl(document.getElementById('f-url').value.trim());
  var github  =safeUrl(document.getElementById('f-github').value.trim());
  var tags    =sanitizeTags(document.getElementById('f-tags').value);
  var category=inList(rawCat,VALID_CATS)?rawCat:'';
  var status  =inList(rawSt,VALID_STATUSES)?rawSt:'live';
  var logo       = safeUrl(document.getElementById('f-logo').value.trim());
  var launchPost = safeUrl(document.getElementById('f-launch-post').value.trim());

  if(!name)    { showFieldError(errEl,'Project name is required.'); return; }
  if(!desc)    { showFieldError(errEl,'Short description is required.'); return; }
  if(!category){ showFieldError(errEl,'Please select a category.'); return; }
  if(typeof window.hive_keychain==='undefined'){ showFieldError(errEl,'Hive Keychain not found.'); return; }

  var payload=JSON.stringify({
    name:name, description:desc, full_description:fullDesc,
    logo:logo, launch_post:launchPost, category:category, status:status,
    url:url, github:github, tags:tags,
    screenshots: screenshotsLinks,
    app:'hivebuilds/1.0'
  });

  var btn=document.getElementById('submit-btn');
  btn.disabled=true;
  btn.innerHTML='<div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Broadcasting\u2026';

  hive_keychain.requestCustomJson(currentUser,CUSTOM_JSON_ID,'Posting',payload,'Submit project: '+name,function(resp){
    btn.disabled=false;
    btn.innerHTML='<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> Broadcast on Hive';
    if(resp.success){
      closeModal('submit-modal');
      showToast('Project submitted on-chain! \uD83C\uDF89','success');
      var np={
        id:'pending_'+Date.now(), block:0, timestamp:new Date().toISOString(),
        author:currentUser, name:name, description:desc, fullDesc:fullDesc,
        logo:logo, launchPost:launchPost, category:category, status:status, url:url, github:github, tags:tags,
        screenshots: screenshotsLinks
      };
      pendingScreenshots=[];
      allProjects.unshift(np);
      uniqueAuthors[currentUser]=true;
      document.getElementById('stat-projects').textContent=allProjects.length;
      clearSubmitForm(); applyFilters();
    } else {
      showFieldError(errEl,resp.message||'Transaction rejected or cancelled.');
    }
  });
}

function showFieldError(el,msg){
  el.innerHTML='';
  var icon=document.createElement('span'); icon.className='notice-icon'; icon.textContent='\u26A0\uFE0F';
  var txt=document.createElement('div'); txt.textContent=msg;
  el.appendChild(icon); el.appendChild(txt); el.style.display='flex';
}

function clearSubmitForm(){
  ['f-name','f-desc','f-fulldesc','f-logo','f-launch-post','f-url','f-github','f-tags','f-screenshots-links'].forEach(function(id){ document.getElementById(id).value=''; });
  document.getElementById('f-cat').value='';
  document.getElementById('f-status').value='live';
  document.getElementById('submit-error').style.display='none';
  document.getElementById('desc-count').textContent='(0/160)';
}

/* ═══════════ PAGINATION ═══════════ */
function loadNextPage(){
  if(currentPage<Math.ceil(filtered.length/ITEMS_PER_PAGE)-1){
    renderPage(currentPage+1);
    document.getElementById('projects-section').scrollIntoView({behavior:'smooth',block:'start'});
  }
}
function loadPrevPage(){
  if(currentPage>0){
    renderPage(currentPage-1);
    document.getElementById('projects-section').scrollIntoView({behavior:'smooth',block:'start'});
  }
}

/* ═══════════ MODALS ═══════════ */
function openModal(id){ document.getElementById(id).classList.add('open'); document.body.style.overflow='hidden'; }
function closeModal(id){ document.getElementById(id).classList.remove('open'); document.body.style.overflow=''; }
document.querySelectorAll('.modal-overlay').forEach(function(o){
  o.addEventListener('click',function(e){ if(e.target===o) closeModal(o.id); });
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    if(document.getElementById('lightbox').classList.contains('open')){ closeLightbox(); return; }
    document.querySelectorAll('.modal-overlay.open').forEach(function(m){ closeModal(m.id); });
  }
});

/* ═══════════ TOAST ═══════════ */
function showToast(msg,type){
  type=type||'info';
  var icons={success:'\u2705',error:'\u274C',info:'\u2139\uFE0F'};
  var c=document.getElementById('toast-container');
  var el=document.createElement('div'); el.className='toast '+type;
  var icon=document.createElement('span'); icon.textContent=icons[type];
  var text=document.createElement('span'); text.textContent=msg;
  el.appendChild(icon); el.appendChild(text); c.appendChild(el);
  setTimeout(function(){ el.style.transition='opacity .3s'; el.style.opacity='0'; setTimeout(function(){ el.remove(); },300); },3500);
}

/* ═══════════ EVENTS ═══════════ */
document.getElementById('filter-tags').addEventListener('click',function(e){
  var btn=e.target.closest('.tag-btn'); if(!btn)return;
  document.querySelectorAll('.tag-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active'); currentCat=btn.dataset.cat; applyFilters();
});
document.getElementById('sort-select').addEventListener('change',function(e){ currentSort=e.target.value; applyFilters(); });
var searchTimer;
document.getElementById('search-input').addEventListener('input',function(e){
  clearTimeout(searchTimer);
  searchTimer=setTimeout(function(){ searchQuery=sanitizeText(e.target.value,100); applyFilters(); },300);
});
document.getElementById('f-desc').addEventListener('input',function(e){
  document.getElementById('desc-count').textContent='('+e.target.value.length+'/160)';
});

/* ═══════════ INIT ═══════════ */
// Verifica se existe um usuário salvo no localStorage antes de carregar o app
var savedUser = localStorage.getItem('hb_user');
if (savedUser && validUsername(savedUser)) {
  currentUser = savedUser;
}

// Atualiza a interface gráfica do topo (mostrando o avatar ou botão de login)
updateAuthUI();
loadProjects();

window.toggleTheme=toggleTheme;
window.openLoginModal=openLoginModal;
window.handleSubmitClick=handleSubmitClick;
window.doLogin=doLogin;
window.closeModal=closeModal;
window.submitProject=submitProject;
window.loadNextPage=loadNextPage;
window.loadPrevPage=loadPrevPage;
window.closeLightbox=closeLightbox;
window.lightboxNext = lightboxNext;
window.lightboxPrev = lightboxPrev;
window.handleLightboxOverlayClick = handleLightboxOverlayClick;

})();
