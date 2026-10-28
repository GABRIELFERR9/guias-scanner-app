# guias-scanner-app

App Android (React + Capacitor) que digitaliza guias médicas, organiza em lotes e gera PDF/ZIP para faturamento.

App Android feito para a recepção de uma clínica digitalizar as guias de atendimento do convênio, sem scanner de mesa.

## O que faz
- Digitaliza as guias pela câmera, com detecção de bordas e correção de perspectiva (ML Kit Document Scanner).
- Organiza as guias em **lotes**, que ficam salvos no aparelho.
- Gera **PDF** (jsPDF) ou **ZIP** do lote e compartilha pelo menu nativo do Android.
- Envia o lote para o sistema da clínica por uma API protegida por chave.

## Stack
React 19, Vite, Capacitor (Android), `@capacitor-mlkit/document-scanner`, jsPDF, JSZip e perspective-transform.

## Rodar
```bash
npm install
cp .env.example .env      # VITE_GUIAS_API_KEY e VITE_GRUPO_JID
npm run dev               # navegador
npx cap sync android && npx cap open android   # app
```

---
Feito por [Gabriel Ferreira](https://github.com/GABRIELFERR9).
