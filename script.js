const chatMessages = document.getElementById('chatMessages');
const userInput   = document.getElementById('userInput');
const sendBtn     = document.getElementById('sendBtn');

// Keep conversation history so the AI remembers context
const conversationHistory = [];

// ── Auto-resize textarea as user types ──────────────────────────────────────
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = userInput.scrollHeight + 'px';
});

// ── Send on Enter (Shift+Enter = new line) ───────────────────────────────────
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ── Main send function ───────────────────────────────────────────────────────
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;

  // 1. Show user message
  appendMessage('user', text);
  userInput.value = '';
  userInput.style.height = 'auto';

  // 2. Disable input while waiting
  setInputEnabled(false);

  // 3. Show typing indicator
  const typingEl = showTyping();

  // 4. Add to history
  conversationHistory.push({ role: 'user', content: text });

  try {
    // 5. Call the Vercel serverless function
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${response.status}`);
    }

    const data = await response.json();
    const reply = data.reply;

    // 6. Add assistant reply to history
    conversationHistory.push({ role: 'assistant', content: reply });

    // 7. Remove typing indicator and show reply
    removeTyping(typingEl);
    appendMessage('bot', reply);

  } catch (error) {
    removeTyping(typingEl);
    appendMessage('bot', `Sorry, something went wrong: ${error.message}`);
  }

  setInputEnabled(true);
  userInput.focus();
}

// ── Helper: append a chat bubble ─────────────────────────────────────────────
function appendMessage(sender, text) {
  const msgDiv = document.createElement('div');
  msgDiv.classList.add('message', sender);

  const bubble = document.createElement('div');
  bubble.classList.add('bubble');

  // Convert newlines to <br> for multi-line replies
  bubble.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');

  msgDiv.appendChild(bubble);
  chatMessages.appendChild(msgDiv);
  scrollToBottom();
}

// ── Helper: show animated typing dots ────────────────────────────────────────
function showTyping() {
  const msgDiv = document.createElement('div');
  msgDiv.classList.add('message', 'bot', 'typing');

  msgDiv.innerHTML = `
    <div class="bubble">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>`;

  chatMessages.appendChild(msgDiv);
  scrollToBottom();
  return msgDiv;
}

function removeTyping(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

// ── Helper: enable/disable send button + textarea ────────────────────────────
function setInputEnabled(enabled) {
  sendBtn.disabled    = !enabled;
  userInput.disabled  = !enabled;
}

// ── Helper: scroll chat to the bottom ────────────────────────────────────────
function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ── Helper: prevent XSS by escaping HTML special chars ───────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
