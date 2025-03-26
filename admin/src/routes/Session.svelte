<script>
  import { Clerk } from "@clerk/clerk-js";
  import { onMount } from "svelte";
  import { createClient } from '@supabase/supabase-js';

  let clerk;
  let loading = true;
  let sessions = [];
  let allSessions = [];
  let error = null;
  let activeTab = 'my-sessions';
  let selectedSession = null;
  let messages = [];
  let messagesLoading = false;
  let messagesError = null;
  let newMessage = '';
  let isAdmin = false;
  let ws = null;
  let currentUserId = null;
  let currentOrganizationId = null;
  let chatMessagesContainer;

  // Initialize Supabase client
  const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );

  async function checkAdminStatus(user, organizationId) {
    try {
      const membership = user.organizationMemberships.find(m => m.organization.id === organizationId);
      return membership?.role === 'org:admin';
    } catch (err) {
      console.error('Error in checkAdminStatus:', err);
      return false;
    }
  }

  async function fetchMySessions(userId, organizationId) {
    const { data: sessionsData, error: sessionsError } = await supabase
      .from('session')
      .select('*')
      .eq('staff_id', userId)
      .eq('organisation_id', organizationId);

    if (sessionsError) {
      console.error('Error fetching my sessions:', sessionsError);
      error = 'Failed to load sessions';
    } else {
      sessions = sessionsData || [];
      console.log('My Sessions:', sessions);
    }
  }

  async function fetchAllSessions(organizationId) {
    const { data: sessionsData, error: sessionsError } = await supabase
      .from('session')
      .select('*')
      .eq('organisation_id', organizationId);

    if (sessionsError) {
      console.error('Error fetching all sessions:', sessionsError);
      error = 'Failed to load sessions';
    } else {
      allSessions = sessionsData || [];
      console.log('All Sessions:', allSessions);
    }
  }

  async function fetchMessages(userId, organizationId) {
    messagesLoading = true;
    messagesError = null;
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${userId},reciever_id.eq.${organizationId}),and(sender_id.eq.${organizationId},reciever_id.eq.${userId})`)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching messages:', error);
        messagesError = 'Failed to load messages';
      } else {
        messages = data || [];
        console.log('Fetched messages:', messages);
      }
    } catch (err) {
      console.error('Error in fetchMessages:', err);
      messagesError = 'Failed to load messages';
    } finally {
      messagesLoading = false;
    }
  }

  // Function to update messages for a specific session
  function updateSessionMessages(sessionId, message) {
    if (selectedSession && 
        (selectedSession.user_id === message.sender_id || 
         selectedSession.user_id === message.reciever_id)) {
      messages = [...messages, message];
    }
  }

  function initializeWebSocket(userId, organizationId) {
    if (ws) {
      ws.close();
    }

    currentUserId = userId;
    currentOrganizationId = organizationId;

    ws = new WebSocket('ws://localhost:8000');
    let heartbeatTimeout;

    ws.onopen = () => {
      console.log('WebSocket connected');
      // Send connect message with user ID and role
      ws.send(JSON.stringify({
        type: 'connect',
        userId: organizationId,
        role: isAdmin ? 'admin' : 'staff'
      }));
      // Only fetch messages if we have a selected session
      if (selectedSession) {
        fetchMessages(selectedSession.user_id, selectedSession.organisation_id);
      }
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log('Received WebSocket message:', message);
      
      // Handle ping messages
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      if (message.type === 'message') {
        // Create a temporary message object for immediate UI update
        const tempMessage = {
          sender_id: message.senderId,
          reciever_id: message.recieverId,
          message: message.content,
          type: 'text',
          created_at: message.timestamp || new Date().toISOString(),
          isSender: message.senderId === currentOrganizationId,
          status: message.status
        };

        console.log('Processing new message:', tempMessage);

        // Only process messages if we have a selected session
        if (selectedSession) {
          // Check if message belongs to current session
          const isCurrentSessionMessage = 
            (selectedSession.user_id === tempMessage.sender_id && selectedSession.organisation_id === tempMessage.reciever_id) ||
            (selectedSession.user_id === tempMessage.reciever_id && selectedSession.organisation_id === tempMessage.sender_id);

          if (isCurrentSessionMessage) {
            // Check if message already exists to avoid duplicates
            const messageExists = messages.some(msg => 
              msg.created_at === tempMessage.created_at && 
              msg.sender_id === tempMessage.sender_id && 
              msg.reciever_id === tempMessage.reciever_id
            );

            if (!messageExists) {
              console.log('Adding new message to UI:', tempMessage);
              messages = [...messages, tempMessage];
            }
          }
        }

        // Show notification for new messages from users
        if (!tempMessage.isSender && 'Notification' in window) {
          Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
              const session = (activeTab === 'my-sessions' ? sessions : allSessions).find(s => 
                s.user_id === tempMessage.sender_id || s.user_id === tempMessage.reciever_id
              );
              
              if (session) {
                new Notification('New Message', {
                  body: `New message from ${session.user_id}`,
                  icon: '/chat-icon.png'
                });
              }
            }
          });
        }
      } else if (message.type === 'session_update') {
        // Handle session updates (new sessions, status changes, etc.)
        console.log('Session update received:', message);
        
        // Update sessions based on the update type
        if (message.updateType === 'new_session') {
          // Add new session to the appropriate list
          if (message.session.staff_id === currentUserId) {
            sessions = [...sessions, message.session];
          }
          if (isAdmin) {
            allSessions = [...allSessions, message.session];
          }
        } else if (message.updateType === 'session_assigned') {
          // Update session assignment
          const updateSession = (sessionList) => {
            return sessionList.map(s => 
              s.id === message.session.id ? { ...s, staff_id: message.session.staff_id } : s
            );
          };
          
          if (isAdmin) {
            allSessions = updateSession(allSessions);
          }
          sessions = updateSession(sessions);
        } else if (message.updateType === 'session_status') {
          // Update session status
          const updateStatus = (sessionList) => {
            return sessionList.map(s => 
              s.id === message.session.id ? { ...s, status: message.session.status } : s
            );
          };
          
          if (isAdmin) {
            allSessions = updateStatus(allSessions);
          }
          sessions = updateStatus(sessions);
        }

        // If the updated session is currently selected, update the UI
        if (selectedSession && selectedSession.id === message.session.id) {
          selectedSession = { ...selectedSession, ...message.session };
        }
      } else if (message.type === 'error') {
        console.error('Error from server:', message);
        messagesError = message.message;
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      messagesError = 'Connection error';
      clearTimeout(heartbeatTimeout);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      clearTimeout(heartbeatTimeout);
      // Attempt to reconnect after 5 seconds
      setTimeout(() => {
        console.log('Attempting to reconnect...');
        initializeWebSocket(currentUserId, currentOrganizationId);
      }, 5000);
    };
  }

  async function handleSessionSelect(session) {
    selectedSession = session;
    await fetchMessages(session.user_id, session.organisation_id);
    // Only initialize WebSocket if it's not already connected
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      initializeWebSocket(session.user_id, session.organisation_id);
    }
  }

  let cleanup = () => {
    if (ws) {
      ws.close();
    }
  };

  onMount(() => {
    (async () => {
      try {
        if (!clerk) {
          clerk = new Clerk(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
          await clerk.load();
        }
        
        const user = clerk.user;
        if (!user) {
          window.location.href = '/';
          return;
        }

        const organization = await clerk.organization;
        if (!organization) {
          error = 'No organization found';
          loading = false;
          return;
        }

        isAdmin = await checkAdminStatus(user, organization.id);
        await Promise.all([
          fetchMySessions(user.id, organization.id),
          isAdmin ? fetchAllSessions(organization.id) : Promise.resolve()
        ]);

        loading = false;
      } catch (err) {
        console.error('Error initializing:', err);
        error = 'Failed to initialize';
        loading = false;
        window.location.href = '/';
      }
    })();

    return cleanup;
  });

  async function handleSignOut() {
    try {
      await clerk.signOut();
      window.location.href = '/';
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }

  function handleHome() {
    window.location.href = '/';
  }

  function handleTabChange(tab) {
    activeTab = tab;
  }

  async function handleSendMessage() {
    if (!newMessage.trim() || !selectedSession) return;

    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const messageContent = newMessage.trim();
        const messageData = {
          type: 'message',
          senderId: selectedSession.organisation_id,
          recieverId: selectedSession.user_id,
          content: messageContent
        };

        console.log('Sending message:', messageData);

        // Create a temporary message for immediate UI update
        const tempMessage = {
          sender_id: messageData.senderId,
          reciever_id: messageData.recieverId,
          message: messageData.content,
          type: 'text',
          created_at: new Date().toISOString(),
          isSender: true,
          status: 'sending'
        };

        // Immediately update UI
        messages = [...messages, tempMessage];
        newMessage = '';

        // Send through WebSocket
        ws.send(JSON.stringify(messageData));
      } else {
        console.error('WebSocket is not connected');
        messagesError = 'Connection error';
        // Attempt to reconnect
        if (selectedSession) {
          initializeWebSocket(selectedSession.user_id, selectedSession.organisation_id);
        }
      }
    } catch (err) {
      console.error('Error in handleSendMessage:', err);
      messagesError = 'Failed to send message';
    }
  }

  function handleKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
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
</script>

<main>
  <div class="container">
    <div class="header">
      <h1>Sessions</h1>
      <div class="header-buttons">
        <button class="home-button" on:click={handleHome}>Home</button>
        <button class="sign-out-button" on:click={handleSignOut}>Sign Out</button>
      </div>
    </div>

    <div class="nav-tabs">
      <button 
        class="tab-button {activeTab === 'my-sessions' ? 'active' : ''}"
        on:click={() => handleTabChange('my-sessions')}
      >
        My Sessions
      </button>
      {#if isAdmin}
        <button 
          class="tab-button {activeTab === 'sessions' ? 'active' : ''}"
          on:click={() => handleTabChange('sessions')}
        >
          Sessions
        </button>
      {/if}
    </div>

    <div class="content-wrapper">
      <div class="sessions-panel">
        {#if loading}
          <div class="loading">Loading sessions...</div>
        {:else if error}
          <div class="error">{error}</div>
        {:else if (activeTab === 'my-sessions' ? sessions : allSessions).length === 0}
          <div class="no-sessions">No sessions found</div>
        {:else}
          <div class="sessions-list">
            {#each (activeTab === 'my-sessions' ? sessions : allSessions) as session}
              <div 
                class="session-card {selectedSession?.id === session.id ? 'selected' : ''}"
                on:click={() => handleSessionSelect(session)}
              >
                <div class="session-info">
                  <p class="session-user">{session.user_id}</p>
                  <p class="session-status">Status: {session.status}</p>
                  <div class="session-meta">
                    <span class="session-time">{new Date(session.created_at).toLocaleString()}</span>
                    {#if session.last_message}
                      <span class="session-preview">{session.last_message}</span>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="messages-panel">
        {#if !selectedSession}
          <div class="no-selection">Select a session to view messages</div>
        {:else}
          <div class="session-id-bar">
            <span>{selectedSession.user_id}</span>
            <span class="status-badge">{selectedSession.status}</span>
          </div>
          <div class="chat-container">
            <div class="chat-messages" bind:this={chatMessagesContainer}>
              {#if messagesLoading}
                <div class="loading">Loading messages...</div>
              {:else if messagesError}
                <div class="error">{messagesError}</div>
              {:else}
                {#each messages as message}
                  <div class="message {message.sender_id === currentOrganizationId ? 'sent' : 'received'}">
                    <p>{message.message}</p>
                  </div>
                {/each}
              {/if}
            </div>
            <div class="chat-input">
              <input 
                type="text" 
                bind:value={newMessage}
                on:keydown={handleKeyPress}
                placeholder="Type a message..."
              >
              <button on:click={handleSendMessage}>Send</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</main>

<style>
  .container {
    padding: 2rem;
    height: 100vh;
    box-sizing: border-box;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  .nav-tabs {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid #dee2e6;
    padding-bottom: 0.5rem;
  }

  .tab-button {
    background: none;
    border: none;
    padding: 0.5rem 1rem;
    color: #666;
    font-size: 1rem;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .tab-button:hover {
    color: #007bff;
  }

  .tab-button.active {
    color: #007bff;
    font-weight: 500;
  }

  .tab-button.active::after {
    content: '';
    position: absolute;
    bottom: -0.5rem;
    left: 0;
    width: 100%;
    height: 2px;
    background-color: #007bff;
  }

  .content-wrapper {
    display: flex;
    gap: 2rem;
    height: calc(100vh - 200px);
    padding: 0 1rem;
    width: 100%;
  }

  .sessions-panel {
    flex: 0 0 300px; /* Fixed width, no growing or shrinking */
    overflow-y: auto;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    padding: 1rem;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .sessions-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    overflow-y: auto;
    flex: 1;
  }

  .session-card {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 1.5rem;
    transition: all 0.2s;
    cursor: pointer;
    border: 1px solid #dee2e6;
    position: relative;
  }

  .session-card:hover {
    background: #e9ecef;
    transform: translateY(-2px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .session-card.selected {
    background: #e3f2fd;
    border-left: 4px solid #007bff;
  }

  .session-info {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .session-user {
    font-weight: 500;
    color: #333;
    margin: 0;
    font-size: 1.1rem;
  }

  .session-status {
    color: #666;
    font-size: 0.9rem;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .session-status::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #28a745;
  }

  .session-status.pending::before {
    background: #ffc107;
  }

  .session-status.closed::before {
    background: #dc3545;
  }

  .session-meta {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid #dee2e6;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .session-time {
    color: #666;
    font-size: 0.8rem;
  }

  .session-preview {
    color: #666;
    font-size: 0.9rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Scrollbar styling for sessions panel */
  .sessions-panel::-webkit-scrollbar {
    width: 6px;
  }

  .sessions-panel::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
  }

  .sessions-panel::-webkit-scrollbar-thumb {
    background: #c1c1c1;
    border-radius: 3px;
  }

  .sessions-panel::-webkit-scrollbar-thumb:hover {
    background: #a8a8a8;
  }

  .messages-panel {
    flex: 1; /* Takes remaining space */
    display: flex;
    flex-direction: column;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    height: 100%;
    overflow: hidden;
    min-width: 0;
  }

  .session-card {
    cursor: pointer;
  }

  .session-card.selected {
    background: #e3f2fd;
    border-left: 4px solid #007bff;
  }

  .sessions-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .session-card {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 1.5rem;
    transition: all 0.2s;
  }

  .session-card:hover {
    background: #e9ecef;
  }

  .session-info p {
    margin: 0.5rem 0;
    color: #333;
    font-size: 0.9rem;
  }

  .session-status {
    font-weight: 500;
  }

  h1 {
    color: #333;
    margin: 0;
    font-size: 2rem;
  }

  .header-buttons {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .home-button {
    background-color: #007bff;
    color: white;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    transition: background-color 0.2s;
  }

  .home-button:hover {
    background-color: #0056b3;
  }

  .sign-out-button {
    background-color: #dc3545;
    color: white;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    transition: background-color 0.2s;
  }

  .sign-out-button:hover {
    background-color: #c82333;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: #666;
  }

  .error {
    text-align: center;
    padding: 2rem;
    color: #dc3545;
    background: #f8d7da;
    border-radius: 4px;
  }

  .no-sessions {
    text-align: center;
    padding: 2rem;
    color: #666;
    font-style: italic;
  }

  .messages-container {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .messages-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0;
  }

  .message-card {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 1rem;
    max-width: 80%;
    margin: 0;
  }

  .message-card.sent {
    background: #e3f2fd;
    margin-left: auto;
  }

  .message-card.received {
    background: #f8f9fa;
    margin-right: auto;
  }

  .message-content {
    margin: 0;
    color: #333;
    font-size: 0.95rem;
    line-height: 1.4;
  }

  .message-timestamp {
    margin: 0.5rem 0 0;
    color: #666;
    font-size: 0.8rem;
  }

  .no-selection {
    text-align: center;
    padding: 2rem;
    color: #666;
    font-style: italic;
  }

  .no-messages {
    text-align: center;
    padding: 2rem;
    color: #666;
    font-style: italic;
  }

  .session-id-bar {
    background: #f8f9fa;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #dee2e6;
    margin-bottom: 1rem;
    font-weight: 500;
    color: #333;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .status-badge {
    background: #e3f2fd;
    color: #007bff;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  .message-input-bar {
    display: flex;
    gap: 1rem;
    padding: 1rem;
    background: #f8f9fa;
    border-top: 1px solid #dee2e6;
  }

  .message-input-bar input {
    flex: 1;
    padding: 0.75rem;
    border: 1px solid #dee2e6;
    border-radius: 4px;
    font-size: 0.95rem;
  }

  .message-input-bar input:focus {
    outline: none;
    border-color: #007bff;
  }

  .message-input-bar button {
    background: #007bff;
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.95rem;
    transition: background-color 0.2s;
  }

  .message-input-bar button:hover {
    background: #0056b3;
  }

  .chat-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: white;
    border-radius: 8px;
    height: 100%;
    overflow: hidden;
    min-width: 0;
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: calc(100% - 80px);
    min-width: 0;
  }

  .chat-input {
    display: flex;
    gap: 1rem;
    padding: 1rem;
    background: #f8f9fa;
    border-top: 1px solid #dee2e6;
    min-width: 0;
    width: 100%;
  }

  .chat-input input {
    flex: 1;
    padding: 0.75rem;
    border: 1px solid #dee2e6;
    border-radius: 4px;
    font-size: 0.95rem;
    min-width: 0;
    width: 100%;
  }

  .chat-input button {
    background: #007bff;
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.95rem;
    transition: background-color 0.2s;
    white-space: nowrap;
    min-width: 80px;
  }

  .message {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 0.5rem;
    max-width: 85%;
    position: relative;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .message.sent {
    background: #e3f2fd;
    margin-left: auto;
  }

  .message.received {
    background: #f8f9fa;
    margin-right: auto;
  }

  .message p {
    margin: 0;
    color: #333;
    font-size: 0.95rem;
    line-height: 1.4;
    word-wrap: break-word;
  }

  /* Scrollbar styling */
  ::-webkit-scrollbar {
    width: 8px;
  }

  ::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb {
    background: #c1c1c1;
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: #a8a8a8;
  }
</style> 