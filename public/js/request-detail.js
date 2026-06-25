
const chatMsgs = document.getElementById('chatMsgs');
const chatInput = document.getElementById('chatInput');

chatMsgs.scrollTop = chatMsgs.scrollHeight;

document.getElementById('chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = chatInput.value.trim();
    if (!content) return;
    chatInput.value = '';
    try {
        await fetch(`/request/${reqId}/message`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        loadMessages();
    } catch (err) { console.error(err); }
});

async function loadMessages() {
    try {
        const res = await fetch(`/request/${reqId}/messages`);
        const msgs = await res.json();
        chatMsgs.innerHTML = msgs.map(m => `
        <div class="msg ${m.sender_role}">
          <div class="msg-name">${m.sender_role === 'bot' ? '<i class="fa-solid fa-robot"></i> BOT' : (m.sender_name || m.sender_role).toUpperCase()}</div>
          ${m.content}
        </div>
      `).join('') || '<div style="text-align:center;color:var(--muted);font-size:.8rem;padding:2rem 0">Sin mensajes.</div>';
        chatMsgs.scrollTop = chatMsgs.scrollHeight;
    } catch (e) { }
}

setInterval(loadMessages, 8000);