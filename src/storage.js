import { Filesystem, Directory } from '@capacitor/filesystem';

const KEY = 'guias_cbro_lotes';
const FOTOS_DIR = 'guias_fotos';

export function carregarLotes() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function salvarLotes(lotes) {
  localStorage.setItem(KEY, JSON.stringify(lotes));
}

export function novoLote(nome, tipo, convenio = '', carteirinha = '') {
  const lote = {
    id: Date.now().toString(),
    nome,
    tipo,
    convenio: convenio || '',
    carteirinha: carteirinha || '',
    fotos: [],
    criadoEm: new Date().toISOString()
  };
  const lotes = carregarLotes();
  lotes.unshift(lote);
  salvarLotes(lotes);
  return lote;
}

export function atualizarLote(id, dados) {
  const lotes = carregarLotes();
  const idx = lotes.findIndex(l => l.id === id);
  if (idx >= 0) { lotes[idx] = { ...lotes[idx], ...dados }; salvarLotes(lotes); }
}

export async function removerLote(id) {
  const lotes = carregarLotes();
  const lote = lotes.find(l => l.id === id);
  if (lote) await Promise.all((lote.fotos || []).map(removerArquivoFoto));
  salvarLotes(lotes.filter(l => l.id !== id));
}

export function obterLote(id) {
  return carregarLotes().find(l => l.id === id) || null;
}

let pastaFotosPronta = null;

async function garantirPastaFotos() {
  if (!pastaFotosPronta) {
    pastaFotosPronta = Filesystem.mkdir({ path: FOTOS_DIR, directory: Directory.Data, recursive: true })
      .catch(() => {}); // já existe — ok
  }
  await pastaFotosPronta;
}

/**
 * Copia a imagem escaneada (URI nativa retornada pelo plugin de scanner) para o
 * armazenamento próprio do app. Apenas o caminho relativo (string pequena) é
 * guardado no localStorage — nunca o conteúdo da imagem em si.
 */
export async function salvarFotoArquivo(loteId, uriOrigem, sufixo) {
  await garantirPastaFotos();
  const path = `${FOTOS_DIR}/${loteId}_${sufixo}.jpg`;
  await Filesystem.copy({ from: uriOrigem, to: path, toDirectory: Directory.Data });
  return path;
}

/**
 * Salva páginas com concorrência limitada. Duas cópias por vez reduzem a espera
 * sem criar o pico de memória/I/O que ocorreria ao copiar até 10 fotos juntas.
 * Mantém a ordem original e devolve o resultado individual de cada página.
 */
export async function salvarFotosEmLote(loteId, uris, prefixo = 'pagina', onProgress) {
  const entradas = Array.isArray(uris) ? uris : [];
  if (!entradas.length) return [];

  const resultados = new Array(entradas.length);
  const totalWorkers = Math.min(2, entradas.length);
  let proximo = 0;
  let concluidas = 0;

  const worker = async () => {
    while (proximo < entradas.length) {
      const idx = proximo++;
      try {
        const path = await salvarFotoArquivo(loteId, entradas[idx], `${prefixo}_${idx}`);
        resultados[idx] = { ok: true, path };
      } catch (error) {
        resultados[idx] = { ok: false, error };
      } finally {
        concluidas += 1;
        onProgress?.(concluidas, entradas.length);
      }
    }
  };

  await Promise.all(Array.from({ length: totalWorkers }, () => worker()));
  return resultados;
}

export async function removerArquivoFoto(path) {
  if (!path) return;
  try {
    await Filesystem.deleteFile({ path, directory: Directory.Data });
  } catch {
    // arquivo já pode não existir; nada a fazer
  }
}

export async function caminhoParaUri(path) {
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
  return uri;
}

export function blobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
