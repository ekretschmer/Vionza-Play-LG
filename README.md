# Vionza Play — LG webOS (v0.1)

App web empacotado como `.ipk` para TVs LG (webOS 5 ou mais novo). Usa o mesmo servidor de licença e de vinculação (ID + chave / QR) do app Android.

## 1. Configurar (3 valores)
Edite `vionza.config.json`:
- `LICENSE_URL` = `https://vionza-server-1.onrender.com`
- `PAIR_URL`    = `https://vionza-server-1.onrender.com`
- `LICENSE_PUBLIC_KEY` = a sua chave **PÚBLICA** (do `gen-keys`). Nunca a privada.
Vazia = licença DESLIGADA (qualquer um usa de graça). Não publique assim.

## 2. Gerar o .ipk
**Pelo GitHub (sem instalar nada):** suba a pasta num repositório, em *Settings → Secrets → Actions* crie `LICENSE_PUBLIC_KEY`, depois *Actions → Gerar .ipk → Run workflow*. Baixe o `.ipk` em *Artifacts*.
**No seu PC (Node 20+):** `npm install` e `npm run package` → `dist/*.ipk`.

## 3. Instalar na TV (teste)
1. Na TV: loja LG → instale **Developer Mode**, entre com sua conta LG, ligue *Dev Mode Status* e *Key Server*; a TV reinicia.
2. No PC: `npm i -g @webos-tools/cli`, depois `ares-setup-device` (adicione a TV com o IP mostrado no app Developer Mode, usuário `prisoner`, e use `ares-novacom --device tv --getkey` com a passphrase do app).
3. `ares-install --device tv dist/com.vionza.play.lg_*.ipk` e `ares-launch --device tv com.vionza.play.lg`.
O modo desenvolvedor expira (~50 h) e precisa ser renovado no app Developer Mode.

## 4. Publicar na LG Content Store
Pelo **LG Seller Lounge** (cadastro, envio do .ipk, teste da LG). As regras da LG sobre apps IPTV e pagamento/ativação fora da loja **não foram verificadas** — confirme antes de investir.

## Teclas do controle
OK abrir · Voltar (retorna uma etapa; no início sai) · Amarelo favoritar · CH+/CH− trocar canal · ▶/⏸ · ⏩/⏪ ±15 s.

## Testes
`npm test` (núcleo, 11) e a simulação de tela com Playwright em `test/ui` (fluxo completo no navegador, servidor de vinculação real).

## O que NÃO foi testado
Em TV LG real: CORS/`file://`, `crypto.subtle`, LGUDID (Luna), reprodução HLS/TS nativa, hls.js/mpegts.js, QR, `ares-package`. Só foi testado em navegador simulado.

## Limitações da v0.1
Um perfil só (sem perfil infantil), sem EPG, sem "jogos do dia", sem Cast, busca só na pasta atual, favoritos/progresso em localStorage.
