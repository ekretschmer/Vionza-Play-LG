import json, sys, time, urllib.request
from playwright.sync_api import sync_playwright
cfg = json.loads(sys.argv[1]); OUT = sys.argv[2]
BASE = f"http://127.0.0.1:{cfg['web']}/"; API = f"http://127.0.0.1:{cfg['api']}"
def post(path, body, headers=None):
    r = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers={'content-type': 'application/json', **(headers or {})})
    try: return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: return {'status': e.code, **json.loads(e.read() or b'{}')}
errs = []; log = []
def ok(c, m): log.append(('OK  ' if c else 'FAIL') + ' ' + m)
def run(p):
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1920, 'height': 1080}); pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'vendor/' not in m.text and '404' not in m.text else None)
    key = lambda k, n=1: [pg.keyboard.press(k) or pg.wait_for_timeout(120) for _ in range(n)]
    txt = lambda sel: pg.inner_text(sel)
    try:
     pass
    except Exception: pass
    # 1) licença: sem licença -> teste automático
    pg.goto(BASE); pg.wait_for_timeout(1500)
    # trial iniciado sozinho -> segue para vincular (sem lista)
    ok(pg.locator('#pair.on').count() == 1, 'trial automático e tela de vincular')
    lic = json.loads(urllib.request.urlopen(API + '/__state').read())['last']
    ok(lic['platform'] == 'webos' and lic['model'].startswith('LG') and len(lic['secret']) == 64 and lic['installId'].count('-') == 2, 'licença envia platform/model/ID: %s %s' % (lic['model'], lic['installId']))
    pg.wait_for_selector('#pair .bigid:not(:text("…"))', timeout=15000); pg.wait_for_timeout(500)
    pg.screenshot(path=OUT + '/lg_pair.png')
    idtxt = pg.locator('#pair .bigid').nth(0).inner_text().replace('-', ''); pin = pg.locator('#pair .bigid').nth(1).inner_text().replace(' ', '')
    ok(len(idtxt) == 12 and len(pin) == 6, 'ID %s e chave %s' % (idtxt, pin))
    # 2) enviar a lista como a página /enviar faria (cifrando no "celular")
    import subprocess
    sender = subprocess.run(['node', '--input-type=module', '-e', f'''
      const subtle=globalThis.crypto.subtle,enc=new TextEncoder();const b64u=(b)=>Buffer.from(b).toString("base64url");
      const H={{"content-type":"application/json"}};const api="{API}";
      const lk=await (await fetch(api+"/api/v1/sender/lookup",{{method:"POST",headers:H,body:JSON.stringify({{id:"{idtxt}",pin:"{pin}"}})}})).json();
      if(!lk.pub){{console.log("LOOKUP",JSON.stringify(lk));process.exit(0)}}
      const tv=await subtle.importKey("raw",Buffer.from(lk.pub,"base64url"),{{name:"ECDH",namedCurve:"P-256"}},false,[]);
      const eph=await subtle.generateKey({{name:"ECDH",namedCurve:"P-256"}},true,["deriveBits"]);
      const bits=await subtle.deriveBits({{name:"ECDH",public:tv}},eph.privateKey,256);
      const hk=await subtle.importKey("raw",bits,"HKDF",false,["deriveKey"]);
      const aes=await subtle.deriveKey({{name:"HKDF",hash:"SHA-256",salt:enc.encode("{idtxt}"),info:enc.encode("vionza-ecdh-v1")}},hk,{{name:"AES-GCM",length:256}},false,["encrypt"]);
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const ct=await subtle.encrypt({{name:"AES-GCM",iv,additionalData:enc.encode("{idtxt}")}},aes,enc.encode(JSON.stringify({{v:1,type:"xtream",name:"Minha lista",url:"{API}",user:"joao",pass:"segredo"}})));
      const r=await fetch(api+"/api/v1/sender/submit",{{method:"POST",headers:H,body:JSON.stringify({{id:"{idtxt}",pin:"{pin}",epk:b64u(await subtle.exportKey("raw",eph.publicKey)),ct:b64u(ct),iv:b64u(iv)}})}});
      console.log(JSON.stringify(await r.json()));'''], capture_output=True, text=True)
    ok('"ok":true' in sender.stdout, 'envio cifrado aceito: ' + (sender.stdout.strip() or sender.stderr.strip())[:120])
    try: pg.wait_for_selector('#home.on .tabs', timeout=15000)
    except Exception:
        pg.screenshot(path=OUT + '/lg_fail.png'); log.append('pair msg: ' + pg.inner_text('#pair .msg')); raise
    pg.wait_for_timeout(800)
    ok(pg.locator('#home.on').count() == 1, 'lista recebida -> início')
    # 3) início: Ao vivo abre em "Destaques do Dia"; adulto escondido
    cats = pg.locator('#cats .cat .t').all_inner_texts(); ok('Adultos XXX' not in cats, 'pasta adulta escondida: %s' % cats)
    ok(pg.locator('#cats .cat.on .t').inner_text() == 'Destaques do Dia', 'abre em Destaques do Dia')
    pg.screenshot(path=OUT + '/lg_live.png')
    # 4) navegação: Filmes, A–Z, grade com carga em blocos
    pg.locator('.tab[data-tab=movie]').click(); pg.wait_for_selector('#grid .card'); pg.wait_for_timeout(500)
    ok(pg.locator('#grid .card').count() == 48, 'primeira página com 48 cards')
    ok(pg.locator('#grid .card .nm').first.inner_text().startswith('Filme 001'), 'ordem A–Z natural')
    pg.screenshot(path=OUT + '/lg_movies.png')
    # foco: setas descem até o fim e carregam mais
    pg.mouse.move(5, 5); pg.evaluate("VZ.nav.focus(document.querySelector('#grid .card'))")
    for _ in range(11): key('ArrowDown')
    ok(pg.locator('#grid .card').count() > 48, 'chegou no fim da grade e carregou mais (%d)' % pg.locator('#grid .card').count())
    # favoritar com amarelo (405)
    pg.keyboard.press('Control+Shift+Y') if False else None
    pg.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{keyCode:405,bubbles:true}))"); pg.wait_for_timeout(300)
    ok(pg.locator('#grid .card .star').count() == 1, 'favoritado com o botão amarelo')
    # 5) abrir filme -> player nativo (webm)
    pg.locator('#grid .card').first.click(); pg.wait_for_timeout(2500)
    ok(pg.evaluate("document.body.classList.contains('playing')"), 'tela de player aberta')
    t0 = pg.evaluate("document.getElementById('video').currentTime"); pg.wait_for_timeout(1500); t1 = pg.evaluate("document.getElementById('video').currentTime")
    ok(t1 > t0, 'vídeo tocando (%.1fs -> %.1fs)' % (t0, t1))
    key('ArrowRight'); pg.wait_for_timeout(500); t2 = pg.evaluate("document.getElementById('video').currentTime"); ok(t2 > t1 + 10, 'seta direita avança 15 s (%.1f)' % t2)
    pg.screenshot(path=OUT + '/lg_player.png')
    key('Enter'); pg.wait_for_timeout(300); ok(pg.evaluate("document.getElementById('video').paused"), 'OK pausa')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    ok(not pg.evaluate("document.body.classList.contains('playing')") and pg.locator('#home.on').count() == 1, 'Voltar sai do player para o início')
    # 6) séries
    pg.locator('.tab[data-tab=series]').click(); pg.wait_for_selector('#grid .card'); pg.locator('#grid .card').first.click(); pg.wait_for_selector('#series.on .ep', timeout=8000); pg.wait_for_timeout(400)
    ok(pg.locator('#series .ep').count() == 2 and pg.locator('#series .seasons .cat').count() == 2, 'série: 2 temporadas, 2 episódios')
    pg.screenshot(path=OUT + '/lg_series.png')
    pg.locator('#series .ep').first.click(); pg.wait_for_timeout(2000); ok(pg.evaluate("document.body.classList.contains('playing')"), 'episódio toca')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500); ok(pg.locator('#series.on').count() == 1, 'Voltar do episódio -> série')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500); ok(pg.locator('#home.on').count() == 1, 'Voltar da série -> início')
    # 7) continuar + favoritos
    pg.locator('.tab[data-tab=fav]').click(); pg.wait_for_timeout(600); ok(pg.locator('#grid .card').count() >= 1, 'aba Favoritos lista o favorito')
    pg.locator('.tab[data-tab=cont]').click(); pg.wait_for_timeout(600)
    # 8) ajustes + adulto com senha
    pg.locator('.tab[data-tab=set]').click(); pg.wait_for_selector('#settings.on .srow'); pg.wait_for_timeout(400); pg.screenshot(path=OUT + '/lg_settings.png')
    ok('Minha lista' in pg.inner_text('#settings'), 'ajustes mostra a lista')
    # 9) licença vencida bloqueia
    urllib.request.urlopen(API + '/__state?lic=expired').read()
    pg.locator('#settings .srow:has(#sid)').first.click(); pg.wait_for_selector('#license.on', timeout=8000); pg.wait_for_timeout(400)
    pg.screenshot(path=OUT + '/lg_license.png')
    ok(pg.locator('#license.on').count() == 1 and not pg.evaluate("document.body.classList.contains('playing')"), 'licença vencida bloqueia o app e mostra a tela de licença')
    urllib.request.urlopen(API + '/__state?lic=active').read()
    b.close()

try:
    with sync_playwright() as p: run(p)
except Exception as e:
    log.append('FAIL EXCECAO ' + str(e)[:300])
print('\n'.join(log)); print('ERROS DE CONSOLE:', errs[:8])
sys.exit(1 if any(l.startswith('FAIL') for l in log) else 0)
