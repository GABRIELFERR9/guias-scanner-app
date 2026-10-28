import { useState, useEffect } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Share } from '@capacitor/share';
import {
  ArrowRight,
  Camera,
  CaretLeft,
  Check,
  CheckCircle,
  ClipboardText,
  CreditCard,
  DownloadSimple,
  FilePdf,
  FileText,
  GlobeHemisphereWest,
  House,
  Images,
  MagnifyingGlass,
  Package,
  PaperPlaneTilt,
  Plus,
  Scan,
  Scissors,
  ShareNetwork,
  Sparkle,
  Stethoscope,
  TestTube,
  Trash,
  User,
  WarningCircle,
  X,
} from '@phosphor-icons/react';

// Plugin nativo: envia o arquivo direto pro WhatsApp (pula a lista de apps).
const EnviarWhatsApp = registerPlugin('EnviarWhatsApp');
// Plugin nativo: OCR (ML Kit) para ler o nome do paciente na guia escaneada.
const LerTexto = registerPlugin('LerTexto');

// ─── Extração Inteligente de Nome (OCR) ──────────────────────────────────────
function limpaNome(s) {
  if (!s) return '';
  return String(s)
    .replace(/[:;_.,"“”()[\]/\d-]+/g, ' ')
    .replace(/[^A-Za-zÀ-ÿ\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 50);
}

// Termos e palavras de controle em formulários médicos/TISS que NUNCA são o paciente
const BLOQUEIOS_OCR = /\b(?:profiss|solicit|solcit|executan|contratad|contratant|operadora|prestador|respons[aá]vel|social|benner|c[aâ]mara|deputad|cnpj|carteira|nacional|ans|assinatura|cbo|cnes|conselho|crm|tuss|tabela|procedimento|valor|guia|sadt|dados|filia[cç][aã]o|pai|m[aã]e|emiss[aã]o|secretaria|seguran[cç]a|detran|municipio|orgao|expedidor|observa[cç][aã]o|justificativa|atendimento|hospital|cl[ií]nica|oftalmolog|associac|m[eé]dic[oa]s|ltda|eireli|juscelino|kubitschek|newton|ana tereza|julio cesar|marcos ant[oô]nio|loise|cbro|amhp|consulta|diagn[oó]stico|terapia|validade|regime|cobertura|especial|ocupacional|total|reais|unidade|solic|autoriz)\b/i;

function ehNomeValido(s) {
  if (!s) return False;
  const sClean = limpaNome(s);
  const palavras = sClean.split(' ').filter(Boolean);
  if (palavras.length < 2 || palavras.length > 6) return false;
  if (sClean.length < 6 || sClean.length > 45) return false;
  if (BLOQUEIOS_OCR.test(s)) return false;
  // Bloquear se qualquer palavra for excessivamente longa (erro de OCR)
  if (palavras.some(p => p.length > 20)) return false;
  return true;
}

function extrairNomePaciente(texto) {
  if (!texto) return { principal: '', sugestoes: [] };

  const linhas = String(texto)
    .split(/\n/)
    .map(l => l.trim())
    .filter(Boolean);

  // Padrões de rótulos oficiais de beneficiário/paciente (TISS Consulta, SADT, CNH, RG)
  const ROTULOS = [
    // 1. "Nome do Beneficiário" / "Nome do Paciente" / "10 - Nome do Beneficiário"
    /(?:10|7|\b)\s*[-\u2013.]?\s*nome\s+(?:do\s+|da\s+)?(?:benefici[aá]rio|paciente|usu[aá]rio)\b/i,
    // 2. "10 - Nome" ou "7 - Nome" (padrão numérico das guias TISS AMHP)
    /(?:10|7)\s*[-\u2013.]\s*nome\b(?!\s+(?:social|do\s+contratad|do\s+profiss|do\s+prest|da\s+operad))/i,
    // 3. "1. Nome" (CNH) ou "Nome Completo:"
    /(?:^|\b)(?:1\.?\s*nome|nome\s+completo|nome)\s*[:\-\u2013]/i,
    // 4. "Beneficiário:" ou "Paciente:"
    /\b(?:benefici[aá]rio|paciente)\s*[:\-\u2013]\s*/i
  ];

  const candidatos = [];

  // 1. Busca ancorada diretamente nos rótulos de beneficiário
  for (const rx of ROTULOS) {
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      const m = linha.match(rx);
      if (m) {
        // Texto restante na mesma linha após o rótulo
        const resto = linha.slice(m.index + m[0].length).replace(/^[:\-\u2013.]+\s*/, '').trim();
        if (ehNomeValido(resto)) {
          candidatos.push({ nome: limpaNome(resto), score: 100 });
        }
        // Próximas 1 a 3 linhas após o rótulo (onde o valor costuma estar em formulários digitais/escaneados)
        for (let j = i + 1; j <= i + 3 && j < linhas.length; j++) {
          const prox = linhas[j].trim();
          if (ehNomeValido(prox)) {
            candidatos.push({ nome: limpaNome(prox), score: 90 - (j - i) * 5 });
            break; // o primeiro nome válido logo após o rótulo tem preferência máxima
          }
        }
      }
    }
  }

  // 2. Busca secundária de candidatos (linhas avulsas que parecem nomes legítimos)
  for (const linha of linhas) {
    if (ehNomeValido(linha)) {
      candidatos.push({ nome: limpaNome(linha), score: 40 });
    }
  }

  // Deduplicar mantendo o de maior pontuação
  const sugestoes = [];
  const vistos = new Set();
  candidatos
    .sort((a, b) => b.score - a.score)
    .forEach(item => {
      if (!vistos.has(item.nome)) {
        vistos.add(item.nome);
        sugestoes.push(item.nome);
      }
    });

  return {
    principal: sugestoes.length > 0 ? sugestoes[0] : '',
    sugestoes: sugestoes.slice(0, 4) // até 4 sugestões para os chips de seleção rápida
  };
}

import { Filesystem, Directory } from '@capacitor/filesystem';
import { DocumentScanner } from '@capacitor-mlkit/document-scanner';
import {
  carregarLotes,
  novoLote,
  atualizarLote,
  removerLote,
  obterLote,
  salvarFotosEmLote,
  blobParaBase64,
} from './storage';
import './App.css';

const PAGE_LIMIT = 10;
const BACKEND_CBRO_URL = 'https://cbrosistema.duckdns.org';
const GUIAS_API_KEY = import.meta.env.VITE_GUIAS_API_KEY || '';
const GRUPO_OFICIAL_JID = import.meta.env.VITE_GRUPO_JID || '';

const CONVENIOS_POPULARES = [
  'BRADESCO SAÚDE',
  'CASSI',
  'AMIL',
  'SULAMÉRICA',
  'UNIMED',
  'GDF / INAS',
  'GEAP',
  'SAÚDE CAIXA',
  'PARTICULAR',
];

async function obterBase64Foto(uriOuPath) {
  if (!uriOuPath) return null;

  // 1. Método mais confiável no Capacitor Android: WebView bridge via convertFileSrc
  try {
    const webSrc = Capacitor.convertFileSrc ? Capacitor.convertFileSrc(uriOuPath) : uriOuPath;
    const resp = await fetch(webSrc);
    if (resp.ok) {
      const blob = await resp.blob();
      const b64 = await blobParaBase64(blob);
      if (b64 && b64.length > 50) return b64;
    }
  } catch (errWeb) {
    console.warn('Leitura via convertFileSrc falhou, tentando Filesystem:', errWeb);
  }

  // 2. Fallback: Filesystem.readFile direto
  try {
    const res = await Filesystem.readFile({ path: uriOuPath });
    if (res?.data) return res.data;
  } catch {}

  // 3. Fallback: Filesystem.readFile no diretório Data
  try {
    const res = await Filesystem.readFile({ path: uriOuPath, directory: Directory.Data });
    if (res?.data) return res.data;
  } catch {}

  return null;
}

async function analisarGuiaComIA(uriOuPath) {
  const b64 = await obterBase64Foto(uriOuPath);
  if (!b64) throw new Error('Falha ao extrair bytes da foto');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000);

  try {
    const res = await fetch(`${BACKEND_CBRO_URL}/api/whatsapp/analisar-imagem-guia`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guias-key': GUIAS_API_KEY,
      },
      body: JSON.stringify({
        base64: b64,
        mimeType: 'image/jpeg',
      }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Falha na IA médica (HTTP ${res.status})`);
    }
    return data.dados;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Tempo limite excedido ao consultar a IA (timeout 35s)');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}


// ─── Componentes UI base ─────────────────────────────────────────────────────

function Btn({ onClick, cor = 'primary', children, disabled, small, block, ariaLabel, className = '' }) {
  const variante = cor === 'teal' ? 'primary' : cor === 'amber' ? 'secondary' : cor;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={`btn btn--${variante}${small ? ' btn--small' : ''}${block ? ' btn--block' : ''} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

function Header({ titulo, onVoltar, onHome, etapa }) {
  return (
    <>
      <header className="app-header">
        <div className="header-left">
          {onVoltar && (
            <button type="button" aria-label="Voltar" onClick={onVoltar} className="header-back">
              <CaretLeft size={22} weight="bold" />
            </button>
          )}
          {!onVoltar && <div className="brand-mark" aria-hidden="true">CB</div>}
          <div className="header-copy">
            <div className="header-brand">CBRO</div>
            <div className="header-title">{titulo}</div>
          </div>
        </div>

        {onHome && (
          <button
            type="button"
            aria-label="Ir para a página inicial"
            onClick={onHome}
            className="header-home-btn"
            title="Voltar ao início"
          >
            <House size={19} weight="bold" />
            <span>Início</span>
          </button>
        )}
      </header>
      {etapa && <Etapas atual={etapa} onHome={onHome} />}
    </>
  );
}

function Etapas({ atual }) {
  const labels = ['Identificar', 'Revisar', 'Exportar'];
  return (
    <nav aria-label={`Etapa ${atual} de 3`} className="workflow">
      {labels.map((label, idx) => {
        const numero = idx + 1;
        const ativo = numero === atual;
        const concluido = numero < atual;
        return (
          <div
            key={label}
            className={`workflow-step${ativo ? ' is-active' : ''}${concluido ? ' is-complete' : ''}`}
          >
            <span className="workflow-number">{concluido ? <Check size={13} weight="bold" /> : numero}</span>
            <span>{label}</span>
          </div>
        );
      })}
    </nav>
  );
}

function Badge({ tipo }) {
  const label = tipo === 'DOCUMENTO' ? 'DOC. PACIENTE' : tipo;
  return <span className={`badge badge--${String(tipo).toLowerCase()}`}>{label}</span>;
}

// ─── Tela 1: HOME ────────────────────────────────────────────────────────────

function TelaHome({ onNovo, onNovoDocumento, onAbrir, onExportarTudo }) {
  const [lotes, setLotes] = useState([]);
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => { setLotes(carregarLotes()); }, []);

  const handleRemover = async (id) => {
    if (confirmId === id) {
      await removerLote(id);
      setLotes(carregarLotes());
      setConfirmId(null);
    } else {
      setConfirmId(id);
    }
  };

  const total = lotes.length;
  const comFotos = lotes.filter(l => l.fotos?.length > 0).length;

  return (
    <main className="app-screen">
      <Header titulo="Guias AMHP" />

      <div className="page-content home-page">
        <section className="welcome-panel">
          <div className="welcome-icon"><Scan size={28} weight="bold" /></div>
          <div>
            <h1>Scanner de Guias e Documentos</h1>
            <p>Digitalização rápida com OCR de paciente, corte e envio por WhatsApp.</p>
          </div>
        </section>

        <section className="summary-strip" aria-label="Resumo dos documentos">
          <div className="summary-item">
            <span className="summary-value">{total}</span>
            <span className="summary-label">Itens salvos</span>
          </div>
          <div className="summary-divider" aria-hidden="true" />
          <div className="summary-item">
            <span className="summary-value">{comFotos}</span>
            <span className="summary-label">Prontos para enviar</span>
          </div>
        </section>

        <section className="scan-actions" aria-label="Nova digitalização">
          <button type="button" onClick={onNovo} className="scan-choice scan-choice--primary">
            <span className="scan-choice-icon"><ClipboardText size={26} weight="duotone" /></span>
            <span className="scan-choice-copy">
              <strong>Escanear nova guia</strong>
              <small>Consulta TISS ou SADT</small>
            </span>
            <ArrowRight size={20} weight="bold" />
          </button>
          <button type="button" onClick={onNovoDocumento} className="scan-choice scan-choice--secondary">
            <span className="scan-choice-icon"><FileText size={26} weight="duotone" /></span>
            <span className="scan-choice-copy">
              <strong>Documento do paciente</strong>
              <small>Identidade, CNH ou laudo</small>
            </span>
            <ArrowRight size={20} weight="bold" />
          </button>
          {comFotos > 0 && (
            <Btn onClick={onExportarTudo} cor="secondary" block>
              <Package size={20} weight="bold" /> Exportar todos ({comFotos})
            </Btn>
          )}
        </section>

        {/* Lista */}
        {lotes.length === 0 ? (
          <section className="empty-state">
            <div className="empty-icon"><Images size={32} weight="duotone" /></div>
            <h2>Nenhum item salvo</h2>
            <p>Escolha uma opção acima para começar a digitalização.</p>
          </section>
        ) : (
          <section className="saved-section">
            <div className="section-heading">
              <h2>Guias e documentos salvos</h2>
              <span>{total} {total === 1 ? 'item' : 'itens'}</span>
            </div>
            <div className="saved-list">
              {lotes.map(l => (
                <article key={l.id} className="saved-item">
                  <div className="saved-item-main">
                    <div className="saved-copy">
                      <div className="saved-meta">
                        <Badge tipo={l.tipo} />
                        <span>{new Date(l.criadoEm).toLocaleDateString('pt-BR')}</span>
                      </div>
                      <h3>{l.nome}</h3>
                      {l.convenio && <div style={{ fontSize: '12px', color: '#175cc7', fontWeight: 600, marginTop: '2px' }}>💳 {l.convenio}</div>}
                      <div className={`saved-status${l.fotos?.length > 0 ? ' is-ready' : ' is-pending'}`}>
                        {l.fotos?.length > 0 ? <CheckCircle size={17} weight="fill" /> : <WarningCircle size={17} weight="fill" />}
                        <span>{l.fotos?.length > 0 ? `Pronto, ${l.fotos.length} página(s)` : 'Falta escanear'}</span>
                      </div>
                    </div>
                    <div className="saved-actions">
                      <button type="button" onClick={() => onAbrir(l.id)} className="review-button">
                        Revisar
                      </button>
                      <button
                        type="button"
                        aria-label={confirmId === l.id ? `Confirmar exclusão de ${l.nome}` : `Excluir ${l.nome}`}
                        onClick={() => handleRemover(l.id)}
                        className={`delete-button${confirmId === l.id ? ' is-confirming' : ''}`}
                      >
                        {confirmId === l.id ? 'Excluir?' : <Trash size={19} weight="bold" />}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

// ─── Tela 2: NOVA GUIA / DOCUMENTO ───────────────────────────────────────────

function TelaNova({ onVoltar, onHome, onCriado, modo }) {
  const documentoPaciente = modo === 'documento';
  const [nome, setNome] = useState('');
  const [convenio, setConvenio] = useState('');
  const [carteirinha, setCarteirinha] = useState('');
  const [sugestoesNome, setSugestoesNome] = useState([]);
  const [tipo, setTipo] = useState(documentoPaciente ? 'DOCUMENTO' : 'CONSULTA');

  const [fotosCapturadas, setFotosCapturadas] = useState([]);
  const [lendoNome, setLendoNome] = useState(false);
  const [criando, setCriando] = useState(false);
  const [progresso, setProgresso] = useState({ concluidas: 0, total: 0 });
  const [textoOcr, setTextoOcr] = useState('');

  // Estados de IA e Despacho Direto
  const [statusIA, setStatusIA] = useState(''); // 'lendo' | 'sucesso' | 'erro' | 'enviando'
  const [mensagemIA, setMensagemIA] = useState('');
  const [sucessoEnvioDireto, setSucessoEnvioDireto] = useState(false);

  // Escaneia a guia, lê por IA médica no servidor (com fallback para OCR local)
  const escanearELerNome = async () => {
    setLendoNome(true);
    setStatusIA('');
    setMensagemIA('');
    try {
      const r = await DocumentScanner.scanDocument({
        galleryImportAllowed: true,
        pageLimit: PAGE_LIMIT,
        resultFormats: 'JPEG',
        scannerMode: 'FULL',
      });
      const uris = r.scannedImages || [];
      if (!uris.length) {
        setLendoNome(false);
        return;
      }
      setFotosCapturadas(uris);

      // 1. Tentar leitura inteligente pela IA médica do servidor CBRO
      setStatusIA('lendo');
      let dadosIA = null;
      let erroMotivo = '';
      try {
        dadosIA = await analisarGuiaComIA(uris[0]);
      } catch (errIA) {
        console.warn('IA remota falhou, ativando OCR local:', errIA);
        erroMotivo = errIA?.message || 'Falha de comunicação';
      }

      if (dadosIA && dadosIA.ehDocumentoValido !== false) {
        if (dadosIA.pacienteNome) {
          setNome(dadosIA.pacienteNome.toUpperCase());
        }
        if (dadosIA.convenio) {
          setConvenio(dadosIA.convenio.toUpperCase());
        }
        if (dadosIA.numeroCarteirinha) {
          setCarteirinha(dadosIA.numeroCarteirinha);
        }
        if (dadosIA.tipoDocumento) {
          const t = String(dadosIA.tipoDocumento).toUpperCase();
          if (t.includes('SADT')) setTipo('SADT');
          else if (t.includes('CONSULTA')) setTipo('CONSULTA');
          else if (t.includes('CARTEIRINHA') || t.includes('PESSOAL') || t.includes('RG') || t.includes('CNH') || t.includes('PEDIDO')) {
            if (documentoPaciente) setTipo('DOCUMENTO');
          }
        }
        setStatusIA('sucesso');
        setMensagemIA(`${dadosIA.pacienteNome || 'Paciente'} • ${dadosIA.convenio || 'Convênio'} • ${dadosIA.tipoDocumento || 'Guia'}`);
      } else {
        // 2. Fallback OCR local (ML Kit nativo)
        if (Capacitor.isNativePlatform()) {
          try {
            const { texto } = await LerTexto.reconhecer({ path: uris[0] });
            setTextoOcr(texto || '');
            const resultado = extrairNomePaciente(texto);
            if (resultado.principal) setNome(resultado.principal);
            if (resultado.sugestoes && resultado.sugestoes.length > 0) {
              setSugestoesNome(resultado.sugestoes);
            }
          } catch (e) {
            console.warn('OCR local do nome falhou:', e);
          }
        }
        setStatusIA('erro');
        setMensagemIA(erroMotivo ? `IA remota indisponível (${erroMotivo}); leitor local ativado.` : 'IA remota offline; dados preenchidos com o leitor local.');
      }
    } catch (e) {
      if (!/cancel/i.test(String(e?.message || e))) alert('Falha ao abrir o scanner.');
    }
    setLendoNome(false);
  };

  // Envio Direto e Imediato para o grupo do WhatsApp
  const handleEnviarDiretoWhatsApp = async () => {
    if (criando || statusIA === 'enviando') return;
    if (!nome.trim()) {
      return alert('Informe o nome do paciente antes de enviar.');
    }
    if (!fotosCapturadas.length) {
      return alert('Escaneie a guia ou documento primeiro.');
    }

    setStatusIA('enviando');
    try {
      // 1. Salva o lote localmente com fotos
      const lote = novoLote(nome.trim().toUpperCase(), tipo, convenio.trim(), carteirinha.trim());
      const resultados = await salvarFotosEmLote(
        lote.id,
        fotosCapturadas,
        `direto_${Date.now()}`
      );
      const paths = resultados.filter(res => res.ok).map(res => res.path);
      if (paths.length) {
        atualizarLote(lote.id, { fotos: paths });
      }

      // 2. Monta o PDF e despacha diretamente para o WhatsApp
      const { gerarPDF } = await import('./pdf');
      const blob = await gerarPDF(paths);
      const base64 = await blobParaBase64(blob);
      const nomeLimpo = nome.trim().replace(/[^a-zA-Z0-9À-ÿ\s]/g, '').replace(/\s+/g, '_');
      const filename = `${nomeLimpo}_${tipo}.pdf`;

      const res = await fetch(`${BACKEND_CBRO_URL}/api/whatsapp/despachar-guia-convenio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-guias-key': GUIAS_API_KEY,
        },
        body: JSON.stringify({
          base64,
          fileName: filename,
          pacienteNome: nome.trim().toUpperCase(),
          convenio: convenio.trim() || '',
          tipoDocumento: tipo,
          grupoJid: GRUPO_OFICIAL_JID,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Falha no envio para o WhatsApp (HTTP ${res.status})`);
      }

      setSucessoEnvioDireto(true);
    } catch (err) {
      console.error(err);
      alert('Erro ao enviar para o WhatsApp: ' + (err.message || String(err)));
      setStatusIA('sucesso');
    }
  };

  const handleCriar = async () => {
    if (criando) return;
    if (!nome.trim() && !fotosCapturadas.length) {
      return alert(`Escaneie ${documentoPaciente ? 'o documento' : 'a guia'} ou digite o nome.`);
    }
    setCriando(true);
    try {
      const lote = novoLote((nome.trim() || 'SEM NOME').toUpperCase(), tipo, convenio.trim(), carteirinha.trim());
      if (fotosCapturadas.length) {
        setProgresso({ concluidas: 0, total: fotosCapturadas.length });
        const resultados = await salvarFotosEmLote(
          lote.id,
          fotosCapturadas,
          `nova_${Date.now()}`,
          (concluidas, total) => setProgresso({ concluidas, total }),
        );
        const paths = resultados.filter(resultado => resultado.ok).map(resultado => resultado.path);
        if (paths.length) atualizarLote(lote.id, { fotos: paths });
        const falhas = resultados.length - paths.length;
        if (falhas) alert(`${falhas} página(s) não puderam ser salvas. Você pode escaneá-las novamente.`);
      }
      onCriado(lote.id);
    } finally {
      setCriando(false);
    }
  };

  // Se o envio direto foi concluído, mostra tela de confirmação rápida
  if (sucessoEnvioDireto) {
    return (
      <main className="app-screen">
        <Header
          titulo="Envio Concluído"
          onHome={onHome}
        />
        <div className="page-content form-page" style={{ paddingTop: '20px' }}>
          <div className="card-sucesso-direto">
            <CheckCircle size={56} weight="fill" color="#16a34a" />
            <h2>Guia Enviada com Sucesso!</h2>
            <p>O documento foi gerado em PDF e despachado direto para o grupo <strong>"Documento e Guias"</strong> no WhatsApp.</p>

            <div className="detalhes-envio-sucesso">
              <div><strong>👤 Paciente:</strong> {nome}</div>
              {convenio && <div><strong>💳 Convênio:</strong> {convenio}</div>}
              <div><strong>📋 Tipo:</strong> {tipo}</div>
              {carteirinha && <div><strong>🔢 Carteirinha/Guia:</strong> {carteirinha}</div>}
            </div>

            <div className="acoes-sucesso-direto">
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => {
                  setNome('');
                  setConvenio('');
                  setCarteirinha('');
                  setFotosCapturadas([]);
                  setStatusIA('');
                  setMensagemIA('');
                  setSucessoEnvioDireto(false);
                  escanearELerNome();
                }}
              >
                <Scan size={20} weight="bold" /> Escanear Próxima Guia
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--block"
                onClick={onHome}
              >
                <House size={20} weight="bold" /> Voltar ao Início
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-screen">
      <Header
        titulo={documentoPaciente ? 'Documento do paciente' : 'Nova guia'}
        onVoltar={onVoltar}
        onHome={onHome}
        etapa={1}
      />
      <div className="page-content form-page">
        <section className="scan-prompt">
          <div className="scan-prompt-icon"><Camera size={30} weight="duotone" /></div>
          <div className="scan-prompt-copy">
            <h1>{documentoPaciente ? 'Digitalize o documento' : 'Digitalize a guia'}</h1>
            <p>O scanner do CBRO enquadra as bordas e a <strong>IA lê o Nome, Guia e Convênio</strong> automaticamente.</p>
          </div>
        </section>

        <button
          type="button"
          onClick={escanearELerNome}
          disabled={lendoNome || criando || statusIA === 'enviando'}
          className="scanner-button"
        >
          <Scan size={23} weight="bold" />
          <span>
            {lendoNome
              ? (statusIA === 'lendo' ? '✨ IA do CBRO lendo documento...' : 'Digitalizando...')
              : documentoPaciente ? 'Escanear documento' : 'Escanear guia com IA'}
          </span>
        </button>

        {/* Banner com o resultado da leitura da IA */}
        {statusIA === 'lendo' && (
          <div className="ia-status-banner ia-status-banner--loading">
            <Sparkle size={20} weight="fill" />
            <span>Consultando IA médica do CBRO para extrair paciente, convênio e guia...</span>
          </div>
        )}

        {statusIA === 'sucesso' && (
          <div className="ia-status-banner ia-status-banner--success">
            <CheckCircle size={20} weight="fill" />
            <div>
              <strong>Leitura por IA Concluída!</strong>
              <div style={{ fontSize: '12px', marginTop: '2px' }}>{mensagemIA}</div>
            </div>
          </div>
        )}

        {statusIA === 'erro' && mensagemIA && (
          <div className="ia-status-banner ia-status-banner--error">
            <WarningCircle size={20} weight="fill" />
            <span>{mensagemIA}</span>
          </div>
        )}

        {fotosCapturadas.length > 0 && (
          <div className="inline-feedback inline-feedback--success">
            <CheckCircle size={19} weight="fill" />
            <span>{fotosCapturadas.length} página(s) capturada(s).</span>
          </div>
        )}

        {/* Card do Nome do Paciente */}
        <section className="form-card">
          <label className="field-label" htmlFor="nome-paciente">
            Nome do paciente
            {fotosCapturadas.length > 0 && <span>Confira ou edite:</span>}
          </label>

          <div className="input-with-action">
            <div className="input-icon-prefix"><User size={18} weight="bold" /></div>
            <input
              id="nome-paciente"
              value={nome}
              onChange={e => setNome(e.target.value.toUpperCase())}
              placeholder="Exemplo: JOSIAS DA SILVA MELO"
              className="text-input text-input--with-icon"
            />
            {nome && (
              <button
                type="button"
                aria-label="Limpar nome"
                onClick={() => setNome('')}
                className="input-clear-btn"
                title="Limpar campo"
              >
                <X size={16} weight="bold" />
              </button>
            )}
          </div>

          {/* Chips de Sugestões de Nomes Detectados pelo OCR */}
          {sugestoesNome.length > 0 && (
            <div className="name-suggestions-box">
              <span className="suggestions-title">
                <Sparkle size={14} weight="fill" /> Nomes alternativos encontrados:
              </span>
              <div className="suggestion-chips">
                {sugestoesNome.map((sug, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setNome(sug)}
                    className={`suggestion-chip${nome === sug ? ' is-selected' : ''}`}
                  >
                    {sug}
                  </button>
                ))}
              </div>
            </div>
          )}

          {textoOcr && (
            <button
              type="button"
              onClick={() => alert('Texto lido pelo OCR:\n\n' + textoOcr)}
              className="text-action"
            >
              <MagnifyingGlass size={17} weight="bold" /> Ver texto OCR bruto
            </button>
          )}
        </section>

        {/* Card do Convênio */}
        <section className="form-card">
          <label className="field-label" htmlFor="convenio-paciente">
            Convênio do paciente
            <span>Identificado pela IA ou selecione abaixo:</span>
          </label>

          <div className="input-with-action">
            <div className="input-icon-prefix"><CreditCard size={18} weight="bold" /></div>
            <input
              id="convenio-paciente"
              value={convenio}
              onChange={e => setConvenio(e.target.value.toUpperCase())}
              placeholder="Exemplo: BRADESCO SAÚDE, CASSI..."
              className="text-input text-input--with-icon"
            />
            {convenio && (
              <button
                type="button"
                aria-label="Limpar convênio"
                onClick={() => setConvenio('')}
                className="input-clear-btn"
                title="Limpar convênio"
              >
                <X size={16} weight="bold" />
              </button>
            )}
          </div>

          <div className="quick-chips-grid">
            {CONVENIOS_POPULARES.map(c => (
              <button
                key={c}
                type="button"
                className={`quick-chip${convenio === c ? ' is-selected' : ''}`}
                onClick={() => setConvenio(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </section>

        {/* Tipo de Guia */}
        {!documentoPaciente && (
          <section className="form-card">
            <span className="field-label">Tipo de guia</span>
            <div className="type-grid">
              {['CONSULTA', 'SADT'].map(t => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setTipo(t)}
                  disabled={criando || statusIA === 'enviando'}
                  className={`type-option${tipo === t ? ' is-selected' : ''}`}
                >
                  {t === 'CONSULTA' ? <Stethoscope size={25} weight="duotone" /> : <TestTube size={25} weight="duotone" />}
                  <span>{t === 'CONSULTA' ? 'Consulta' : 'SADT'}</span>
                  <span className="type-check"><Check size={13} weight="bold" /></span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Ações da Página: Envio Direto para WhatsApp OU Salvar e Revisar */}
        <section className="page-actions">
          {criando && progresso.total > 0 && (
            <div role="status" className="progress-copy">
              Salvando página {progresso.concluidas} de {progresso.total}...
            </div>
          )}

          {/* Botão de Destaque: DISPARO DIRETO PRO WHATSAPP */}
          {fotosCapturadas.length > 0 && (
            <button
              type="button"
              onClick={handleEnviarDiretoWhatsApp}
              disabled={criando || statusIA === 'enviando' || !nome.trim()}
              className="btn btn--whatsapp btn--block"
              style={{ padding: '14px 18px', fontSize: '15px' }}
            >
              <PaperPlaneTilt size={20} weight="bold" />
              <span>
                {statusIA === 'enviando'
                  ? 'Enviando para "Documento e Guias"...'
                  : '⚡ Enviar Direto para o Grupo no WhatsApp'}
              </span>
            </button>
          )}

          {/* Botão Secundário: Salvar e Revisar */}
          <Btn
            onClick={handleCriar}
            cor={fotosCapturadas.length > 0 ? 'secondary' : 'primary'}
            disabled={criando || statusIA === 'enviando' || (!nome.trim() && !fotosCapturadas.length)}
            block
          >
            {criando ? 'Salvando...' : fotosCapturadas.length > 0 ? (
              <><span>Salvar e revisar depois</span><ArrowRight size={20} weight="bold" /></>
            ) : (
              <><span>Continuar para o scanner</span><ArrowRight size={20} weight="bold" /></>
            )}
          </Btn>
        </section>
      </div>
    </main>
  );
}

// ─── Tela 3: CÂMERA / FOTOS ──────────────────────────────────────────────────

function TelaFotos({ loteId, onVoltar, onHome, onExportar }) {
  const [lote, setLote] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [fotoSrcs, setFotoSrcs] = useState({});
  const [erro, setErro] = useState('');
  const [progressoSalvar, setProgressoSalvar] = useState({ concluidas: 0, total: 0 });

  useEffect(() => {
    const l = obterLote(loteId);
    setLote(l);
  }, [loteId]);

  useEffect(() => {
    if (!lote?.fotos?.length) return;
    let cancelado = false;
    (async () => {
      const mapa = {};
      for (const f of lote.fotos) {
        if (cancelado) break;
        try {
          const { uri } = await Filesystem.getUri({ path: f, directory: Directory.Data });
          mapa[f] = Capacitor.convertFileSrc(uri);
        } catch (e) {
          console.warn('Erro ao resolver URI da foto:', f, e);
        }
      }
      if (!cancelado) setFotoSrcs(mapa);
    })();
    return () => { cancelado = true; };
  }, [lote?.fotos]);

  if (!lote) return null;

  const detalheErro = (e) => {
    if (!e) return 'Erro desconhecido';
    if (typeof e === 'string') return e;
    const msg = e.message || String(e);
    if (/permission|permiss[aã]o/i.test(msg)) return 'Permissão de câmera negada. Habilite nas configurações do Android.';
    return msg;
  };

  const tirarFotos = async () => {
    setErro('');
    let uris = [];
    try {
      const resultado = await DocumentScanner.scanDocument({
        galleryImportAllowed: true,
        pageLimit: PAGE_LIMIT,
        resultFormats: 'JPEG',
        scannerMode: 'FULL',
      });
      uris = resultado.scannedImages || [];
    } catch (e) {
      if (/cancel/i.test(String(e?.message || e))) return;
      console.error('Erro ao abrir o scanner:', e);
      setErro(`Falha ao abrir o scanner: ${detalheErro(e)}`);
      return;
    }
    if (!uris.length) return;

    setCarregando(true);
    setProgressoSalvar({ concluidas: 0, total: uris.length });
    try {
      const resultados = await salvarFotosEmLote(
        loteId,
        uris,
        `pag_${Date.now()}`,
        (concluidas, total) => setProgressoSalvar({ concluidas, total }),
      );
      const pathsNovos = resultados.filter(resultado => resultado.ok).map(resultado => resultado.path);
      if (pathsNovos.length) {
        const atualizado = atualizarLote(loteId, { fotos: [...(lote.fotos || []), ...pathsNovos] });
        setLote(atualizado);
      }
      const falhas = resultados.length - pathsNovos.length;
      if (falhas) setErro(`${falhas} página(s) foram escaneadas, mas não puderam ser salvas. Tente novamente.`);
    } finally {
      setCarregando(false);
      setProgressoSalvar({ concluidas: 0, total: 0 });
    }
  };

  const refazerFoto = async (indice) => {
    setErro('');
    let uri;
    try {
      const resultado = await DocumentScanner.scanDocument({
        galleryImportAllowed: false,
        pageLimit: 1,
        resultFormats: 'JPEG',
        scannerMode: 'FULL',
      });
      uri = resultado.scannedImages?.[0];
    } catch (e) {
      if (/cancel/i.test(String(e?.message || e))) return;
      console.error('Erro ao refazer foto:', e);
      setErro(`Falha ao abrir o scanner: ${detalheErro(e)}`);
      return;
    }
    if (!uri) return;

    setCarregando(true);
    try {
      const antigo = lote.fotos[indice];
      const res = await salvarFotosEmLote(loteId, [uri], `pag_${Date.now()}`);
      if (res[0]?.ok) {
        const novasFotos = [...lote.fotos];
        novasFotos[indice] = res[0].path;
        const atualizado = atualizarLote(loteId, { fotos: novasFotos });
        setLote(atualizado);
        await removerLote(antigo);
      } else {
        setErro('Não foi possível salvar a nova foto.');
      }
    } finally {
      setCarregando(false);
    }
  };

  const removerFoto = async (indice) => {
    const foto = lote.fotos[indice];
    const novasFotos = lote.fotos.filter((_, i) => i !== indice);
    const atualizado = atualizarLote(loteId, { fotos: novasFotos });
    setLote(atualizado);
    await removerLote(foto);
  };

  return (
    <main className="app-screen">
      <Header
        titulo="Revisar páginas"
        onVoltar={onVoltar}
        onHome={onHome}
        etapa={2}
      />

      <div className="item-context">
        <div className="item-context-main">
          <Badge tipo={lote.tipo} />
          <strong>{lote.nome}</strong>
          {lote.convenio && <span style={{ fontSize: '13px', color: '#175cc7', fontWeight: 600 }}>• 💳 {lote.convenio}</span>}
        </div>
        <span>{lote.fotos?.length || 0} página(s)</span>
      </div>

      {erro && (
        <div role="alert" className="alert alert--error">
          <WarningCircle size={20} weight="fill" /> <span>{erro}</span>
        </div>
      )}

      <div className="page-content review-page">
        {!lote.fotos?.length ? (
          <section className="empty-state empty-state--compact">
            <div className="empty-icon"><Camera size={31} weight="duotone" /></div>
            <h2>Nenhuma página adicionada</h2>
            <p>Toque no botão abaixo para digitalizar as páginas com correção de perspectiva.</p>
          </section>
        ) : (
          <div className="photo-grid">
            {lote.fotos.map((f, i) => (
              <article key={f} className="photo-card">
                {fotoSrcs[f] ? (
                  <img src={fotoSrcs[f]} alt={`Página ${i + 1} de ${lote.nome}`} />
                ) : (
                  <div className="photo-card-placeholder">Carregando imagem...</div>
                )}
                <div className="photo-number">
                  <span>Página {i + 1}</span>
                </div>
                <div className="photo-actions">
                  <button
                    type="button"
                    aria-label={`Refazer página ${i + 1}`}
                    onClick={() => refazerFoto(i)}
                    disabled={carregando}
                    className="photo-action photo-action--retake"
                    title="Escanear novamente esta página"
                  >
                    <Scissors size={17} weight="bold" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Excluir página ${i + 1}`}
                    onClick={() => removerFoto(i)}
                    disabled={carregando}
                    className="photo-action photo-action--delete"
                    title="Excluir página"
                  >
                    <Trash size={17} weight="bold" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        <section className="page-actions">
          {progressoSalvar.total > 0 && (
            <div role="status" className="progress-copy">
              Salvando página {progressoSalvar.concluidas} de {progressoSalvar.total}...
            </div>
          )}
          <Btn onClick={tirarFotos} cor="ghost" disabled={carregando} block>
            {carregando ? 'Processando páginas...' : lote.fotos?.length ? <><Plus size={20} weight="bold" /> Adicionar páginas</> : <><Camera size={20} weight="bold" /> Escanear páginas</>}
          </Btn>
          {lote.fotos?.length > 0 && (
            <Btn onClick={() => onExportar(loteId)} cor="primary" block>
              Continuar para exportar <ArrowRight size={20} weight="bold" />
            </Btn>
          )}
        </section>
      </div>
    </main>
  );
}

// ─── Tela 4: EXPORTAR ────────────────────────────────────────────────────────

function TelaExportar({ loteId, todos, onVoltar, onHome }) {
  const [status, setStatus] = useState('');
  const [pronto, setPronto] = useState(false);
  const [sucessoEnvio, setSucessoEnvio] = useState('');
  const [urlPDF, setUrlPDF] = useState(null);
  const [urlZIP, setUrlZIP] = useState(null);
  const [nomeZIP, setNomeZIP] = useState('');
  const loteAtual = loteId ? obterLote(loteId) : null;
  const lotes = todos ? carregarLotes().filter(l => l.fotos?.length > 0) : loteAtual ? [loteAtual] : [];
  const somenteDocumentos = lotes.length > 0 && lotes.every(l => l.tipo === 'DOCUMENTO');

  useEffect(() => () => {
    if (urlPDF) URL.revokeObjectURL(urlPDF);
    if (urlZIP) URL.revokeObjectURL(urlZIP);
  }, [urlPDF, urlZIP]);

  const despacharDiretoGrupo = async () => {
    try {
      if (!lotes.length) return;
      setSucessoEnvio('');
      setPronto(false);
      setStatus(lotes.length === 1 ? 'Gerando PDF da guia...' : 'Iniciando despacho em lote...');

      const { gerarPDF } = await import('./pdf');

      for (let i = 0; i < lotes.length; i++) {
        const item = lotes[i];
        if (!item.fotos || !item.fotos.length) continue;

        setStatus(lotes.length === 1
          ? 'Gerando PDF formatado...'
          : `Gerando PDF ${i + 1} de ${lotes.length} (${item.nome})...`
        );

        const blob = await gerarPDF(item.fotos);
        const base64 = await blobParaBase64(blob);
        const nomeLimpo = item.nome.replace(/[^a-zA-Z0-9À-ÿ\s]/g, '').replace(/\s+/g, '_');
        const filename = `${nomeLimpo}_${item.tipo}.pdf`;

        setStatus(lotes.length === 1
          ? 'Enviando para o grupo "Documento e Guias" no WhatsApp...'
          : `Enviando ${i + 1}/${lotes.length} para o WhatsApp...`
        );

        const res = await fetch('https://cbrosistema.duckdns.org/api/whatsapp/despachar-guia-convenio', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-guias-key': GUIAS_API_KEY,
          },
          body: JSON.stringify({
            base64,
            fileName: filename,
            pacienteNome: item.nome,
            convenio: item.convenio || '',
            tipoDocumento: item.tipo,
            grupoJid: GRUPO_OFICIAL_JID,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Falha no envio (HTTP ${res.status})`);
        }
      }

      setStatus('');
      setSucessoEnvio(
        lotes.length === 1
          ? '✅ Guia enviada com sucesso para o grupo "Documento e Guias" no WhatsApp!'
          : `✅ Todos os ${lotes.length} documentos foram enviados para o grupo "Documento e Guias"!`
      );
    } catch (e) {
      console.error(e);
      setStatus('Erro ao enviar para o WhatsApp: ' + (e.message || String(e)));
    }
  };

  const gerarEcompartilhar = async () => {
    try {
      if (!lotes.length) return;
      setPronto(false);
      setSucessoEnvio('');
      setUrlPDF(null);
      setStatus(lotes.length === 1 ? 'Gerando PDF...' : 'Gerando ZIP com todos os PDFs...');
      let filename, base64, mimeType;

      if (lotes.length === 1) {
        const { gerarPDF } = await import('./pdf');
        const blob = await gerarPDF(lotes[0].fotos);
        base64 = await blobParaBase64(blob);
        const nomeLimpo = lotes[0].nome.replace(/[^a-zA-Z0-9À-ÿ\s]/g, '').replace(/\s+/g, '_');
        filename = `${nomeLimpo}_${lotes[0].tipo}.pdf`;
        mimeType = 'application/pdf';
        const url = URL.createObjectURL(blob);
        setUrlPDF(url);
      } else {
        const { gerarZIP } = await import('./zip');
        const blob = await gerarZIP(
          lotes,
          (concluidos, total) => setStatus(`Gerando PDF ${concluidos} de ${total}...`),
        );
        base64 = await blobParaBase64(blob);
        filename = `Guias_CBRO_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.zip`;
        mimeType = 'application/zip';
        const url = URL.createObjectURL(blob);
        setUrlZIP(url);
        setNomeZIP(filename);
      }

      setStatus('Salvando arquivo...');
      await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
      const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });

      setStatus('');
      setPronto(true);

      let enviadoDireto = false;
      if (Capacitor.isNativePlatform()) {
        try {
          await EnviarWhatsApp.enviar({ filename, mimeType });
          enviadoDireto = true;
        } catch (err) {
          console.warn('WhatsApp direto falhou, usando compartilhamento padrão:', err);
        }
      }
      if (!enviadoDireto) {
        await Share.share({
          title: filename,
          files: [uri],
          dialogTitle: 'Enviar via WhatsApp ou salvar',
        });
      }
    } catch (e) {
      console.error(e);
      setStatus('Erro: ' + String(e));
    }
  };

  const abrirPortal = () => {
    window.open('https://amhptiss.amhp.com.br/CriarAtendimentoSplitFiles.aspx', '_blank');
  };

  const totalFotos = lotes.reduce((s, l) => s + (l.fotos?.length || 0), 0);

  return (
    <main className="app-screen">
      <Header
        titulo={todos ? 'Exportar todas' : somenteDocumentos ? 'Exportar documento' : 'Exportar guia'}
        onVoltar={onVoltar}
        onHome={onHome}
        etapa={3}
      />

      <div className="page-content export-page">
        {/* Resumo */}
        <section className="export-card">
          <div className="export-card-heading">
            <span className="export-icon">{todos ? <Package size={25} weight="duotone" /> : <FilePdf size={25} weight="duotone" />}</span>
            <div>
              <h1>{todos ? 'Exportação em lote' : lotes[0]?.nome}</h1>
              <p>{lotes.length === 1 ? 'Um arquivo PDF será criado' : `${lotes.length} arquivos serão reunidos em um ZIP`}</p>
            </div>
          </div>
          <div className="export-list">
            {lotes.map(l => (
              <div key={l.id} className="export-row">
                <span className="export-row-name">
                  <Badge tipo={l.tipo} />
                  <strong>{l.nome}</strong>
                </span>
                <span>{l.fotos?.length} página(s)</span>
              </div>
            ))}
          </div>
          <div className="export-total">
            <span>{lotes.length} {lotes.length === 1 ? 'item' : 'itens'}</span>
            <span>{totalFotos} página(s)</span>
            <strong>{lotes.length === 1 ? '1 PDF' : `${lotes.length} PDFs em 1 ZIP`}</strong>
          </div>
        </section>

        {/* Status */}
        {status && (
          <div role="status" className="alert alert--progress">
            <FilePdf size={20} weight="duotone" /> <span>{status}</span>
          </div>
        )}
        {pronto && !status && !sucessoEnvio && (
          <div role="status" className="alert alert--success">
            <CheckCircle size={21} weight="fill" /> <span>Arquivo criado com sucesso. Pronto para envio ou download.</span>
          </div>
        )}
        {sucessoEnvio && !status && (
          <div role="status" className="alert alert--success">
            <CheckCircle size={21} weight="fill" /> <span>{sucessoEnvio}</span>
          </div>
        )}

        {/* Botões de Ação */}
        <section className="page-actions">
          <Btn onClick={despacharDiretoGrupo} cor="whatsapp" disabled={!!status || !lotes.length} block>
            {status ? (
              'Enviando para o WhatsApp...'
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                  <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c4.54 0 8.24 3.7 8.24 8.24 0 2.2-.86 4.27-2.42 5.82a8.196 8.196 0 0 1-5.82 2.42c-1.46 0-2.89-.39-4.14-1.13l-.3-.18-3.12.82.83-3.04-.2-.31a8.163 8.163 0 0 1-1.25-4.4c0-4.54 3.7-8.24 8.24-8.24m4.52 11.53c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.03-1.25-.75-.67-1.26-1.5-1.41-1.75-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08 0 1.23.89 2.42 1.02 2.59.13.17 1.76 2.69 4.26 3.77.6.26 1.06.41 1.42.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.23-.17-.48-.29z"/>
                </svg>
                <span>Enviar direto para "Documento e Guias"</span>
              </>
            )}
          </Btn>

          <Btn onClick={gerarEcompartilhar} cor="primary" disabled={!!status || !lotes.length} block>
            {status ? 'Processando...' : lotes.length === 1 ? <><ShareNetwork size={21} weight="bold" /> Criar PDF e compartilhar</> : <><Package size={21} weight="bold" /> Criar ZIP e compartilhar</>}
          </Btn>

          {urlPDF && (
            <a href={urlPDF} download={`${lotes[0]?.nome}_${lotes[0]?.tipo}.pdf`} className="btn btn--ghost btn--block">
              <DownloadSimple size={21} weight="bold" /> Baixar PDF no aparelho / PC
            </a>
          )}

          {urlZIP && (
            <a href={urlZIP} download={nomeZIP || 'Guias_CBRO.zip'} className="btn btn--ghost btn--block">
              <DownloadSimple size={21} weight="bold" /> Baixar ZIP no PC (com pasta por paciente)
            </a>
          )}

          {/* Botão para voltar direto à primeira página */}
          <Btn onClick={onHome} cor="secondary" block className="btn-home-action">
            <House size={20} weight="bold" /> Concluir e voltar ao início
          </Btn>

          {!somenteDocumentos && (
            <div className="portal-action">
              <p>Após gerar o PDF, faça o upload no portal AMHP TISS:</p>
              <Btn onClick={abrirPortal} cor="ghost" block>
                <GlobeHemisphereWest size={21} weight="bold" /> Abrir portal AMHP TISS
              </Btn>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

// ─── APP ROOT ────────────────────────────────────────────────────────────────

export default function App() {
  const [tela, setTela] = useState('home');
  const [loteId, setLoteId] = useState(null);
  const [exportarTodos, setExportarTodos] = useState(false);
  const [modoNovo, setModoNovo] = useState('guia');

  const irHome = () => {
    setTela('home');
    setLoteId(null);
    setExportarTodos(false);
    setModoNovo('guia');
  };

  const iniciarNovo = modo => {
    setModoNovo(modo);
    setTela('nova');
  };

  if (tela === 'nova') return (
    <TelaNova
      onVoltar={irHome}
      onHome={irHome}
      onCriado={id => { setLoteId(id); setTela('fotos'); }}
      modo={modoNovo}
    />
  );

  if (tela === 'fotos') return (
    <TelaFotos
      loteId={loteId}
      onVoltar={irHome}
      onHome={irHome}
      onExportar={id => { setLoteId(id); setExportarTodos(false); setTela('exportar'); }}
    />
  );

  if (tela === 'exportar') return (
    <TelaExportar
      loteId={exportarTodos ? null : loteId}
      todos={exportarTodos}
      onVoltar={exportarTodos ? irHome : () => setTela('fotos')}
      onHome={irHome}
    />
  );

  return (
    <TelaHome
      onNovo={() => iniciarNovo('guia')}
      onNovoDocumento={() => iniciarNovo('documento')}
      onAbrir={id => { setLoteId(id); setTela('fotos'); }}
      onExportarTudo={() => { setExportarTodos(true); setTela('exportar'); }}
    />
  );
}
