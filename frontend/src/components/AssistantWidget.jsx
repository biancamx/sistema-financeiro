import { useEffect, useRef, useState } from 'react';
import { Bot, LoaderCircle, Send, Sparkles, UserRound, X } from 'lucide-react';
import { assistantApi } from '../services/api.js';

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
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleSend = async (textToSend = inputMessage) => {
    const message = textToSend.trim();
    if (!message || isLoading) return;

    const history = messages
      .filter((item) => !item.greeting)
      .slice(-6)
      .map(({ role, text }) => ({ role, text }));

    setMessages((current) => [...current, { role: 'user', text: message }]);
    setInputMessage('');
    setIsLoading(true);

    try {
      const result = await assistantApi.chat({ message, history });
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
              onClick={() => setIsOpen(false)}
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
                <p>{item.text}</p>
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

          <form
            className="assistant-form"
            onSubmit={(event) => {
              event.preventDefault();
              handleSend();
            }}
          >
            <input
              ref={inputRef}
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
              disabled={isLoading || !inputMessage.trim()}
              aria-label="Enviar mensagem"
              title="Enviar"
            >
              <Send aria-hidden="true" />
            </button>
          </form>
        </section>
      ) : (
        <button
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
