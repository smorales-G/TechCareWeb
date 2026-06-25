    const chatWidget = document.getElementById('chatbot');
    const chatIcon = document.getElementById('chat-toggle-icon');
    const messagesContainer = document.getElementById('chat-messages');
    const inputField = document.getElementById('chat-input');
    let conversation = [
      { role: 'system', content: 'Eres el asistente virtual de TechCare.mza, un servicio de mantenimiento técnico de dispositivos en Mendoza, Argentina. Responde en español, de forma amable y concisa. Puedes ayudar con consultas sobre tipos de reparaciones, el proceso, y precios aproximados.' }
    ];

    function toggleChat() {
      chatWidget.classList.toggle('collapsed');
      chatIcon.textContent = chatWidget.classList.contains('collapsed') ? '▲' : '▼';
    }

    function handleKeyPress(e) { if (e.key === 'Enter') sendMessage(); }

    async function sendMessage() {
      const text = inputField.value.trim();
      if (!text) return;
      addMessage(text, 'user');
      inputField.value = '';
      conversation.push({ role: 'user', content: text });
      const typingId = 'typing-' + Date.now();
      const typingEl = document.createElement('div');
      typingEl.className = 'message bot'; typingEl.id = typingId;
      typingEl.innerHTML = '<span class="typing-dot">●</span> <span class="typing-dot" style="animation-delay:0.2s">●</span> <span class="typing-dot" style="animation-delay:0.4s">●</span>';
      messagesContainer.appendChild(typingEl);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      try {
        const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: conversation }) });
        const data = await res.json();
        document.getElementById(typingId)?.remove();
        if (data.message?.content) {
          addMessage(data.message.content, 'bot');
          conversation.push({ role: 'assistant', content: data.message.content });
        } else { addMessage('Hubo un error al conectar con el asistente.', 'bot'); }
      } catch { document.getElementById(typingId)?.remove(); addMessage('No se pudo conectar con soporte.', 'bot'); }
    }

    function addMessage(text, sender) {
      const div = document.createElement('div');
      div.className = `message ${sender}`;
      div.textContent = text;
      messagesContainer.appendChild(div);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Scroll reveal animation
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.style.opacity = 1; e.target.style.transform = 'translateY(0)'; } });
    }, { threshold: 0.1 });
    document.querySelectorAll('.service-card, .step-card, .why-card').forEach(el => {
      el.style.opacity = 0; el.style.transform = 'translateY(20px)';
      el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      observer.observe(el);
    });