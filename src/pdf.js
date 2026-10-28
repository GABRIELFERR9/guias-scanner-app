import { jsPDF } from 'jspdf';
import { Filesystem, Directory } from '@capacitor/filesystem';

async function pathParaDataUrl(path) {
  const { data } = await Filesystem.readFile({ path, directory: Directory.Data });
  return `data:image/jpeg;base64,${data}`;
}

// Aresta máxima da imagem no PDF. As fotos do scanner são grandes (~3–4k px);
// 2200px mantém a guia legível para o convênio e segura o tamanho do arquivo.
const MAX_LADO = 2200;

/**
 * Redesenha a foto num canvas para (a) "assar" a orientação EXIF da câmera —
 * o jsPDF ignora o EXIF e por isso a guia deitada (paisagem) saía em pé/girada
 * no PDF — e (b) reduzir a resolução. Retorna um JPEG já orientado + as
 * dimensões reais (orientadas), usadas para escolher a orientação da página.
 */
function normalizarImagem(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Em WebView moderno (Capacitor 8) o navegador já aplica o EXIF ao
      // desenhar no canvas, então naturalWidth/Height e o drawImage saem
      // corretamente orientados.
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;

      const escala = Math.min(1, MAX_LADO / Math.max(w, h));
      w = Math.round(w * escala);
      h = Math.round(h * escala);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      const canvasUrl = canvas.toDataURL('image/jpeg', 0.9);
      // libera memória
      canvas.width = canvas.height = 0;
      img.src = '';
      resolve({ canvasUrl, w, h });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export async function gerarPDF(fotos) {
  // Normaliza todas as imagens antes de montar o PDF (corrige EXIF e mede a
  // orientação real de cada página).
  const imagens = [];
  for (const foto of fotos) {
    imagens.push(await normalizarImagem(await pathParaDataUrl(foto)));
  }

  // Cada página do PDF assume a orientação da própria imagem: guia deitada →
  // página paisagem (horizontal); folha de exames em pé → página retrato.
  const dimsPagina = (im) =>
    im.w >= im.h
      ? { pw: 297, ph: 210, orient: 'landscape' }
      : { pw: 210, ph: 297, orient: 'portrait' };

  const d0 = imagens.length ? dimsPagina(imagens[0]) : { orient: 'portrait' };
  const pdf = new jsPDF({ orientation: d0.orient, unit: 'mm', format: 'a4' });

  for (let i = 0; i < imagens.length; i++) {
    const im = imagens[i];
    const d = dimsPagina(im);
    if (i > 0) pdf.addPage('a4', d.orient);

    const ratio = Math.min(d.pw / im.w, d.ph / im.h);
    const w = im.w * ratio;
    const h = im.h * ratio;
    const x = (d.pw - w) / 2;
    const y = (d.ph - h) / 2;
    pdf.addImage(im.canvasUrl, 'JPEG', x, y, w, h);
  }

  return pdf.output('blob');
}
