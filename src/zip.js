import JSZip from 'jszip';
import { gerarPDF } from './pdf';

export async function gerarZIP(lotes, onProgress) {
  const zip = new JSZip();
  const validos = lotes.filter(lote => lote.fotos?.length > 0);
  const arquivos = new Array(validos.length);
  let proximo = 0;
  let concluidos = 0;

  // Dois PDFs por vez: acelera leitura/processamento sem estourar a memória do celular.
  const worker = async () => {
    while (proximo < validos.length) {
      const idx = proximo++;
      const lote = validos[idx];
      const blob = await gerarPDF(lote.fotos);
      const nomeLimpo = (lote.nome || 'PACIENTE_SEM_NOME').replace(/[^a-zA-Z0-9À-ÿ\s]/g, '').trim().replace(/\s+/g, '_');
      const nomeArquivo = `${nomeLimpo}_${lote.tipo || 'GUIA'}.pdf`;
      // Cada paciente ganha sua própria subpasta dentro do arquivo ZIP para facilitar a organização no PC
      const caminhoNoZip = `${nomeLimpo}/${nomeArquivo}`;
      arquivos[idx] = { caminho: caminhoNoZip, blob };
      concluidos += 1;
      onProgress?.(concluidos, validos.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(2, validos.length) }, () => worker()));
  arquivos.forEach(arquivo => {
    if (arquivo) zip.file(arquivo.caminho, arquivo.blob);
  });

  // PDFs já contêm imagens JPEG comprimidas; recomprimir tudo com DEFLATE só
  // consome CPU. STORE empacota os arquivos imediatamente e preserva os PDFs.
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}
