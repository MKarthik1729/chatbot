<script>
  import { onMount } from 'svelte';

  // Generate random 4 letters for guest name
  const randomLetters = () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    return Array(4)
      .fill(null)
      .map(() => letters.charAt(Math.floor(Math.random() * letters.length)))
      .join('');
  };

  const guestId = `guest${randomLetters()}`;
  // const guestId = `guestdliq`
  let isChatOpen = false;
  let ws;
  let messages = [];
  let inputMessage = '';
  let chatMessagesContainer;

  async function fetchChatHistory(userId1, userId2) {
    try {
      const response = await fetch(`http://localhost:8000/messages/${userId1}/${userId2}`);
      const chatHistory = await response.json();
      console.log('Fetched chat history:', chatHistory);
      messages = chatHistory;
    } catch (error) {
      console.error('Error fetching chat history:', error);
    }
  }

  function scrollToBottom() {
    if (chatMessagesContainer) {
      chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
  }

  // Watch messages array for changes and scroll to bottom
  $: if (messages) {
    setTimeout(scrollToBottom, 100);
  }

  // Connect to WebSocket when component mounts
  onMount(() => {
    ws = new WebSocket('ws://localhost:8000');
    
    ws.onopen = () => {
      console.log('Connected to chat server');
      // Send connect message with user ID
      ws.send(JSON.stringify({
        type: 'connect',
        userId: guestId
      }));
      // Fetch initial chat history
      fetchChatHistory(guestId, "org_2uZZNcl5QNtf7IVQuWYMLgdvCgY");
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log('Received message:', message);
      
      if (message.type === 'message') {
        // Update the message structure to match your backend response
        const newMessage = {
          sender_id: message.senderId,
          reciever_id: message.recieverId,
          message: message.content || message.message,
          created_at: message.timestamp || message.created_at || new Date().toISOString()
        };

        // Check if message already exists to avoid duplicates
        const messageExists = messages.some(msg => 
          msg.created_at === newMessage.created_at && 
          msg.sender_id === newMessage.sender_id && 
          msg.reciever_id === newMessage.reciever_id
        );

        if (!messageExists) {
          console.log('Adding new message to UI:', newMessage);
          messages = [...messages, newMessage];
        }

        if (!message.isSender && (!selectedSession || 
            (selectedSession.user_id !== message.sender_id && 
             selectedSession.user_id !== message.reciever_id))) {
          const session = (activeTab === 'my-sessions' ? sessions : allSessions).find(s => 
            s.user_id === message.sender_id || s.user_id === message.reciever_id
          );
          
          if (session && 'Notification' in window) {
            Notification.requestPermission().then(permission => {
              if (permission === 'granted') {
                new Notification('New Message', {
                  body: `New message from ${session.user_id}`,
                  icon: '/chat-icon.png'
                });
              }
            });
          }
        }
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from chat server');
      // Attempt to reconnect after 5 seconds
      setTimeout(() => {
        console.log('Attempting to reconnect...');
        ws = new WebSocket('ws://localhost:8000');
      }, 5000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      if (ws) ws.close();
    };
  });

  function signIn() {
    // Add sign in logic here
    console.log('Sign In clicked');
  }

  function signUp() {
    // Add sign up logic here
    console.log('Sign Up clicked');
  }

  function toggleChat() {
    isChatOpen = !isChatOpen;
    if (isChatOpen) {
      console.log('Chat opened by:', guestId);
    }
  }

  function sendMessage() {
    if (inputMessage.trim() && ws.readyState === WebSocket.OPEN) {
      const messageData = {
        type: 'message',
        senderId: guestId,
        recieverId: "org_2uZZNcl5QNtf7IVQuWYMLgdvCgY",
        content: inputMessage,
        timestamp: new Date().toISOString()
      };
      
      console.log('Sending message:', messageData);
      ws.send(JSON.stringify(messageData));
      
      // Add the sent message to the messages array immediately
      const newMessage = {
        sender_id: guestId,
        reciever_id: "org_2uZZNcl5QNtf7IVQuWYMLgdvCgY",
        message: inputMessage,
        created_at: new Date().toISOString()
      };

      // Check if message already exists to avoid duplicates
      const messageExists = messages.some(msg => 
        msg.created_at === newMessage.created_at && 
        msg.sender_id === newMessage.sender_id && 
        msg.reciever_id === newMessage.reciever_id
      );

      if (!messageExists) {
        messages = [...messages, newMessage];
      }
      
      inputMessage = '';
    } else {
      console.error('WebSocket is not connected or message is empty');
    }
  }
</script>

<main>
  <div class="auth-container">
    <button on:click={signIn}>Sign In</button>
    <button on:click={signUp}>Sign Up</button>
  </div>

  <!-- Chat Icon -->
  <button class="chat-icon" on:click={toggleChat}>
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  </button>

  <!-- Chat Window -->
  {#if isChatOpen}
    <div class="chat-window">
      <div class="chat-header">
        <h3>Chat ({guestId})</h3>
        <button class="close-btn" on:click={toggleChat}>×</button>
      </div>
      <div class="chat-messages" bind:this={chatMessagesContainer}>
        {#each messages as message}
          <div class="message {message.sender_id === guestId ? 'sent' : 'received'}">
            <p>{message.message}</p>
          </div>
        {/each}
      </div>
      <div class="chat-input">
        <input 
          type="text" 
          bind:value={inputMessage}
          on:keydown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Type a message..."
        >
        <button on:click={sendMessage}>Send</button>
      </div>
    </div>
  {/if}
</main>

<style>
  .auth-container {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 20px;
    height: 100vh;
  }

  button {
    padding: 10px 20px;
    font-size: 16px;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    background-color: #007bff;
    color: white;
    transition: background-color 0.3s;
  }

  button:hover {
    background-color: #0056b3;
  }

  .chat-icon {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background-color: #007bff;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  }

  .chat-window {
    position: fixed;
    bottom: 80px;
    right: 20px;
    width: 400px;
    height: 600px;
    background: white;
    border-radius: 10px;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-direction: column;
  }

  .chat-header {
    padding: 15px;
    background: #007bff;
    color: white;
    border-radius: 10px 10px 0 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .chat-header h3 {
    margin: 0;
    font-size: 1.2em;
  }

  .close-btn {
    background: none;
    border: none;
    color: white;
    font-size: 24px;
    cursor: pointer;
    padding: 0 5px;
  }

  .chat-messages {
    flex-grow: 1;
    padding: 6px;
    overflow-y: auto;
  }

  .chat-input {
    padding: 15px;
    border-top: 1px solid #eee;
    display: flex;
    gap: 10px;
  }

  .chat-input input {
    flex-grow: 1;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 1em;
  }

  .chat-input button {
    padding: 12px 20px;
    font-size: 1em;
  }

  .message {
    margin: 4px 0;
    padding: 4px 8px;
    border-radius: 8px;
    max-width: 60%;
    position: relative;
    font-size: 0.95em;
    word-wrap: break-word;
  }

  .message p {
    margin: 0;
    line-height: 1.3;
  }

  .sent {
    background-color: #28a745;
    color: white;
    margin-left: auto;
  }

  .received {
    background-color: #e9ecef;
    color: #212529;
    margin-right: auto;
  }

  .sender {
    font-size: 0.8em;
    opacity: 0.8;
  }

  .timestamp {
    display: none;
  }
</style>
