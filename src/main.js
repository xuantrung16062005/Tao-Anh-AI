(function(){
  "use strict";
  var APP_NAME = "Verdant Studio";
  var KEY_STORAGE = 'vs_gemini_api_key';
  var POLLINATIONS_TOKEN_STORAGE = 'vs_pollinations_token';
  var POLLINATIONS_ENDPOINT = 'https://image.pollinations.ai/prompt/';
  var POLLINATIONS_MODEL = 'flux';
  // Gọi ảnh/giọng nói/prompt AI thông qua backend (thư mục /api) của chính app này thay vì gọi thẳng Google từ
  // trình duyệt — API key Gemini có thể được cấu hình 1 lần trên server (biến môi trường GEMINI_API_KEY ở Vercel)
  // và không còn bị lộ ra ngoài trình duyệt. Nếu người dùng vẫn nhập key riêng ở nút 🔑, key đó sẽ được gửi kèm
  // theo mỗi request (ưu tiên dùng key riêng đó) — dùng cho trường hợp muốn override key server.
  var API_IMAGE_ENDPOINT = '/api/generate-image';
  var API_IMAGE_CF_ENDPOINT = '/api/generate-image-cf';
  var API_TEXT_ENDPOINT = '/api/generate-text';
  var API_TTS_ENDPOINT = '/api/tts';
  var TTS_VOICES = ['Kore','Puck','Zephyr','Charon','Fenrir','Leda','Orus','Aoede','Callirrhoe','Autonoe'];

  // ---------------- helpers ----------------
  function uid(prefix){ return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function slugify(str){
    if(!str) return "du-an-moi";
    var s = str.replace(/đ/g,'d').replace(/Đ/g,'D');
    s = s.normalize('NFD').replace(/[̀-ͯ]/g,'');
    s = s.toLowerCase();
    s = s.replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    return s || "du-an-moi";
  }
  function sanitizeFileLabel(label, fallbackIdx){
    var s = String(label == null ? '' : label).trim();
    if(!s) s = String(fallbackIdx);
    s = s.replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,'_');
    return s || String(fallbackIdx);
  }
  function isCharacterLabel(label){ return /^c/i.test(String(label||'').trim()); }
  function escapeHtml(str){
    return String(str==null?'':str).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function dataUrlToBlob(dataUrl){
    var arr = dataUrl.split(','); var m = /:(.*?);/.exec(arr[0]); var mime = m ? m[1] : 'image/png';
    var bstr = atob(arr[1]); var n = bstr.length; var u8 = new Uint8Array(n);
    while(n--){ u8[n] = bstr.charCodeAt(n); }
    return new Blob([u8], { type: mime });
  }
  function triggerDownload(blob, filename){
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  }
  // Gói dữ liệu PCM thô (base64) do Gemini TTS trả về thành file .wav phát được trong <audio>/tải xuống.
  function pcmBase64ToWavDataUrl(base64Pcm, sampleRate, numChannels, bitsPerSample){
    sampleRate = sampleRate || 24000; numChannels = numChannels || 1; bitsPerSample = bitsPerSample || 16;
    var bstr = atob(base64Pcm);
    var n = bstr.length;
    var pcm = new Uint8Array(n);
    for(var i = 0; i < n; i++){ pcm[i] = bstr.charCodeAt(i); }
    var blockAlign = numChannels * bitsPerSample / 8;
    var byteRate = sampleRate * blockAlign;
    var header = new Uint8Array(44);
    var view = new DataView(header.buffer);
    function ws(offset, str){ for(var j = 0; j < str.length; j++){ view.setUint8(offset + j, str.charCodeAt(j)); } }
    ws(0,'RIFF'); view.setUint32(4, 36 + pcm.length, true); ws(8,'WAVE');
    ws(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true);
    view.setUint16(22,numChannels,true); view.setUint32(24,sampleRate,true);
    view.setUint32(28,byteRate,true); view.setUint16(32,blockAlign,true); view.setUint16(34,bitsPerSample,true);
    ws(36,'data'); view.setUint32(40, pcm.length, true);
    var full = new Uint8Array(44 + pcm.length);
    full.set(header, 0); full.set(pcm, 44);
    var bin = ''; var CHUNK = 0x8000;
    for(var i2 = 0; i2 < full.length; i2 += CHUNK){ bin += String.fromCharCode.apply(null, full.subarray(i2, i2 + CHUNK)); }
    return 'data:audio/wav;base64,' + btoa(bin);
  }

  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function toast(msg, isError){
    toastEl.textContent = msg;
    toastEl.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('visible'); }, isError ? 6000 : 2800);
  }

  try { var savedTheme = localStorage.getItem('vs_theme'); if(savedTheme) document.documentElement.setAttribute('data-theme', savedTheme); } catch(e){}

  // ---------------- state ----------------
  var state = {
    projectName: "",
    activeTab: "characters",
    tabs: { voice: "", image: "" },
    characters: [],
    scenes: [],
    stylePrompt: "",
    storyContent: "",
    voice: { name: "Kore", audio: null, status: "idle", errorMsg: "" },
    gallery: [],
    imageProvider: "gemini" // "gemini" (trả phí, chất lượng cao, đồng nhất nhân vật tốt) | "cloudflare" (miễn phí, chất lượng khá, tạo song song được, không tham chiếu ảnh nhân vật) | "pollinations" (miễn phí, chậm hơn, không tham chiếu ảnh nhân vật)
  };

  function newCharacter(){
    return { id: uid('c'), name: "", description: "", images: [], isDefault: state.characters.length === 0 };
  }
  function nextSceneLabel(){ return String(state.scenes.length + 1); }
  function newScene(labelOverride){
    var label = labelOverride != null ? labelOverride : nextSceneLabel();
    var def = state.characters.find(function(c){ return c.isDefault; });
    var giveDefault = isCharacterLabel(label) && def;
    return { id: uid('s'), sceneLabel: label, lang1: "", vi: "", promptName: "", setting: "", characterIds: giveDefault ? [def.id] : [], image: null, status: 'idle', errorMsg: "" };
  }

  var projectNameInput = document.getElementById('projectNameInput');
  var slugPreview = document.getElementById('slugPreview');
  var stylePromptInput = document.getElementById('stylePromptInput');
  var storyContentInput = document.getElementById('storyContentInput');

  // ================= CHARACTERS =================
  var charList = document.getElementById('charList');
  var charFileInput = document.getElementById('charFileInput');
  var pendingCharId = null;

  var charDescLoading = {}; // { charId: true } — trạng thái đang gọi AI mô tả ngoại hình từ ảnh, chỉ dùng cho UI

  function renderCharacters(){
    if(!state.characters.length){
      charList.innerHTML = '<div class="hint-note">Chưa có nhân vật nào. Bấm "+ Thêm nhân vật" để bắt đầu upload ảnh mẫu.</div>';
      return;
    }
    charList.innerHTML = state.characters.map(function(c){
      var thumbs = c.images.map(function(im){
        return '<div class="char-thumb" data-char="'+c.id+'" data-img="'+im.id+'">' +
          '<img src="'+im.dataUrl+'" alt="ảnh nhân vật">' +
          '<button class="remove-thumb" data-action="remove-img" data-char="'+c.id+'" data-img="'+im.id+'" title="Xoá ảnh">✕</button>' +
        '</div>';
      }).join('');
      return '<div class="card char-card" data-char="'+c.id+'">' +
        '<div class="char-card-head">' +
          '<button class="star-btn'+(c.isDefault?' is-default':'')+'" data-action="set-default" data-char="'+c.id+'" title="Đặt làm nhân vật mặc định">★</button>' +
          '<input class="field-input" style="font-weight:700;flex:1" data-action="name" data-char="'+c.id+'" placeholder="Tên nhân vật" value="'+escapeHtml(c.name)+'">' +
          '<button class="row-del-btn" data-action="del-char" data-char="'+c.id+'" title="Xoá nhân vật">✕</button>' +
        '</div>' +
        '<div class="char-fields">' +
          '<div>' +
            '<label style="font-size:11.5px;color:var(--ink-faint);display:block;margin-bottom:4px;">Ảnh mẫu (tối đa 5)</label>' +
            '<div class="char-images">' + thumbs +
              (c.images.length < 5 ? '<div class="dropzone" data-action="dropzone" data-char="'+c.id+'">📎 Kéo ảnh vào đây<br>hoặc bấm để chọn</div>' : '') +
            '</div>' +
          '</div>' +
          '<div>' +
            '<label style="font-size:11.5px;color:var(--ink-faint);display:block;margin-bottom:4px;">Đặc điểm cần đồng nhất</label>' +
            '<textarea class="field-textarea" data-action="desc" data-char="'+c.id+'" placeholder="Ví dụ: luôn mặc áo khoác da đen, tóc xoăn đỏ, quần rách gối…">'+escapeHtml(c.description)+'</textarea>' +
            '<button type="button" class="btn ghost small ai-desc-btn" data-action="ai-desc" data-char="'+c.id+'" style="margin-top:6px" title="Dùng AI nhìn ảnh mẫu và tự viết mô tả ngoại hình chi tiết — giúp các nguồn tạo ảnh miễn phí (Cloudflare/Pollinations, vốn KHÔNG xem được ảnh mẫu) vẫn vẽ đúng ngoại hình nhân vật hơn nhờ đọc mô tả bằng chữ này" '+(charDescLoading[c.id]?'disabled':'')+'>'+(charDescLoading[c.id]?'⏳ AI đang mô tả…':'✨ AI mô tả ngoại hình từ ảnh')+'</button>' +
          '</div>' +
        '</div>' +
        '<div class="char-card-foot"><span class="char-count">'+c.images.length+'/5 ảnh'+(c.isDefault?' · Mặc định':'')+'</span></div>' +
      '</div>';
    }).join('');
  }

  function addImagesToCharacter(charId, files){
    var c = state.characters.find(function(x){ return x.id === charId; });
    if(!c) return;
    var room = 5 - c.images.length;
    if(room <= 0){ toast('Nhân vật này đã đủ 5 ảnh'); return; }
    var picked = Array.from(files).filter(function(f){ return f.type.indexOf('image/') === 0; }).slice(0, room);
    if(!picked.length) return;
    var loaded = 0;
    picked.forEach(function(file){
      var reader = new FileReader();
      reader.onload = function(){
        c.images.push({ id: uid('img'), dataUrl: String(reader.result), mime: file.type || 'image/png' });
        loaded++;
        if(loaded === picked.length){ renderCharacters(); scheduleHistoryPush(); }
      };
      reader.readAsDataURL(file);
    });
    if(files.length > room) toast('Chỉ nhận thêm được '+room+' ảnh (tối đa 5 ảnh/nhân vật)');
  }

  charList.addEventListener('click', function(e){
    var btn = e.target.closest('[data-action]');
    if(!btn) return;
    var action = btn.getAttribute('data-action');
    var charId = btn.getAttribute('data-char');
    if(action === 'set-default'){
      state.characters.forEach(function(c){ c.isDefault = (c.id === charId); });
      renderCharacters(); scheduleHistoryPush();
    } else if(action === 'del-char'){
      if(!confirm('Xoá nhân vật này? Các phân cảnh đang dùng nhân vật này sẽ bỏ chọn nhân vật đó.')) return;
      state.characters = state.characters.filter(function(c){ return c.id !== charId; });
      state.scenes.forEach(function(s){ s.characterIds = s.characterIds.filter(function(id){ return id !== charId; }); });
      renderCharacters(); renderScenes(); scheduleHistoryPush();
    } else if(action === 'remove-img'){
      var imgId = btn.getAttribute('data-img');
      var c = state.characters.find(function(x){ return x.id === charId; });
      if(c){ c.images = c.images.filter(function(im){ return im.id !== imgId; }); renderCharacters(); scheduleHistoryPush(); }
    } else if(action === 'dropzone'){
      pendingCharId = charId;
      charFileInput.click();
    } else if(action === 'ai-desc'){
      describeCharacterAppearance(charId).catch(function(){});
    }
  });
  charList.addEventListener('input', function(e){
    var el = e.target.closest('[data-action="name"],[data-action="desc"]');
    if(!el) return;
    var c = state.characters.find(function(x){ return x.id === el.getAttribute('data-char'); });
    if(!c) return;
    if(el.getAttribute('data-action') === 'name') c.name = el.value; else c.description = el.value;
    renderScenes();
    scheduleHistoryPush();
  });
  charList.addEventListener('dragover', function(e){
    var dz = e.target.closest('.dropzone'); if(!dz) return;
    e.preventDefault(); dz.classList.add('dragover');
  });
  charList.addEventListener('dragleave', function(e){
    var dz = e.target.closest('.dropzone'); if(!dz) return;
    dz.classList.remove('dragover');
  });
  charList.addEventListener('drop', function(e){
    var dz = e.target.closest('.dropzone'); if(!dz) return;
    e.preventDefault(); dz.classList.remove('dragover');
    addImagesToCharacter(dz.getAttribute('data-char'), e.dataTransfer.files);
  });
  charFileInput.addEventListener('change', function(e){
    if(pendingCharId && e.target.files && e.target.files.length){ addImagesToCharacter(pendingCharId, e.target.files); }
    pendingCharId = null; e.target.value = "";
  });
  document.getElementById('btnAddChar').addEventListener('click', function(){
    state.characters.push(newCharacter());
    renderCharacters(); scheduleHistoryPush();
  });

  // ================= SCENES / SCRIPT TABLE =================
  var sceneList = document.getElementById('sceneList');
  var charPopover = document.getElementById('charPopover');
  var popoverSceneId = null;

  function charName(id){ var c = state.characters.find(function(x){ return x.id === id; }); return c ? (c.name || '(chưa đặt tên)') : null; }

  function renderScenes(){
    if(!state.scenes.length){
      sceneList.innerHTML = '<div class="hint-note">Chưa có phân đoạn nào. Bấm "+ Thêm phân đoạn" hoặc "📥 Nhập từ Excel" để bắt đầu.</div>';
      return;
    }
    sceneList.innerHTML = state.scenes.map(function(s, idx){
      var pills = s.characterIds.map(charName).filter(Boolean).map(function(n){ return '<span class="char-pill">'+escapeHtml(n)+'</span>'; }).join('');
      var genInner;
      if(s.status === 'loading'){
        genInner = '<div class="spinner"></div>';
      } else if(s.image){
        genInner = '<img src="'+s.image.dataUrl+'" data-action="view" data-scene="'+s.id+'" alt="Ảnh phân cảnh '+escapeHtml(s.sceneLabel)+'">';
      } else if(s.status === 'error'){
        genInner = '<div class="err-hint" title="'+escapeHtml(s.errorMsg||'')+'">Lỗi tạo ảnh<br>(rê chuột xem chi tiết)</div>';
      } else {
        genInner = '<div class="empty-hint">Chưa có ảnh</div>';
      }
      var actions = '<div class="gen-actions">' +
        '<button data-action="gen" data-scene="'+s.id+'" title="Tạo ảnh" '+(s.status==='loading'?'disabled':'')+'>🎨</button>' +
        (s.image ? '<button data-action="view" data-scene="'+s.id+'" title="Xem full">⤢</button><button data-action="download" data-scene="'+s.id+'" title="Tải ảnh">⬇</button>' : '') +
      '</div>';
      return '<div class="scene-row" data-scene="'+s.id+'">' +
        '<div class="scene-cell scene-num-cell" data-label="Scene">' +
          '<input class="field-input scene-label-input" data-action="label" data-scene="'+s.id+'" value="'+escapeHtml(s.sceneLabel)+'">' +
          '<button class="row-del-btn" data-action="del-scene" data-scene="'+s.id+'" title="Xoá phân đoạn">✕</button>' +
        '</div>' +
        '<div class="scene-cell" data-label="Ngôn ngữ 1"><textarea class="cell-textarea" data-action="lang1" data-scene="'+s.id+'" placeholder="Ngôn ngữ 1…">'+escapeHtml(s.lang1)+'</textarea></div>' +
        '<div class="scene-cell" data-label="Tiếng Việt"><textarea class="cell-textarea" data-action="vi" data-scene="'+s.id+'" placeholder="Tiếng Việt…">'+escapeHtml(s.vi)+'</textarea></div>' +
        '<div class="scene-cell" data-label="Tên Prompt"><textarea class="cell-textarea" data-action="promptName" data-scene="'+s.id+'" placeholder="Tóm tắt phân cảnh…">'+escapeHtml(s.promptName)+'</textarea></div>' +
        '<div class="scene-cell setting-cell" data-label="Mô tả bối cảnh">' +
          '<textarea class="cell-textarea" data-action="setting" data-scene="'+s.id+'" placeholder="Mô tả bối cảnh dùng để vẽ ảnh… (hoặc bấm 🧠 để AI tự viết)">'+escapeHtml(s.setting)+'</textarea>' +
          '<div class="setting-cell-tools"><button class="ai-prompt-btn" data-action="gen-prompt" data-scene="'+s.id+'" title="Dùng AI tự viết Mô tả bối cảnh từ nội dung/thoại + nhân vật đã chọn" '+(scenePromptGenLoading[s.id]?'disabled':'')+'>'+(scenePromptGenLoading[s.id]?'⏳ Đang viết…':'🧠 AI viết prompt')+'</button></div>' +
        '</div>' +
        '<div class="scene-cell char-select-cell" data-label="Chọn nhân vật">' +
          '<button class="btn ghost small char-select-trigger" data-action="pick-char" data-scene="'+s.id+'">'+(pills?'Sửa':'Chọn nhân vật (None)')+' <span>▾</span></button>' +
          '<div class="char-pills">'+(pills || '<span style="font-size:11px;color:var(--ink-faint)">None</span>')+'</div>' +
        '</div>' +
        '<div class="scene-cell gen-cell" data-label="Ảnh">' +
          '<div class="gen-thumb">'+genInner+'</div>' + actions +
        '</div>' +
      '</div>';
    }).join('');
  }

  sceneList.addEventListener('input', function(e){
    var el = e.target.closest('[data-action]');
    if(!el) return;
    var fieldMap = { label: 'sceneLabel', lang1: 'lang1', vi: 'vi', promptName: 'promptName', setting: 'setting' };
    var action = el.getAttribute('data-action');
    if(!fieldMap[action]) return;
    var s = state.scenes.find(function(x){ return x.id === el.getAttribute('data-scene'); });
    if(!s) return;
    s[fieldMap[action]] = el.value;
    scheduleHistoryPush();
  });

  sceneList.addEventListener('click', function(e){
    var btn = e.target.closest('[data-action]');
    if(!btn) return;
    var action = btn.getAttribute('data-action');
    var sceneId = btn.getAttribute('data-scene');
    if(action === 'del-scene'){
      if(!confirm('Xoá phân đoạn này?')) return;
      state.scenes = state.scenes.filter(function(s){ return s.id !== sceneId; });
      renderScenes(); scheduleHistoryPush();
    } else if(action === 'pick-char'){
      openCharPopover(sceneId, btn);
    } else if(action === 'gen'){
      generateSceneImage(sceneId);
    } else if(action === 'gen-prompt'){
      generateScenePrompt(sceneId).catch(function(){});
    } else if(action === 'view'){
      openLightbox(sceneId);
    } else if(action === 'download'){
      downloadSceneImage(sceneId);
    }
  });

  function openCharPopover(sceneId, anchorEl){
    popoverSceneId = sceneId;
    var s = state.scenes.find(function(x){ return x.id === sceneId; });
    if(!state.characters.length){
      charPopover.innerHTML = '<div class="empty">Chưa có nhân vật nào.<br>Thêm ở tab "Nhân vật" trước.</div>';
    } else {
      charPopover.innerHTML = state.characters.map(function(c){
        var checked = s.characterIds.indexOf(c.id) > -1 ? 'checked' : '';
        return '<label><input type="checkbox" value="'+c.id+'" '+checked+'> '+escapeHtml(c.name || '(chưa đặt tên)')+(c.isDefault?' ★':'')+'</label>';
      }).join('');
    }
    var r = anchorEl.getBoundingClientRect();
    charPopover.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 256)) + 'px';
    charPopover.style.top = (r.bottom + 6) + 'px';
    charPopover.classList.add('open');
  }
  function closeCharPopover(){ charPopover.classList.remove('open'); popoverSceneId = null; }
  charPopover.addEventListener('change', function(e){
    if(e.target.type !== 'checkbox' || !popoverSceneId) return;
    var s = state.scenes.find(function(x){ return x.id === popoverSceneId; });
    if(!s) return;
    var id = e.target.value;
    if(e.target.checked){ if(s.characterIds.indexOf(id) === -1) s.characterIds.push(id); }
    else { s.characterIds = s.characterIds.filter(function(x){ return x !== id; }); }
    renderScenes();
    scheduleHistoryPush();
  });
  document.addEventListener('click', function(e){
    if(charPopover.classList.contains('open') && !charPopover.contains(e.target) && !e.target.closest('[data-action="pick-char"]')){
      closeCharPopover();
    }
  });

  document.getElementById('btnAddScene').addEventListener('click', function(){
    state.scenes.push(newScene());
    renderScenes(); scheduleHistoryPush();
  });

  document.querySelectorAll('.help-btn').forEach(function(b){
    b.addEventListener('click', function(){
      var msgs = {
        scene: 'Số thứ tự phân cảnh. Khi tải các file ảnh được tạo ra từ phân cảnh này, ảnh sẽ được đặt tên giống tên của ô trong cột này.',
        promptname: 'Tóm tắt những gì xảy ra trong phân cảnh này để check tính chính xác của ảnh tạo ra.'
      };
      toast(msgs[b.getAttribute('data-help')] || '');
    });
  });

  // ---------------- Excel import ----------------
  document.getElementById('btnImportExcel').addEventListener('click', function(){
    document.getElementById('excelFileInput').click();
  });
  document.getElementById('excelFileInput').addEventListener('change', async function(e){
    var file = e.target.files && e.target.files[0];
    e.target.value = "";
    if(!file) return;
    if(typeof XLSX === 'undefined'){ toast('Không tải được thư viện đọc Excel (cần kết nối mạng)'); return; }
    try {
      var buf = await file.arrayBuffer();
      var wb = XLSX.read(buf, { type: 'array' });
      var sheet = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      var dataRows = rows.slice(1).filter(function(r){ return r.some(function(cell){ return String(cell).trim() !== ''; }); });
      if(!dataRows.length){ toast('Không tìm thấy dữ liệu (đã bỏ qua hàng tiêu đề)'); return; }
      var defChar = state.characters.find(function(c){ return c.isDefault; });
      var imported = dataRows.map(function(r, i){
        var label = String(r[0] != null ? r[0] : '').trim() || String(state.scenes.length + i + 1);
        var giveDefault = isCharacterLabel(label) && defChar;
        return {
          id: uid('s'), sceneLabel: label,
          lang1: String(r[1] != null ? r[1] : ''),
          vi: String(r[2] != null ? r[2] : ''),
          promptName: String(r[3] != null ? r[3] : ''),
          setting: String(r[4] != null ? r[4] : ''),
          characterIds: giveDefault ? [defChar.id] : [],
          image: null, status: 'idle', errorMsg: ''
        };
      });
      var replace = state.scenes.length > 0
        ? confirm('Đã có '+state.scenes.length+' phân đoạn.\nOK = THAY THẾ toàn bộ bằng '+imported.length+' phân đoạn từ file Excel.\nCancel = THÊM NỐI TIẾP vào cuối danh sách.')
        : true;
      state.scenes = replace ? imported : state.scenes.concat(imported);
      renderScenes(); scheduleHistoryPush();
      toast('Đã nhập '+imported.length+' phân cảnh từ Excel'+(replace?' (thay thế)':' (thêm nối tiếp)'));
    } catch(err){
      console.error(err);
      toast('Lỗi đọc file Excel: '+(err && err.message ? err.message : 'không xác định'));
    }
  });

  // ---------------- Gemini (Nano Banana) client ----------------
  function getApiKey(){ try { return (localStorage.getItem(KEY_STORAGE) || '').trim(); } catch(e){ return ''; } }
  function getPollinationsToken(){ try { return (localStorage.getItem(POLLINATIONS_TOKEN_STORAGE) || '').trim(); } catch(e){ return ''; } }

  // ---------------- Pollinations.ai (nguồn tạo ảnh miễn phí, thay thế Gemini) ----------------
  // Model ảnh miễn phí (flux) được huấn luyện chủ yếu bằng tiếng Anh nên hiểu prompt tiếng Việt rất kém,
  // dễ ra ảnh lạc đề hoàn toàn so với mô tả. Tự dịch prompt sang tiếng Anh (dùng chính model text Gemini,
  // miễn phí) trước khi gửi cho Pollinations giúp ảnh bám sát mô tả hơn hẳn — nếu dịch lỗi thì vẫn dùng
  // nguyên bản tiếng Việt để không chặn hẳn việc tạo ảnh.
  async function translatePromptToEnglishForImage(viText){
    try {
      var instruction = 'Dịch/diễn đạt lại đoạn mô tả ảnh sau đây sang tiếng Anh, viết thành một prompt vẽ ảnh (image generation prompt) chi tiết, tự nhiên, đúng ngữ pháp tiếng Anh, giữ nguyên toàn bộ ý nghĩa và chi tiết (bối cảnh, hành động, ánh sáng, góc máy, phong cách...). CHỈ trả về đúng đoạn tiếng Anh đã viết lại, không thêm lời dẫn, không đặt trong ngoặc kép, không markdown.\n\nĐoạn cần dịch:\n"""\n' + viText + '\n"""';
      var translated = await callGeminiText(instruction);
      return (translated && translated.trim()) ? translated.trim() : viText;
    } catch(err){
      console.warn('Không dịch được prompt sang tiếng Anh cho Pollinations, dùng nguyên bản', err);
      return viText;
    }
  }
  async function callPollinationsImage(promptText){
    var token = getPollinationsToken();
    var seed = Math.floor(Math.random() * 1e9); // seed ngẫu nhiên để không nhận lại ảnh cũ trùng lặp
    var finalPrompt = await translatePromptToEnglishForImage(promptText);
    var url = POLLINATIONS_ENDPOINT + encodeURIComponent(finalPrompt) +
      '?width=1024&height=1024&nologo=true&model=' + POLLINATIONS_MODEL + '&seed=' + seed;
    var headers = {};
    if(token) headers['Authorization'] = 'Bearer ' + token;
    var res = await fetch(url, { headers: headers });
    if(!res.ok){ throw new Error('Lỗi HTTP ' + res.status + ' từ Pollinations'); }
    var blob = await res.blob();
    var mime = blob.type || 'image/jpeg';
    var dataUrl = await new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(){ resolve(String(reader.result)); };
      reader.onerror = function(){ reject(new Error('Không đọc được ảnh trả về từ Pollinations')); };
      reader.readAsDataURL(blob);
    });
    return { dataUrl: dataUrl, mime: mime };
  }
  // ---------------- Cloudflare Workers AI (nguồn tạo ảnh miễn phí thứ 2, chất lượng tốt hơn Pollinations) ----------------
  // Gọi qua backend /api/generate-image-cf (cần CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN cấu hình trên server —
  // xem README). Vì đây là hạn mức riêng của tài khoản Cloudflare (10.000 neurons/ngày miễn phí, mỗi ảnh chỉ tốn
  // vài neuron) chứ không dùng chung với người lạ như Pollinations ẩn danh, nên có thể tạo NHIỀU ảnh song song
  // cùng lúc mà không cần giãn cách/chờ như Pollinations.
  async function callCloudflareImage(promptText){
    var finalPrompt = await translatePromptToEnglishForImage(promptText);
    var res = await fetch(API_IMAGE_CF_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: finalPrompt })
    });
    var json = await res.json().catch(function(){ return {}; });
    if(!res.ok){ throw new Error((json && json.error && json.error.message) || ('Lỗi HTTP ' + res.status + ' từ Cloudflare')); }
    if(!json.image){ throw new Error('Không nhận được ảnh từ Cloudflare Workers AI'); }
    return { dataUrl: 'data:image/png;base64,' + json.image, mime: 'image/png' };
  }

  // Prompt dạng văn bản thuần cho Pollinations/Cloudflare — không gửi kèm ảnh nhân vật (2 nguồn này không nhận
  // ảnh tham chiếu base64), nên chỉ mô tả nhân vật bằng chữ, độ đồng nhất ngoại hình sẽ kém chính xác hơn so với dùng Gemini.
  function buildTextOnlyPrompt(styleText, charList, settingText, editText){
    var parts = [];
    if(styleText) parts.push('Phong cách chung: ' + styleText);
    if(charList && charList.length){
      parts.push('Nhân vật xuất hiện trong cảnh (mô tả để giữ đồng nhất): ' + charList.map(function(c){
        return (c.name || 'nhân vật') + (c.description ? (' — ' + c.description) : '');
      }).join('; '));
    }
    parts.push('Bối cảnh: ' + settingText);
    if(editText) parts.push('Yêu cầu chỉnh sửa thêm: ' + editText);
    return 'Minh hoạ điện ảnh chất lượng cao, không chữ, không watermark, không chú thích. ' + parts.join('. ');
  }

  function dataUrlToInline(dataUrl){
    var m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
    return m ? { mime_type: m[1], data: m[2] } : null;
  }
  // Ảnh mẫu chụp từ điện thoại thường rất nặng (vài MB/ảnh, có thể lên chục MB khi gộp nhiều ảnh) — gửi thẳng lên
  // server dễ bị lỗi "413 Payload Too Large" (Vercel giới hạn dung lượng mỗi request). Hàm này thu nhỏ + nén ảnh
  // lại (còn tối đa ~1024px cạnh dài, xuất JPEG) trước khi gửi đi, vừa đủ chi tiết để AI nhận diện ngoại hình,
  // vừa nhẹ để không bị chặn. Dùng chung cho mọi nơi gửi ảnh nhân vật lên server (mô tả ngoại hình, tạo ảnh Gemini).
  function resizeImageDataUrl(dataUrl, maxDim, quality){
    return new Promise(function(resolve){
      try {
        var img = new Image();
        img.onload = function(){
          try {
            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            var scale = Math.min(1, (maxDim || 1024) / Math.max(w, h));
            var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
            var canvas = document.createElement('canvas');
            canvas.width = tw; canvas.height = th;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, tw, th);
            resolve(canvas.toDataURL('image/jpeg', quality || 0.85));
          } catch(e){ resolve(dataUrl); }
        };
        img.onerror = function(){ resolve(dataUrl); };
        img.src = dataUrl;
      } catch(e){ resolve(dataUrl); }
    });
  }
  async function buildCharacterParts(characterIds){
    var parts = [];
    var chars = characterIds.map(function(id){ return state.characters.find(function(c){ return c.id === id; }); }).filter(Boolean);
    for(var i = 0; i < chars.length; i++){
      var c = chars[i];
      var line = 'Nhân vật "' + (c.name || '(chưa đặt tên)') + '"' + (c.description ? ' — đặc điểm cần giữ nguyên xuyên suốt: ' + c.description : '') + '. Vẽ đúng ngoại hình nhân vật này theo (các) ảnh tham chiếu sau:';
      parts.push({ text: line });
      var imgs = c.images.slice(0, 3);
      for(var j = 0; j < imgs.length; j++){
        var resized = await resizeImageDataUrl(imgs[j].dataUrl, 1024, 0.85);
        var inline = dataUrlToInline(resized);
        if(inline) parts.push({ inline_data: inline });
      }
    }
    return parts;
  }

  // Key nhập ở nút 🔑 (nếu có) sẽ được gửi kèm để server ưu tiên dùng, thay cho GEMINI_API_KEY cấu hình sẵn trên server.
  function buildApiHeaders(){
    var headers = { 'Content-Type': 'application/json' };
    var apiKey = getApiKey();
    if(apiKey) headers['x-gemini-key'] = apiKey;
    return headers;
  }

  async function callGemini(parts){
    var res = await fetch(API_IMAGE_ENDPOINT, {
      method: 'POST',
      headers: buildApiHeaders(),
      body: JSON.stringify({ parts: parts })
    });
    var json = await res.json().catch(function(){ return {}; });
    if(!res.ok){ throw new Error((json && json.error && json.error.message) || ('Lỗi HTTP ' + res.status)); }
    var cand = json.candidates && json.candidates[0];
    var p = (cand && cand.content && cand.content.parts) || [];
    var imgPart = null;
    for(var i = 0; i < p.length; i++){ var part = p[i].inline_data || p[i].inlineData; if(part){ imgPart = part; break; } }
    if(!imgPart) throw new Error('Không nhận được ảnh từ Gemini (prompt có thể đã bị từ chối).');
    var mime = imgPart.mime_type || imgPart.mimeType || 'image/png';
    return { dataUrl: 'data:' + mime + ';base64,' + imgPart.data, mime: mime };
  }

  // ---------------- Gemini text (dùng để AI tự viết prompt "Mô tả bối cảnh", và AI mô tả ngoại hình nhân vật từ ảnh) ----------------
  // images (tuỳ chọn): mảng [{ mime_type, data(base64) }] — dùng khi cần Gemini "nhìn" ảnh (vd mô tả ngoại hình nhân vật).
  async function callGeminiText(promptText, images){
    var body = { text: promptText };
    if(images && images.length) body.images = images;
    var res = await fetch(API_TEXT_ENDPOINT, {
      method: 'POST',
      headers: buildApiHeaders(),
      body: JSON.stringify(body)
    });
    var json = await res.json().catch(function(){ return {}; });
    if(!res.ok){ throw new Error((json && json.error && json.error.message) || ('Lỗi HTTP ' + res.status)); }
    var cand = json.candidates && json.candidates[0];
    var parts = (cand && cand.content && cand.content.parts) || [];
    var text = parts.map(function(p){ return p.text || ''; }).join('').trim();
    if(!text) throw new Error('Không nhận được nội dung prompt từ Gemini (có thể đã bị chặn do chính sách nội dung).');
    return text;
  }

  // ---------------- AI mô tả ngoại hình nhân vật từ ảnh mẫu (dùng chữ để "thay thế" ảnh tham chiếu) ----------------
  // Cloudflare/Pollinations (2 nguồn tạo ảnh miễn phí) KHÔNG nhận được ảnh mẫu của nhân vật — chỉ nhận được prompt
  // dạng chữ (xem buildTextOnlyPrompt ở trên, vốn đã tự động chèn c.description vào prompt gửi đi). Vì vậy nếu
  // c.description không đủ chi tiết, ảnh tạo ra dễ bị sai hoàn toàn so với ảnh mẫu. Nút "AI mô tả ngoại hình từ ảnh"
  // nhờ Gemini "nhìn" trực tiếp (các) ảnh mẫu và tự viết ra một đoạn mô tả ngoại hình chi tiết bằng chữ, ghi thẳng
  // vào ô "Đặc điểm cần đồng nhất" — từ đó mọi nơi dùng c.description (Gemini, Cloudflare, Pollinations, AI viết
  // prompt phân cảnh, AI tự chia phân đoạn) đều tự động được hưởng lợi mà không cần sửa gì thêm.
  function buildCharacterAppearanceDescribeRequest(){
    return 'Hãy mô tả THẬT CHI TIẾT ngoại hình của nhân vật xuất hiện trong (các) ảnh sau, bằng tiếng Việt, để dùng làm mô tả tham chiếu cho một AI vẽ ảnh khác (AI đó KHÔNG nhìn thấy được ảnh gốc, chỉ đọc được đoạn mô tả này). ' +
      'Tập trung vào các đặc điểm ổn định, xuất hiện lặp lại giữa các ảnh (nếu có nhiều ảnh): giới tính, độ tuổi ước lượng, kiểu dáng và màu tóc, hình dáng khuôn mặt, màu da, vóc dáng cơ thể, trang phục/phong cách ăn mặc thường thấy, và bất kỳ đặc điểm nhận diện riêng biệt nào (hình xăm, kính, sẹo, phụ kiện…). ' +
      'CHỈ trả về đúng một đoạn mô tả liền mạch (khoảng 3-5 câu), không đánh số, không markdown, không nhắc đến việc "trong ảnh" hay "bức ảnh", không thêm lời dẫn hay giải thích nào khác.';
  }

  async function describeCharacterAppearance(charId){
    if(charDescLoading[charId]) return;
    var c = state.characters.find(function(x){ return x.id === charId; });
    if(!c) return;
    if(!c.images.length){ toast('Hãy tải ảnh mẫu cho nhân vật này trước, để AI có ảnh mà mô tả'); return; }
    if(c.description && c.description.trim()){
      if(!confirm('Nhân vật này đã có "Đặc điểm cần đồng nhất" — ghi đè bằng mô tả AI viết mới từ ảnh mẫu?')) return;
    }
    var images = (await Promise.all(c.images.slice(0, 5).map(function(im){
      return resizeImageDataUrl(im.dataUrl, 1024, 0.85);
    }))).map(dataUrlToInline).filter(Boolean);
    charDescLoading[charId] = true; renderCharacters();
    try {
      var desc = await callGeminiText(buildCharacterAppearanceDescribeRequest(), images);
      var stillThere = state.characters.find(function(x){ return x.id === charId; });
      if(stillThere){ stillThere.description = desc; scheduleHistoryPush(); }
      toast('AI đã mô tả xong ngoại hình nhân vật "' + (c.name || '(chưa đặt tên)') + '" — bạn có thể sửa lại nếu muốn');
    } catch(err){
      console.error('Lỗi AI mô tả ngoại hình nhân vật', err);
      toast('Lỗi AI mô tả ngoại hình: ' + ((err && err.message) || 'không xác định'), true);
      throw err;
    } finally {
      delete charDescLoading[charId];
      renderCharacters();
    }
  }

  function buildScenePromptGenRequest(s){
    var charList = (s.characterIds || []).map(function(id){
      var c = state.characters.find(function(x){ return x.id === id; });
      if(!c) return null;
      return (c.name || '(chưa đặt tên)') + (c.description ? ' — ' + c.description : '');
    }).filter(Boolean);
    var dialogue = (s.vi && s.vi.trim()) || (s.lang1 && s.lang1.trim()) || (s.promptName && s.promptName.trim()) || '';
    var style = (state.stylePrompt && state.stylePrompt.trim()) || '';
    var lines = [];
    lines.push('Bạn là trợ lý viết prompt "Mô tả bối cảnh" cho một AI vẽ ảnh minh hoạ truyện/video.');
    if(style) lines.push('Phong cách hình ảnh chung cần giữ xuyên suốt: ' + style);
    if(charList.length) lines.push('Nhân vật xuất hiện trong cảnh này: ' + charList.join('; '));
    lines.push('Nội dung/lời thoại của phân cảnh: "' + dialogue + '"');
    lines.push('Hãy viết đúng MỘT đoạn mô tả bối cảnh ngắn gọn (khoảng 1-3 câu, bằng tiếng Việt), tập trung vào: không gian/địa điểm, hành động và biểu cảm của nhân vật, ánh sáng, góc máy — đủ chi tiết để AI vẽ đúng cảnh này. CHỈ trả về đúng đoạn mô tả đó, không thêm lời dẫn, không đánh số thứ tự, không dùng markdown.');
    return lines.join('\n');
  }

  var scenePromptGenLoading = {}; // { sceneId: true } — trạng thái đang gọi AI viết prompt, chỉ dùng cho UI, không lưu vào dự án
  async function generateScenePrompt(sceneId, opts){
    opts = opts || {};
    var s = state.scenes.find(function(x){ return x.id === sceneId; });
    if(!s) return;
    var dialogue = (s.vi && s.vi.trim()) || (s.lang1 && s.lang1.trim()) || (s.promptName && s.promptName.trim());
    if(!dialogue){ toast('Hãy nhập Tiếng Việt / Ngôn ngữ 1 / Tên Prompt cho phân cảnh này trước, để AI biết viết prompt dựa vào đâu'); return; }
    if(!opts.silent && s.setting && s.setting.trim()){
      if(!confirm('Phân cảnh này đã có Mô tả bối cảnh — ghi đè bằng nội dung AI viết mới?')) return;
    }
    scenePromptGenLoading[sceneId] = true; renderScenes();
    try {
      s.setting = await callGeminiText(buildScenePromptGenRequest(s));
      scheduleHistoryPush();
    } catch(err){
      console.error('Lỗi AI viết prompt cho phân cảnh', s.sceneLabel, err);
      toast('Lỗi tạo prompt cho phân cảnh ' + (s.sceneLabel || '') + ': ' + ((err && err.message) || 'không xác định'), true);
      throw err;
    } finally {
      delete scenePromptGenLoading[sceneId];
      renderScenes();
    }
  }

  // ---------------- AI tự động chia nội dung/câu chuyện thành nhiều phân đoạn ----------------
  // Người dùng chỉ cần gõ nội dung (vd "An Nhiên đi tập gym") vào ô "Nội dung / câu chuyện" — AI sẽ tự
  // đọc, chia thành từng phân đoạn hợp lý về mặt hình ảnh, và tự viết luôn Mô tả bối cảnh cho từng phân đoạn đó
  // (không cần người dùng tự thêm từng dòng hay tự gõ tay prompt).
  function buildAutoSplitRequest(storyText){
    var style = (state.stylePrompt && state.stylePrompt.trim()) || '';
    var chars = state.characters.map(function(c){
      return (c.name || '').trim() ? (c.name.trim() + (c.description ? ' — ' + c.description : '')) : null;
    }).filter(Boolean);
    var lines = [];
    lines.push('Bạn là trợ lý dựng kịch bản phân cảnh (storyboard) cho một AI vẽ ảnh minh hoạ truyện/video.');
    if(style) lines.push('Phong cách hình ảnh chung cần giữ xuyên suốt: ' + style);
    if(chars.length) lines.push('Danh sách nhân vật đã có sẵn (nếu nội dung nhắc đúng tên nhân vật nào trong danh sách này thì dùng lại chính xác tên đó trong lời dẫn/mô tả): ' + chars.join('; '));
    lines.push('Nội dung/câu chuyện cần chia phân đoạn:\n"""\n' + storyText.trim() + '\n"""');
    lines.push('Hãy chia nội dung trên thành các phân đoạn (scene) hợp lý về mặt hình ảnh — mỗi phân đoạn là một khoảnh khắc/hành động đáng vẽ thành một tấm ảnh minh hoạ riêng (thường 3-12 phân đoạn tuỳ độ dài nội dung, không chia quá vụn hoặc quá gộp).');
    lines.push('CHỈ trả về đúng một mảng JSON hợp lệ, không kèm markdown code fence, không giải thích gì thêm ngoài JSON. Mỗi phần tử trong mảng có đúng các khoá: "label" (số thứ tự bắt đầu từ 1, dạng chuỗi), "vi" (nội dung/lời dẫn của phân đoạn đó bằng tiếng Việt, 1-2 câu), "promptName" (tóm tắt cực ngắn 3-6 chữ), "setting" (mô tả bối cảnh chi tiết bằng tiếng Việt dùng để vẽ ảnh: không gian, hành động, biểu cảm nhân vật, ánh sáng, góc máy).');
    lines.push('Ví dụ đúng định dạng: [{"label":"1","vi":"...","promptName":"...","setting":"..."},{"label":"2","vi":"...","promptName":"...","setting":"..."}]');
    return lines.join('\n');
  }

  function parseAutoSplitResponse(text){
    var cleaned = String(text || '').trim();
    var fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
    if(fenceMatch) cleaned = fenceMatch[1].trim();
    var start = cleaned.indexOf('[');
    var end = cleaned.lastIndexOf(']');
    if(start === -1 || end === -1 || end < start) throw new Error('Không đọc được danh sách phân đoạn từ phản hồi của AI');
    var arr;
    try { arr = JSON.parse(cleaned.slice(start, end + 1)); }
    catch(e){ throw new Error('Phản hồi của AI không đúng định dạng JSON'); }
    if(!Array.isArray(arr) || !arr.length) throw new Error('AI không trả về phân đoạn nào');
    return arr;
  }

  // Nếu nội dung phân đoạn có nhắc đúng tên 1 nhân vật đã thêm sẵn, tự động chọn nhân vật đó cho phân đoạn
  // để giữ đồng nhất ngoại hình khi tạo ảnh — người dùng không cần tự chọn lại bằng tay.
  function detectCharacterIdsInText(text){
    var lower = String(text || '').toLowerCase();
    if(!lower) return [];
    return state.characters.filter(function(c){
      var name = (c.name || '').trim().toLowerCase();
      return name && lower.indexOf(name) > -1;
    }).map(function(c){ return c.id; });
  }

  var autoSplitLoading = false;
  async function autoSplitStoryIntoScenes(){
    if(autoSplitLoading) return;
    var storyText = (state.storyContent || '').trim();
    if(!storyText){ toast('Hãy nhập nội dung/câu chuyện vào ô "Nội dung / câu chuyện" trước'); return; }
    var replace = state.scenes.length > 0
      ? confirm('Đã có ' + state.scenes.length + ' phân đoạn.\nOK = THAY THẾ toàn bộ bằng các phân đoạn AI vừa chia từ nội dung.\nCancel = THÊM NỐI TIẾP vào cuối danh sách.')
      : true;
    var btn = document.getElementById('btnAutoSplitScenes');
    autoSplitLoading = true;
    if(btn){ btn.disabled = true; btn.textContent = '⏳ AI đang chia phân đoạn…'; }
    try {
      var raw = await callGeminiText(buildAutoSplitRequest(storyText));
      var arr = parseAutoSplitResponse(raw);
      var newScenesArr = arr.map(function(item, i){
        var combinedText = [item && item.vi, item && item.promptName, item && item.setting].filter(Boolean).join(' ');
        return {
          id: uid('s'),
          sceneLabel: (item && item.label != null && String(item.label).trim()) ? String(item.label).trim() : String(i + 1),
          lang1: "",
          vi: String((item && item.vi) || ''),
          promptName: String((item && item.promptName) || ''),
          setting: String((item && item.setting) || ''),
          characterIds: detectCharacterIdsInText(combinedText),
          image: null, status: 'idle', errorMsg: ""
        };
      });
      state.scenes = replace ? newScenesArr : state.scenes.concat(newScenesArr);
      renderScenes(); scheduleHistoryPush();
      toast('AI đã chia thành ' + newScenesArr.length + ' phân đoạn' + (replace ? ' (thay thế)' : ' (thêm nối tiếp)') + ' — có thể bấm "🎨" từng dòng hoặc "✨ Tạo ảnh hàng loạt" để vẽ ảnh ngay');
    } catch(err){
      console.error('Lỗi AI chia phân đoạn', err);
      toast('Lỗi AI chia phân đoạn: ' + ((err && err.message) || 'không xác định'), true);
    } finally {
      autoSplitLoading = false;
      if(btn){ btn.disabled = false; btn.textContent = '✂️ AI tự động chia phân đoạn'; }
    }
  }
  document.getElementById('btnAutoSplitScenes').addEventListener('click', autoSplitStoryIntoScenes);

  // ---------------- Gemini TTS (text-to-speech) client ----------------
  function extractSampleRate(mimeStr){
    var m = /rate=(\d+)/.exec(mimeStr || '');
    return m ? parseInt(m[1], 10) : 24000;
  }
  async function callGeminiTTS(text, voiceName){
    var res = await fetch(API_TTS_ENDPOINT, {
      method: 'POST',
      headers: buildApiHeaders(),
      body: JSON.stringify({ text: text, voiceName: voiceName })
    });
    var json = await res.json().catch(function(){ return {}; });
    if(!res.ok){ throw new Error((json && json.error && json.error.message) || ('Lỗi HTTP ' + res.status)); }
    var cand = json.candidates && json.candidates[0];
    var p = (cand && cand.content && cand.content.parts) || [];
    var audioPart = null;
    for(var i = 0; i < p.length; i++){ var part = p[i].inline_data || p[i].inlineData; if(part){ audioPart = part; break; } }
    if(!audioPart) throw new Error('Không nhận được âm thanh từ Gemini.');
    var mimeStr = audioPart.mime_type || audioPart.mimeType || 'audio/L16;rate=24000';
    return { dataUrl: pcmBase64ToWavDataUrl(audioPart.data, extractSampleRate(mimeStr), 1, 16), mime: 'audio/wav' };
  }

  function renderVoice(){
    var sel = document.getElementById('voiceNameSelect');
    if(sel && sel.value !== state.voice.name) sel.value = state.voice.name;
    var btn = document.getElementById('btnGenVoice');
    if(btn){
      btn.disabled = state.voice.status === 'loading';
      btn.textContent = state.voice.status === 'loading' ? '⏳ Đang tạo…' : '🎙️ Tạo giọng nói';
    }
    var card = document.getElementById('voicePlayerCard');
    var audioEl = document.getElementById('voiceAudioEl');
    if(card && audioEl){
      if(state.voice.audio){
        card.style.display = 'flex';
        if(audioEl.getAttribute('src') !== state.voice.audio.dataUrl) audioEl.src = state.voice.audio.dataUrl;
      } else {
        card.style.display = 'none';
        audioEl.removeAttribute('src');
      }
    }
    var errEl = document.getElementById('voiceErrorHint');
    if(errEl){
      errEl.style.display = state.voice.status === 'error' ? 'block' : 'none';
      errEl.textContent = state.voice.errorMsg || '';
    }
  }

  function parseRetryDelaySeconds(errMsg){
    var m = /retry in\s*([0-9.]+)\s*s/i.exec(String(errMsg || ''));
    return m ? Math.ceil(parseFloat(m[1])) : null;
  }

  async function generateVoice(){
    var text = (state.tabs.voice || '').trim();
    if(!text){ toast('Hãy nhập kịch bản cần đọc trước'); return; }
    state.voice.status = 'loading'; renderVoice();
    var btn = document.getElementById('btnGenVoice');
    try {
      var result;
      try {
        result = await callGeminiTTS(text, state.voice.name);
      } catch(err){
        // Free tier của Gemini TTS hay bị "vượt hạn mức" tạm thời (khoảng chục giây tới ~1 phút).
        // Thay vì báo lỗi ngay, tự đợi đúng thời gian Google yêu cầu rồi thử lại 1 lần — người dùng không cần bấm lại tay.
        var retrySec = parseRetryDelaySeconds(err && err.message);
        if(retrySec && retrySec <= 90){
          for(var sLeft = retrySec; sLeft > 0; sLeft--){
            if(btn) btn.textContent = '⏳ Vượt hạn mức, tự thử lại sau ' + sLeft + 's…';
            await new Promise(function(r){ setTimeout(r, 1000); });
          }
          if(btn) btn.textContent = '⏳ Đang thử lại…';
          result = await callGeminiTTS(text, state.voice.name);
        } else {
          throw err;
        }
      }
      state.voice.audio = result; state.voice.status = 'done'; state.voice.errorMsg = '';
      toast('Đã tạo xong giọng đọc');
    } catch(err){
      console.error(err);
      state.voice.status = 'error'; state.voice.errorMsg = (err && err.message) || 'Lỗi không xác định';
      toast('Lỗi tạo giọng nói: ' + state.voice.errorMsg, true);
    }
    renderVoice();
    scheduleHistoryPush();
  }

  (function populateVoiceSelect(){
    var sel = document.getElementById('voiceNameSelect');
    sel.innerHTML = TTS_VOICES.map(function(v){ return '<option value="'+v+'">'+v+'</option>'; }).join('');
  })();
  document.getElementById('voiceNameSelect').addEventListener('change', function(){
    state.voice.name = this.value; scheduleHistoryPush();
  });
  document.getElementById('btnGenVoice').addEventListener('click', generateVoice);
  document.getElementById('btnDownloadVoice').addEventListener('click', function(){
    if(!state.voice.audio) return;
    triggerDownload(dataUrlToBlob(state.voice.audio.dataUrl), slugify(state.projectName) + '-giong-doc.wav');
  });

  async function generateSceneImage(sceneId, opts){
    opts = opts || {};
    var s = state.scenes.find(function(x){ return x.id === sceneId; });
    if(!s) return;
    var settingText = (s.setting && s.setting.trim()) || (s.promptName && s.promptName.trim()) || (s.vi && s.vi.trim()) || '';
    if(!settingText && !opts.editPrompt){ toast('Hãy nhập Mô tả bối cảnh (hoặc Tên Prompt / Tiếng Việt) trước khi tạo ảnh'); return; }
    var provider = state.imageProvider;

    s.status = 'loading'; renderScenes(); if(lightboxState.open && lightboxState.sceneId === sceneId) renderLightbox();

    try {
      var result;
      if(provider === 'pollinations' || provider === 'cloudflare'){
        var chars = s.characterIds.map(function(id){ return state.characters.find(function(c){ return c.id === id; }); }).filter(Boolean);
        var textPrompt = buildTextOnlyPrompt((state.stylePrompt || '').trim(), chars, settingText, opts.editPrompt);
        result = provider === 'cloudflare' ? await callCloudflareImage(textPrompt) : await callPollinationsImage(textPrompt);
      } else {
        var instruction = 'Vẽ một hình minh hoạ điện ảnh, chất lượng cao cho phân cảnh sau. CHỈ vẽ hình ảnh, tuyệt đối không thêm chữ, watermark hay chú thích nào trong ảnh.';
        var styleText = (state.stylePrompt || '').trim();
        var finalPrompt = (styleText ? ('Phong cách chung cần đồng nhất: ' + styleText + '\n') : '') + 'Mô tả bối cảnh phân cảnh: ' + settingText;
        var parts = [{ text: instruction + '\n\n' + finalPrompt }];
        parts = parts.concat(await buildCharacterParts(s.characterIds));
        if(s.characterIds.length === 0){
          var idx = state.scenes.findIndex(function(x){ return x.id === sceneId; });
          var prev = state.scenes[idx - 1];
          if(prev && prev.image){
            parts.push({ text: 'Đây là ảnh của phân cảnh liền trước để tham khảo, giữ đồng nhất phong cách vẽ; nếu mô tả bối cảnh trùng với phân cảnh này thì vẽ đúng cùng khung cảnh, cảnh vật:' });
            parts.push({ inline_data: dataUrlToInline(prev.image.dataUrl) });
          }
        }
        if(opts.editPrompt && s.image){
          parts.push({ text: 'Chỉnh sửa ảnh vừa tạo theo yêu cầu sau, giữ nguyên bố cục và nhân vật trừ khi được yêu cầu đổi khác: ' + opts.editPrompt });
          parts.push({ inline_data: dataUrlToInline(s.image.dataUrl) });
        }
        result = await callGemini(parts);
      }
      s.image = result; s.status = 'done'; s.errorMsg = '';
    } catch(err){
      console.error(err);
      s.status = 'error'; s.errorMsg = (err && err.message) || 'Lỗi không xác định';
      toast('Lỗi tạo ảnh: ' + s.errorMsg, true);
    }
    renderScenes();
    if(lightboxState.open && lightboxState.sceneId === sceneId) renderLightbox();
  }

  // Gọi tuần tự (không song song) vì đây là model văn bản dùng chung hạn mức free-tier riêng — nghỉ giữa các lượt để tránh lỗi vượt hạn mức.
  var PROMPT_GEN_DELAY_MS = 1200;
  document.getElementById('btnGenAllPrompts').addEventListener('click', async function(){
    if(!state.scenes.length){ toast('Chưa có phân đoạn nào'); return; }
    var todo = state.scenes.filter(function(s){
      var dialogue = (s.vi && s.vi.trim()) || (s.lang1 && s.lang1.trim()) || (s.promptName && s.promptName.trim());
      return dialogue && !(s.setting && s.setting.trim());
    });
    if(!todo.length){
      toast('Không có phân cảnh nào cần AI viết prompt (mỗi phân cảnh đã có sẵn Mô tả bối cảnh, hoặc chưa nhập Tiếng Việt/Ngôn ngữ 1/Tên Prompt để AI dựa vào)');
      return;
    }
    var btnEl = this;
    btnEl.disabled = true;
    var originalLabel = btnEl.textContent;
    var total = todo.length, done = 0, failed = 0;
    for(var i = 0; i < todo.length; i++){
      btnEl.textContent = '🧠 Đang tạo prompt… (' + (done + 1) + '/' + total + ')';
      try {
        await generateScenePrompt(todo[i].id, { silent: true });
      } catch(err){
        failed++;
      }
      done++;
      if(i < todo.length - 1){ await new Promise(function(r){ setTimeout(r, PROMPT_GEN_DELAY_MS); }); }
    }
    btnEl.disabled = false;
    btnEl.textContent = originalLabel;
    scheduleHistoryPush();
    if(failed > 0){ toast('Đã tạo xong, còn ' + failed + '/' + total + ' phân cảnh bị lỗi (xem chi tiết ở thông báo lỗi phía trên) — có thể bấm "🧠 AI viết prompt" lại ở từng dòng đó', true); }
    else { toast('Đã dùng AI viết xong Mô tả bối cảnh cho ' + total + ' phân cảnh'); }
  });

  var BULK_GEN_CONCURRENCY = 4; // số ảnh tạo song song cùng lúc khi bấm "Tạo ảnh hàng loạt" với Gemini — tăng lên nếu API key có hạn mức cao, giảm xuống nếu bị lỗi quá tải/rate limit
  document.getElementById('btnGenAll').addEventListener('click', async function(){
    if(!state.scenes.length){ toast('Chưa có phân đoạn nào'); return; }
    var usePollinations = state.imageProvider === 'pollinations';
    var btnEl = this;
    var ids = state.scenes.map(function(s){ return s.id; });
    var total = ids.length, doneCount = 0, nextIdx = 0;
    // Pollinations miễn phí có giới hạn lượt/giây khá thấp — chạy tuần tự (1 luồng) kèm chờ giữa các lượt để không bị chặn (429),
    // Gemini trả phí có hạn mức cao hơn nên chạy song song nhiều luồng cho nhanh.
    var pollinationsDelayMs = getPollinationsToken() ? 5200 : 15200;
    btnEl.disabled = true;
    function updateProgress(){ btnEl.textContent = '✨ Đang tạo… (' + doneCount + '/' + total + ')'; }
    updateProgress();
    async function worker(){
      while(nextIdx < ids.length){
        var myId = ids[nextIdx++];
        await generateSceneImage(myId);
        doneCount++;
        updateProgress();
        if(usePollinations && nextIdx < ids.length){ await new Promise(function(r){ setTimeout(r, pollinationsDelayMs); }); }
      }
    }
    var workerCount = usePollinations ? 1 : Math.min(BULK_GEN_CONCURRENCY, total);
    var workers = [];
    for(var w = 0; w < workerCount; w++){ workers.push(worker()); }
    await Promise.all(workers);
    btnEl.disabled = false;
    btnEl.textContent = '✨ Tạo ảnh hàng loạt';
    toast('Đã tạo xong toàn bộ ảnh trong danh sách phân cảnh');
  });

  function downloadSceneImage(sceneId){
    var idx = state.scenes.findIndex(function(s){ return s.id === sceneId; });
    var s = state.scenes[idx];
    if(!s || !s.image) return;
    var ext = (s.image.mime.split('/')[1] || 'png').replace('jpeg','jpg');
    triggerDownload(dataUrlToBlob(s.image.dataUrl), sanitizeFileLabel(s.sceneLabel, idx + 1) + '.' + ext);
  }
  document.getElementById('btnDownloadAllScenes').addEventListener('click', downloadAllZip);
  async function downloadAllZip(){
    var items = state.scenes.map(function(s, i){ return { idx: i + 1, s: s }; }).filter(function(o){ return o.s.image; });
    if(!items.length){ toast('Chưa có ảnh nào để tải'); return; }
    if(typeof JSZip === 'undefined'){ toast('Không tải được thư viện nén file (cần kết nối mạng)'); return; }
    var zip = new JSZip();
    var used = {};
    items.forEach(function(o){
      var ext = (o.s.image.mime.split('/')[1] || 'png').replace('jpeg','jpg');
      var base = sanitizeFileLabel(o.s.sceneLabel, o.idx);
      var name = base, n = 2;
      while(used[name + '.' + ext]){ name = base + '_' + n; n++; }
      used[name + '.' + ext] = true;
      zip.file(name + '.' + ext, o.s.image.dataUrl.split(',')[1], { base64: true });
    });
    var blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, slugify(state.projectName) + '-anh.zip');
    toast('Đã tải file zip gồm ' + items.length + ' ảnh');
  }

  // ---------------- lightbox ----------------
  var lightboxOverlay = document.getElementById('lightboxOverlay');
  var lightboxImg = document.getElementById('lightboxImg');
  var lightboxScript = document.getElementById('lightboxScript');
  var lightboxRefineInput = document.getElementById('lightboxRefineInput');
  var lightboxState = { open: false, sceneId: null };

  function scenesWithImage(){ return state.scenes.filter(function(s){ return s.image; }); }
  function openLightbox(sceneId){
    var s = state.scenes.find(function(x){ return x.id === sceneId; });
    if(!s || !s.image) return;
    lightboxState.open = true; lightboxState.sceneId = sceneId;
    lightboxRefineInput.value = '';
    lightboxOverlay.classList.add('open');
    renderLightbox();
  }
  function closeLightbox(){ lightboxState.open = false; lightboxOverlay.classList.remove('open'); }
  function renderLightbox(){
    var s = state.scenes.find(function(x){ return x.id === lightboxState.sceneId; });
    if(!s || !s.image){ closeLightbox(); return; }
    lightboxImg.src = s.image.dataUrl;
    lightboxScript.textContent = (s.vi && s.vi.trim()) || (s.lang1 && s.lang1.trim()) || (s.setting && s.setting.trim()) || (s.promptName && s.promptName.trim()) || '(chưa có nội dung)';
  }
  function navLightbox(dir){
    var list = scenesWithImage();
    if(list.length < 2) return;
    var i = list.findIndex(function(s){ return s.id === lightboxState.sceneId; });
    var next = list[(i + dir + list.length) % list.length];
    lightboxState.sceneId = next.id;
    lightboxRefineInput.value = '';
    renderLightbox();
  }
  document.getElementById('lightboxCloseBtn').addEventListener('click', closeLightbox);
  document.getElementById('lightboxPrevBtn').addEventListener('click', function(e){ e.stopPropagation(); navLightbox(-1); });
  document.getElementById('lightboxNextBtn').addEventListener('click', function(e){ e.stopPropagation(); navLightbox(1); });
  document.getElementById('lightboxStage').addEventListener('click', function(e){
    if(e.target.closest('.lightbox-nav-btn') || e.target.closest('.lightbox-close')) return;
    var rect = this.getBoundingClientRect();
    navLightbox((e.clientX - rect.left) < rect.width / 2 ? -1 : 1);
  });
  lightboxOverlay.addEventListener('click', function(e){ if(e.target === lightboxOverlay) closeLightbox(); });
  document.getElementById('lightboxDownloadBtn').addEventListener('click', function(){ if(lightboxState.sceneId) downloadSceneImage(lightboxState.sceneId); });
  document.getElementById('lightboxRegenBtn').addEventListener('click', function(){ if(lightboxState.sceneId) generateSceneImage(lightboxState.sceneId); });
  document.getElementById('lightboxRefineBtn').addEventListener('click', function(){
    var v = lightboxRefineInput.value.trim();
    if(!v){ toast('Nhập nội dung muốn tinh chỉnh trước'); return; }
    if(lightboxState.sceneId) generateSceneImage(lightboxState.sceneId, { editPrompt: v });
  });
  window.addEventListener('keydown', function(e){
    if(!lightboxState.open) return;
    if(e.key === 'Escape') closeLightbox();
    else if(e.key === 'ArrowLeft') navLightbox(-1);
    else if(e.key === 'ArrowRight') navLightbox(1);
  });

  // ================= shared: state render / tabs / history / save-open / zoom / apikey =================
  function renderState(){
    projectNameInput.value = state.projectName;
    projectNameInput.classList.toggle('has-value', state.projectName.trim().length > 0);
    slugPreview.textContent = slugify(state.projectName) + '.json';
    stylePromptInput.value = state.stylePrompt || '';
    storyContentInput.value = state.storyContent || '';
    document.querySelectorAll('[data-tab-store]').forEach(function(el){ el.value = state.tabs[el.getAttribute('data-tab-store')] || ""; });
    renderCharacters();
    renderScenes();
    renderVoice();
    renderGallery();
    renderImageProviderSelects();
    setActiveTab(state.activeTab, true);
  }

  function renderImageProviderSelects(){
    var a = document.getElementById('sceneProviderSelect');
    var b = document.getElementById('galleryProviderSelect');
    if(a) a.value = state.imageProvider;
    if(b) b.value = state.imageProvider;
  }
  document.querySelectorAll('.provider-select').forEach(function(sel){
    sel.addEventListener('change', function(){
      state.imageProvider = (this.value === 'pollinations' || this.value === 'cloudflare') ? this.value : 'gemini';
      renderImageProviderSelects();
      scheduleHistoryPush();
    });
  });

  var tabButtons = document.querySelectorAll('.tab-btn');
  var panels = document.querySelectorAll('.panel');
  function setActiveTab(name, silent){
    state.activeTab = name;
    tabButtons.forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-tab') === name); });
    panels.forEach(function(p){ p.classList.toggle('active', p.getAttribute('data-panel') === name); });
    if(!silent) pushHistory();
  }
  tabButtons.forEach(function(btn){ btn.addEventListener('click', function(){ setActiveTab(btn.getAttribute('data-tab')); }); });

  document.querySelectorAll('[data-tab-store]').forEach(function(el){
    el.addEventListener('input', function(){ state.tabs[el.getAttribute('data-tab-store')] = el.value; scheduleHistoryPush(); });
  });
  projectNameInput.addEventListener('input', function(){
    state.projectName = projectNameInput.value;
    projectNameInput.classList.toggle('has-value', state.projectName.trim().length > 0);
    slugPreview.textContent = slugify(state.projectName) + '.json';
    scheduleHistoryPush();
  });
  stylePromptInput.addEventListener('input', function(){
    state.stylePrompt = stylePromptInput.value;
    scheduleHistoryPush();
  });
  storyContentInput.addEventListener('input', function(){
    state.storyContent = storyContentInput.value;
    scheduleHistoryPush();
  });

  // ---- tự động lưu tạm vào trình duyệt (localStorage) — phòng trường hợp quên bấm "Lưu" trước khi đóng tab/mở bản app mới ----
  // Lưu ý: đây chỉ là lưới an toàn tạm thời trên trình duyệt này, KHÔNG thay thế việc bấm 💾 Lưu ra file .json thật để giữ lâu dài.
  var AUTOSAVE_STORAGE_KEY = 'vs_autosave_project_v1';
  var autosaveDebounce = null;
  function stateForAutosave(stripHeavyData){
    var s = JSON.parse(JSON.stringify(state));
    if(stripHeavyData){
      s.scenes.forEach(function(sc){ if(sc.image){ sc.image = null; sc.status = 'idle'; } });
      s.gallery.forEach(function(g){ if(g.image){ g.image = null; g.status = 'idle'; } });
      s.characters.forEach(function(c){ c.images = []; });
      if(s.voice) s.voice.audio = null;
    }
    return s;
  }
  function doAutosave(){
    try {
      localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify({ app: APP_NAME, savedAt: new Date().toISOString(), project: stateForAutosave(false) }));
    } catch(e){
      try {
        localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify({ app: APP_NAME, savedAt: new Date().toISOString(), project: stateForAutosave(true), lite: true }));
        if(!doAutosave._warned){
          doAutosave._warned = true;
          toast('Dự án khá nặng (nhiều ảnh) nên bản tự-lưu-tạm chỉ giữ được nội dung chữ, không giữ ảnh đã tạo — bấm 💾 Lưu thường xuyên để lưu đầy đủ ra file.', true);
        }
      } catch(e2){ /* hết dung lượng trình duyệt — bỏ qua, không chặn thao tác của người dùng */ }
    }
  }
  function scheduleAutosave(){ clearTimeout(autosaveDebounce); autosaveDebounce = setTimeout(doAutosave, 900); }

  // ---- undo / redo ----
  var history = [];
  var historyIndex = 0;
  var historyDebounce = null;
  var restoring = false;
  function snapshot(){ return JSON.parse(JSON.stringify(state)); }
  function pushHistory(){
    if(restoring) return;
    var current = snapshot();
    if(history.length && JSON.stringify(history[historyIndex]) === JSON.stringify(current)) return;
    history = history.slice(0, historyIndex + 1);
    history.push(current);
    if(history.length > 40) history.shift();
    historyIndex = history.length - 1;
    scheduleAutosave();
  }
  function scheduleHistoryPush(){ clearTimeout(historyDebounce); historyDebounce = setTimeout(pushHistory, 450); }
  function applySnapshot(snap){ restoring = true; state = JSON.parse(JSON.stringify(snap)); renderState(); restoring = false; scheduleAutosave(); }
  function undo(){
    clearTimeout(historyDebounce); pushHistory();
    if(historyIndex <= 0){ toast('Không còn thao tác để hoàn tác'); return; }
    historyIndex -= 1; applySnapshot(history[historyIndex]); toast('Đã hoàn tác');
  }
  function redo(){
    if(historyIndex >= history.length - 1){ toast('Không còn thao tác để làm lại'); return; }
    historyIndex += 1; applySnapshot(history[historyIndex]); toast('Đã làm lại');
  }
  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);

  // ---- save / open project ----
  async function saveProject(){
    var data = JSON.stringify({ app: APP_NAME, version: 3, savedAt: new Date().toISOString(), project: state }, null, 2);
    var filename = slugify(state.projectName) + '.json';
    if(window.showSaveFilePicker){
      try {
        var handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
        var writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        toast('Đã lưu ' + filename);
        return;
      } catch(err){
        if(err && err.name === 'AbortError'){ toast('Đã huỷ lưu file'); return; }
        console.warn('showSaveFilePicker failed, fallback to download', err);
      }
    }
    triggerDownload(new Blob([data], { type: 'application/json' }), filename);
    toast('Đã tải xuống ' + filename);
  }
  function openProject(){ document.getElementById('fileOpenInput').click(); }
  // Áp dữ liệu 1 project (đã parse từ JSON) vào state hiện tại — dùng chung cho cả "Mở dự án" và tự động khôi phục.
  // Luôn có giá trị mặc định cho field còn thiếu để tương thích với các file/bản lưu cũ hơn.
  function restoreProjectFromParsed(proj){
    state.projectName = proj.projectName || "";
    state.tabs = Object.assign({ voice: "", image: "" }, proj.tabs || {});
    state.characters = Array.isArray(proj.characters) ? proj.characters : [];
    state.stylePrompt = proj.stylePrompt || "";
    state.storyContent = proj.storyContent || "";
    state.scenes = Array.isArray(proj.scenes) ? proj.scenes.map(function(s, i){
      return {
        id: s.id || uid('s'),
        sceneLabel: s.sceneLabel != null ? s.sceneLabel : String(i + 1),
        lang1: s.lang1 != null ? s.lang1 : "",
        vi: s.vi != null ? s.vi : (s.script || ""),
        promptName: s.promptName != null ? s.promptName : "",
        setting: s.setting != null ? s.setting : (s.description || ""),
        characterIds: s.characterIds || [],
        image: s.image || null,
        status: s.image ? 'done' : 'idle',
        errorMsg: ""
      };
    }) : [];
    state.voice = Object.assign({ name: "Kore", audio: null, status: "idle", errorMsg: "" }, proj.voice || {});
    state.voice.status = state.voice.audio ? 'done' : 'idle';
    state.gallery = Array.isArray(proj.gallery) ? proj.gallery.map(function(g){
      return { id: g.id || uid('g'), image: g.image || null, status: g.image ? 'done' : 'idle', errorMsg: "" };
    }) : [];
    state.imageProvider = (proj.imageProvider === 'pollinations' || proj.imageProvider === 'cloudflare') ? proj.imageProvider : 'gemini';
    state.activeTab = proj.activeTab || "characters";
  }
  document.getElementById('fileOpenInput').addEventListener('change', function(e){
    var file = e.target.files && e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try {
        var parsed = JSON.parse(String(reader.result));
        var proj = parsed && parsed.project ? parsed.project : parsed;
        restoreProjectFromParsed(proj);
        renderState();
        history = [snapshot()]; historyIndex = 0;
        toast('Đã mở dự án: ' + (state.projectName || file.name));
      } catch(err){ toast('File không hợp lệ, không thể mở'); }
    };
    reader.readAsText(file);
    e.target.value = "";
  });
  document.getElementById('btnSave').addEventListener('click', saveProject);
  document.getElementById('btnOpen').addEventListener('click', openProject);

  // ---- API key modal ----
  var apiKeyOverlay = document.getElementById('apiKeyOverlay');
  var geminiKeyInput = document.getElementById('geminiKeyInput');
  var pollinationsTokenInput = document.getElementById('pollinationsTokenInput');
  var keyStatus = document.getElementById('keyStatus');
  var keyStatusText = document.getElementById('keyStatusText');
  function refreshKeyStatus(){
    var val = getApiKey();
    var has = val.length > 0;
    keyStatus.classList.toggle('set', has);
    keyStatusText.textContent = has ? 'Đang dùng API key Gemini riêng bạn nhập (ưu tiên hơn key server).' : 'Chưa nhập key riêng — đang dùng key cấu hình trên server (nếu có).';
    geminiKeyInput.value = val;
    pollinationsTokenInput.value = getPollinationsToken();
  }
  function openKeyModal(){ apiKeyOverlay.classList.add('open'); refreshKeyStatus(); geminiKeyInput.focus(); }
  function closeKeyModal(){ apiKeyOverlay.classList.remove('open'); }
  document.getElementById('btnApiKey').addEventListener('click', openKeyModal);
  document.getElementById('btnCancelKey').addEventListener('click', closeKeyModal);
  apiKeyOverlay.addEventListener('click', function(e){ if(e.target === apiKeyOverlay) closeKeyModal(); });
  document.getElementById('btnSaveKey').addEventListener('click', function(){
    try {
      localStorage.setItem(KEY_STORAGE, geminiKeyInput.value.trim());
      localStorage.setItem(POLLINATIONS_TOKEN_STORAGE, pollinationsTokenInput.value.trim());
    } catch(e){}
    refreshKeyStatus(); toast('Đã lưu'); closeKeyModal();
  });
  document.getElementById('btnClearKey').addEventListener('click', function(){
    try { localStorage.removeItem(KEY_STORAGE); localStorage.removeItem(POLLINATIONS_TOKEN_STORAGE); } catch(e){}
    refreshKeyStatus(); toast('Đã xoá key/token');
  });
  document.getElementById('togglePollinationsVisibility').addEventListener('click', function(){
    pollinationsTokenInput.type = pollinationsTokenInput.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('toggleKeyVisibility').addEventListener('click', function(){
    geminiKeyInput.type = geminiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // ---- header sticky-on-scroll ----
  var appShell = document.getElementById('appShell');
  var appHeader = document.getElementById('appHeader');
  appShell.addEventListener('scroll', function(){ appHeader.classList.toggle('is-scrolled', appShell.scrollTop > 4); }, { passive: true });

  // ---- zoom (ctrl + wheel); bubble & zoom chip excluded ----
  var zoomLevel = 1;
  var supportsZoom = 'zoom' in document.documentElement.style;
  var zoomChip = document.getElementById('zoomChip');
  var zoomLabel = document.getElementById('zoomLabel');
  function applyZoom(level){
    zoomLevel = Math.min(2, Math.max(0.5, Math.round(level * 20) / 20));
    if(supportsZoom){ appShell.style.zoom = zoomLevel; }
    else { appShell.style.transformOrigin = 'top center'; appShell.style.transform = zoomLevel === 1 ? '' : 'scale(' + zoomLevel + ')'; }
    zoomLabel.textContent = Math.round(zoomLevel * 100) + '%';
    zoomChip.classList.add('visible');
    clearTimeout(applyZoom._t);
    applyZoom._t = setTimeout(function(){ if(zoomLevel === 1) zoomChip.classList.remove('visible'); }, 1800);
  }
  window.addEventListener('wheel', function(e){
    if(!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    applyZoom(zoomLevel + (e.deltaY > 0 ? -0.05 : 0.05));
  }, { passive: false });
  document.getElementById('zoomInBtn').addEventListener('click', function(){ applyZoom(zoomLevel + 0.1); });
  document.getElementById('zoomOutBtn').addEventListener('click', function(){ applyZoom(zoomLevel - 0.1); });
  document.getElementById('zoomResetBtn').addEventListener('click', function(){ applyZoom(1); });

  // ---- keyboard shortcuts ----
  window.addEventListener('keydown', function(e){
    var ctrlOrCmd = e.ctrlKey || e.metaKey;
    if(!ctrlOrCmd) return;
    var key = e.key.toLowerCase();
    if(key === 's'){ e.preventDefault(); saveProject(); }
    else if(key === 'o'){ e.preventDefault(); openProject(); }
    else if(key === 'z' && e.shiftKey){ e.preventDefault(); redo(); }
    else if(key === 'z'){ e.preventDefault(); undo(); }
    else if(key === 'y'){ e.preventDefault(); redo(); }
  });

  document.getElementById('helpBubble').addEventListener('click', function(){
    toast('Verdant Studio · Ctrl+S lưu, Ctrl+O mở, Ctrl+Z hoàn tác, Ctrl+cuộn chuột để zoom');
  });

  // ================= TAB "TẠO ẢNH" — thư viện ảnh tự do (không gắn nhân vật/phân cảnh) =================
  function pad2(n){ return n < 10 ? "0" + n : "" + n; }
  var imgGrid = document.getElementById('imgGrid');
  function newGalleryItem(){ return { id: uid('g'), image: null, status: 'idle', errorMsg: '' }; }

  function renderGallery(){
    if(!state.gallery.length){
      imgGrid.innerHTML = '<div class="hint-note">Chưa có ảnh nào. Nhập mô tả ở trên rồi bấm "✨ Tạo ảnh".</div>';
      return;
    }
    imgGrid.innerHTML = state.gallery.map(function(g, idx){
      var inner;
      if(g.status === 'loading'){ inner = '<div class="spinner"></div>'; }
      else if(g.image){ inner = '<img src="'+g.image.dataUrl+'" data-action="gview" data-g="'+g.id+'" alt="Ảnh '+(idx+1)+'">'; }
      else if(g.status === 'error'){ inner = '<div class="err-hint" title="'+escapeHtml(g.errorMsg||'')+'">Lỗi tạo ảnh<br>(rê chuột xem chi tiết)</div>'; }
      else { inner = '<div class="empty-hint">Chưa có ảnh</div>'; }
      return '<div class="img-card" data-g="'+g.id+'">' + inner +
        '<span class="example-tag">ẢNH ' + pad2(idx + 1) + '</span>' +
        '<button class="row-del-btn gallery-del-btn" data-action="gdel" data-g="'+g.id+'" title="Xoá ảnh này">✕</button>' +
        (g.image ? ('<div class="img-actions">' +
          '<button data-action="gview" data-g="'+g.id+'" title="Xem full">⤢</button>' +
          '<button data-action="gregen" data-g="'+g.id+'" title="Tạo lại">↻</button>' +
          '<button data-action="gdownload" data-g="'+g.id+'" title="Tải xuống">⬇</button>' +
        '</div>') : '') +
      '</div>';
    }).join('');
  }

  async function generateGalleryImage(gId, opts){
    opts = opts || {};
    var g = state.gallery.find(function(x){ return x.id === gId; });
    if(!g) return;
    var promptText = (state.tabs.image || '').trim();
    if(!promptText && !opts.editPrompt){ toast('Hãy nhập mô tả hình ảnh muốn tạo trước'); return; }
    var galleryProvider = state.imageProvider;
    g.status = 'loading'; renderGallery();
    if(galleryLightboxState.open && galleryLightboxState.id === gId) renderGalleryLightbox();
    try {
      var result;
      if(galleryProvider === 'pollinations' || galleryProvider === 'cloudflare'){
        var textPrompt2 = 'Minh hoạ chất lượng cao, không chữ, không watermark, không chú thích. ' + promptText + (opts.editPrompt ? ('. Yêu cầu chỉnh sửa thêm: ' + opts.editPrompt) : '');
        result = galleryProvider === 'cloudflare' ? await callCloudflareImage(textPrompt2) : await callPollinationsImage(textPrompt2);
      } else {
        var instruction = 'Vẽ một hình minh hoạ chất lượng cao theo mô tả sau. CHỈ vẽ hình ảnh, tuyệt đối không thêm chữ, watermark hay chú thích nào trong ảnh.';
        var parts = [{ text: instruction + '\n\n' + promptText }];
        if(opts.editPrompt && g.image){
          parts.push({ text: 'Chỉnh sửa ảnh vừa tạo theo yêu cầu sau, giữ nguyên bố cục trừ khi được yêu cầu đổi khác: ' + opts.editPrompt });
          parts.push({ inline_data: dataUrlToInline(g.image.dataUrl) });
        }
        result = await callGemini(parts);
      }
      g.image = result; g.status = 'done'; g.errorMsg = '';
    } catch(err){
      console.error(err);
      g.status = 'error'; g.errorMsg = (err && err.message) || 'Lỗi không xác định';
      toast('Lỗi tạo ảnh: ' + g.errorMsg, true);
    }
    renderGallery();
    if(galleryLightboxState.open && galleryLightboxState.id === gId) renderGalleryLightbox();
    scheduleHistoryPush();
  }

  function downloadGalleryImage(gId){
    var idx = state.gallery.findIndex(function(g){ return g.id === gId; });
    var g = state.gallery[idx];
    if(!g || !g.image) return;
    var ext = (g.image.mime.split('/')[1] || 'png').replace('jpeg','jpg');
    triggerDownload(dataUrlToBlob(g.image.dataUrl), 'anh-' + sanitizeFileLabel(String(idx + 1), idx + 1) + '.' + ext);
  }

  document.getElementById('btnGenGalleryImage').addEventListener('click', function(){
    var promptText = (state.tabs.image || '').trim();
    if(!promptText){ toast('Hãy nhập mô tả hình ảnh muốn tạo trước'); return; }
    var item = newGalleryItem();
    state.gallery.push(item);
    renderGallery(); scheduleHistoryPush();
    generateGalleryImage(item.id);
  });

  imgGrid.addEventListener('click', function(e){
    var btn = e.target.closest('[data-action]');
    if(!btn) return;
    var action = btn.getAttribute('data-action');
    var gId = btn.getAttribute('data-g');
    if(action === 'gdel'){
      if(!confirm('Xoá ảnh này?')) return;
      state.gallery = state.gallery.filter(function(g){ return g.id !== gId; });
      renderGallery(); scheduleHistoryPush();
    } else if(action === 'gregen'){
      generateGalleryImage(gId);
    } else if(action === 'gview'){
      openGalleryLightbox(gId);
    } else if(action === 'gdownload'){
      downloadGalleryImage(gId);
    }
  });

  document.getElementById('btnDownloadAll').addEventListener('click', downloadGalleryZip);
  async function downloadGalleryZip(){
    var items = state.gallery.map(function(g, i){ return { idx: i + 1, g: g }; }).filter(function(o){ return o.g.image; });
    if(!items.length){ toast('Chưa có ảnh nào để tải'); return; }
    if(typeof JSZip === 'undefined'){ toast('Không tải được thư viện nén file (cần kết nối mạng)'); return; }
    var zip = new JSZip();
    items.forEach(function(o){
      var ext = (o.g.image.mime.split('/')[1] || 'png').replace('jpeg','jpg');
      var name = 'anh-' + sanitizeFileLabel(String(o.idx), o.idx);
      zip.file(name + '.' + ext, o.g.image.dataUrl.split(',')[1], { base64: true });
    });
    var blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, slugify(state.projectName) + '-anh-tu-do.zip');
    toast('Đã tải file zip gồm ' + items.length + ' ảnh');
  }

  // ---- gallery lightbox (xem full / tinh chỉnh / tạo lại cho tab Tạo ảnh) ----
  var galleryLightboxOverlay = document.getElementById('galleryLightboxOverlay');
  var galleryLightboxImg = document.getElementById('galleryLightboxImg');
  var galleryLightboxRefineInput = document.getElementById('galleryLightboxRefineInput');
  var galleryLightboxState = { open: false, id: null };

  function galleryItemsWithImage(){ return state.gallery.filter(function(g){ return g.image; }); }
  function openGalleryLightbox(gId){
    var g = state.gallery.find(function(x){ return x.id === gId; });
    if(!g || !g.image) return;
    galleryLightboxState.open = true; galleryLightboxState.id = gId;
    galleryLightboxRefineInput.value = '';
    galleryLightboxOverlay.classList.add('open');
    renderGalleryLightbox();
  }
  function closeGalleryLightbox(){ galleryLightboxState.open = false; galleryLightboxOverlay.classList.remove('open'); }
  function renderGalleryLightbox(){
    var g = state.gallery.find(function(x){ return x.id === galleryLightboxState.id; });
    if(!g || !g.image){ closeGalleryLightbox(); return; }
    galleryLightboxImg.src = g.image.dataUrl;
  }
  function navGalleryLightbox(dir){
    var list = galleryItemsWithImage();
    if(list.length < 2) return;
    var i = list.findIndex(function(g){ return g.id === galleryLightboxState.id; });
    var next = list[(i + dir + list.length) % list.length];
    galleryLightboxState.id = next.id;
    galleryLightboxRefineInput.value = '';
    renderGalleryLightbox();
  }
  document.getElementById('galleryLightboxCloseBtn').addEventListener('click', closeGalleryLightbox);
  document.getElementById('galleryLightboxPrevBtn').addEventListener('click', function(e){ e.stopPropagation(); navGalleryLightbox(-1); });
  document.getElementById('galleryLightboxNextBtn').addEventListener('click', function(e){ e.stopPropagation(); navGalleryLightbox(1); });
  document.getElementById('galleryLightboxStage').addEventListener('click', function(e){
    if(e.target.closest('.lightbox-nav-btn') || e.target.closest('.lightbox-close')) return;
    var rect = this.getBoundingClientRect();
    navGalleryLightbox((e.clientX - rect.left) < rect.width / 2 ? -1 : 1);
  });
  galleryLightboxOverlay.addEventListener('click', function(e){ if(e.target === galleryLightboxOverlay) closeGalleryLightbox(); });
  document.getElementById('galleryLightboxDownloadBtn').addEventListener('click', function(){ if(galleryLightboxState.id) downloadGalleryImage(galleryLightboxState.id); });
  document.getElementById('galleryLightboxRegenBtn').addEventListener('click', function(){ if(galleryLightboxState.id) generateGalleryImage(galleryLightboxState.id); });
  document.getElementById('galleryLightboxRefineBtn').addEventListener('click', function(){
    var v = galleryLightboxRefineInput.value.trim();
    if(!v){ toast('Nhập nội dung muốn tinh chỉnh trước'); return; }
    if(galleryLightboxState.id) generateGalleryImage(galleryLightboxState.id, { editPrompt: v });
  });
  window.addEventListener('keydown', function(e){
    if(!galleryLightboxState.open) return;
    if(e.key === 'Escape') closeGalleryLightbox();
    else if(e.key === 'ArrowLeft') navGalleryLightbox(-1);
    else if(e.key === 'ArrowRight') navGalleryLightbox(1);
  });

  // ---------------- boot ----------------
  // Tự động khôi phục phiên làm việc gần nhất từ bộ nhớ trình duyệt (nếu có) — để mở lại app (kể cả bản mới hơn được thay vào
  // đúng chỗ file cũ) không bị mất trắng nội dung đang làm dở, dù trước đó chưa kịp bấm "Lưu" ra file.
  (function tryRestoreAutosave(){
    try {
      var raw = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
      if(!raw) return;
      var parsed = JSON.parse(raw);
      var proj = parsed && parsed.project;
      if(!proj) return;
      var hasContent = (proj.projectName && proj.projectName.trim()) ||
        (Array.isArray(proj.characters) && proj.characters.length) ||
        (Array.isArray(proj.scenes) && proj.scenes.length) ||
        (proj.tabs && (proj.tabs.voice || proj.tabs.image));
      if(!hasContent) return;
      restoreProjectFromParsed(proj);
      toast('Đã tự động khôi phục phiên làm việc trước đó' + (parsed.lite ? ' (không kèm ảnh do dự án trước quá nặng)' : '') + ' — bấm "↶ Hoàn tác" nếu muốn quay về trắng, hoặc 📂 Mở để nạp file khác');
    } catch(e){ console.warn('Không khôi phục được bản tự-lưu-tạm', e); }
  })();
  renderState();
  history = [snapshot()];
  historyIndex = 0;
})();
