import { useEffect, useRef, useState } from 'react';
import { Bot, ImagePlus, LoaderCircle, Mic, MicOff, Send, Sparkles, UserRound, X } from 'lucide-react';
import { assistantApi } from '../services/api.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_ONLY_PROMPT = 'Analise este comprovante e registre o gasto.';

const INITIAL_MESSAGE = {
  role: 'assistant',
  text: 'Olá! Sou o seu assistente financeiro. Como posso ajudar você hoje?',
  greeting: true,
};

const SUGGESTIONS = [
  'Resumo deste mês',
  'Limites dos cartões',
  'Quem está cadastrado?',
];

export default function AssistantWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [imageAttachment, setImageAttachment] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [assistantError, setAssistantError] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const imageInputRef = useRef(null);
  const launcherRef = useRef(null);
  const restoreFocus = useRef(false);
  const recognitionRef = useRef(null);

  function stopVoiceRecognition() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen && window.matchMedia('(min-width: 768px)').matches) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        restoreFocus.current = true;
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen && restoreFocus.current) {
      launcherRef.current?.focus();
      restoreFocus.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) stopVoiceRecognition();
  }, [isOpen]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
  }, []);

  async function handleImageSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setAssistantError('Envie uma imagem JPEG, PNG ou WebP.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAssistantError('A imagem deve ter no máximo 8 MB.');
      return;
    }

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
        reader.readAsDataURL(file);
      });
      const [header, base64] = String(dataUrl).split(',', 2);
      if (!base64 || !header.includes(file.type)) throw new Error('Não foi possível preparar a imagem.');
      setAssistantError('');
      setImageAttachment({ base64, mimeType: file.type, preview: dataUrl });
    } catch (error) {
      setAssistantError(error.message);
    }
  }

  function toggleVoiceRecognition() {
    if (isListening) {
      stopVoiceRecognition();
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setAssistantError('O reconhecimento de voz não é compatível com este navegador.');
      return;
    }
    setAssistantError('');
    const recognition = new Recognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || '')
        .join(' ')
        .trim()
        .slice(0, 4000);
      if (transcript) setInputMessage(transcript);
    };
    recognition.onerror = (event) => {
      setAssistantError(event.error === 'not-allowed'
        ? 'Permita o acesso ao microfone para usar a transcrição.'
        : 'Não foi possível transcrever o áudio. Tente novamente.');
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    setIsListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setAssistantError('Não foi possível iniciar o microfone. Tente novamente.');
    }
  }

  const handleSend = async (textToSend = inputMessage, imageToSend = imageAttachment) => {
    const typedMessage = textToSend.trim();
    if ((!typedMessage && !imageToSend) || isLoading) return;
    const message = typedMessage || IMAGE_ONLY_PROMPT;

    const history = messages
      .filter((item) => !item.greeting)
      .slice(-6)
      .map(({ role, text }) => ({ role, text }));

    setMessages((current) => [...current, {
      role: 'user',
      text: message,
      image: imageToSend?.preview,
    }]);
    setInputMessage('');
    setImageAttachment(null);
    setAssistantError('');
    setIsLoading(true);

    try {
      const result = await assistantApi.chat({
        message,
        ...(imageToSend ? { image: { base64: imageToSend.base64, mimeType: imageToSend.mimeType } } : {}),
        history,
      });
      setMessages((current) => [...current, { role: 'assistant', text: result.reply }]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: `Não consegui processar sua mensagem: ${error.message}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="assistant-widget">
      {isOpen ? (
        <section className="assistant-panel" aria-label="Assistente financeiro" aria-live="polite">
          <header className="assistant-header">
            <span className="assistant-brand-icon"><Bot aria-hidden="true" /></span>
            <div className="assistant-heading">
              <strong>Caderno de Contas IA</strong>
              <span><i aria-hidden="true" /> Pronto para ajudar</span>
            </div>
            <button
              className="assistant-icon-button"
              type="button"
              onClick={() => {
                restoreFocus.current = true;
                setIsOpen(false);
              }}
              aria-label="Fechar assistente"
              title="Fechar"
            >
              <X aria-hidden="true" />
            </button>
          </header>

          <div className="assistant-messages" role="log" aria-label="Conversa com o assistente" aria-relevant="additions">
            {messages.map((item, index) => (
              <div className={`assistant-message assistant-message-${item.role}`} key={`${index}-${item.role}`}>
                {item.role === 'assistant' && (
                  <span className="assistant-message-avatar"><Bot aria-hidden="true" /></span>
                )}
                <div className="assistant-message-content">
                  {item.image && <img className="assistant-message-image" src={item.image} alt="Imagem enviada para análise" />}
                  <p>{item.text}</p>
                </div>
                {item.role === 'user' && (
                  <span className="assistant-message-avatar assistant-user-avatar"><UserRound aria-hidden="true" /></span>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="assistant-loading" role="status">
                <LoaderCircle aria-hidden="true" />
                <span>Consultando e preparando uma resposta...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {messages.length <= 2 && (
            <div className="assistant-suggestions" aria-label="Sugestões de perguntas">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion}
                  disabled={isLoading}
                  onClick={() => handleSend(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {imageAttachment && (
            <div className="assistant-attachment-preview">
              <img src={imageAttachment.preview} alt="Prévia do comprovante selecionado" />
              <span>Imagem pronta para envio</span>
              <button type="button" onClick={() => setImageAttachment(null)} aria-label="Remover imagem">
                <X aria-hidden="true" />
              </button>
            </div>
          )}
          {assistantError && <p className="assistant-input-error" role="alert">{assistantError}</p>}
          <form
            className="assistant-form"
            onSubmit={(event) => {
              event.preventDefault();
              handleSend();
            }}
          >
            <input
              ref={imageInputRef}
              className="assistant-file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageSelected}
              aria-label="Selecionar foto de comprovante"
            />
            <button
              className="assistant-icon-button assistant-input-button"
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={isLoading}
              aria-label="Anexar imagem de comprovante"
              title="Anexar imagem"
            >
              <ImagePlus aria-hidden="true" />
            </button>
            <button
              className={`assistant-icon-button assistant-input-button ${isListening ? 'is-listening' : ''}`}
              type="button"
              onClick={toggleVoiceRecognition}
              disabled={isLoading}
              aria-label={isListening ? 'Parar gravação' : 'Transcrever mensagem por voz'}
              aria-pressed={isListening}
              title={isListening ? 'Parar gravação' : 'Falar mensagem'}
            >
              {isListening ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
            </button>
            <input
              ref={inputRef}
              className="assistant-message-input"
              type="text"
              maxLength={4000}
              value={inputMessage}
              onChange={(event) => setInputMessage(event.target.value)}
              placeholder="Escreva sua mensagem..."
              aria-label="Mensagem para o assistente"
              disabled={isLoading}
            />
            <button
              className="assistant-send-button"
              type="submit"
              disabled={isLoading || (!inputMessage.trim() && !imageAttachment)}
              aria-label="Enviar mensagem"
              title="Enviar"
            >
              <Send aria-hidden="true" />
            </button>
          </form>
        </section>
      ) : (
        <button
          ref={launcherRef}
          className="assistant-launcher"
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Abrir assistente financeiro"
          title="Assistente financeiro"
        >
          <Sparkles aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
