require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

// Debug logging for environment variables
console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY);

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials. Please check your .env file');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
app.use(cors());
app.use(express.json());

// Endpoint to get chat history between two users
app.get('/messages/:userId1/:userId2', async (req, res) => {
    try {
        const { userId1, userId2 } = req.params;
        console.log(`Fetching messages between ${userId1} and ${userId2}`);
        
        // Get messages where either user is sender or receiver
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .or(`sender_id.eq.${userId1},sender_id.eq.${userId2}`)
            .or(`reciever_id.eq.${userId1},reciever_id.eq.${userId2}`)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching messages:', error);
            return res.status(500).json({ error: 'Failed to fetch messages' });
        }

        // Filter messages to only include direct messages between these two users
        const chatMessages = data.filter(msg => 
            (msg.sender_id === userId1 && msg.reciever_id === userId2) ||
            (msg.sender_id === userId2 && msg.reciever_id === userId1)
        );

        console.log(`Found ${chatMessages.length} messages`);
        res.json(chatMessages);
    } catch (error) {
        console.error('Error in /messages endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store connected clients and their status
const clients = new Map();
const userStatus = new Map(); // Track user online/offline status
const heartbeatInterval = 30000; // 30 seconds

// Set up real-time subscription for messages with error handling and reconnection
let messagesSubscription;
function setupMessagesSubscription() {
    messagesSubscription = supabase
        .channel('messages')
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'messages'
            },
            async (payload) => {
                console.log('New message from database:', payload);
                
                // Forward the new message to both sender and receiver if they're connected
                const senderWs = clients.get(payload.new.sender_id);
                const receiverWs = clients.get(payload.new.reciever_id);
                
                console.log('Connected clients:', Array.from(clients.keys()));
                console.log('Sender connected:', !!senderWs);
                console.log('Receiver connected:', !!receiverWs);
                
                const messageData = {
                    type: 'message',
                    senderId: payload.new.sender_id,
                    recieverId: payload.new.reciever_id,
                    content: payload.new.message,
                    timestamp: payload.new.created_at,
                    notification: {
                        title: 'New Message',
                        body: payload.new.message,
                        icon: '/path/to/icon.png'
                    }
                };

                // Send to sender with isSender=true and delivery status
                if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                    console.log(`Sending to sender ${payload.new.sender_id}`);
                    senderWs.send(JSON.stringify({
                        ...messageData,
                        status: 'sent',
                        isSender: true
                    }));
                }

                // Send to receiver with isSender=false and notification
                if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
                    console.log(`Sending to receiver ${payload.new.reciever_id}`);
                    receiverWs.send(JSON.stringify({
                        ...messageData,
                        status: 'received',
                        isSender: false,
                        notification: {
                            ...messageData.notification,
                            title: `Message from ${payload.new.sender_id}`
                        }
                    }));
                } else {
                    console.log(`Receiver ${payload.new.reciever_id} not connected or connection not open`);
                    userStatus.set(payload.new.reciever_id, 'offline');
                }
            }
        )
        .subscribe((status) => {
            console.log('Subscription status:', status);
            if (status === 'SUBSCRIBED') {
                console.log('Successfully subscribed to messages channel');
            } else if (status === 'CHANNEL_ERROR') {
                console.error('Error subscribing to messages channel');
                // Attempt to reconnect after a delay
                setTimeout(setupMessagesSubscription, 5000);
            }
        });
}

// Initial subscription setup
setupMessagesSubscription();

wss.on('connection', (ws) => {
    console.log('New client connected');
    let userId = null;
    let heartbeatInterval;

    // Set up heartbeat for this connection
    function startHeartbeat() {
        heartbeatInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, heartbeatInterval);
    }

    // Handle initial connection with user ID
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message:', data);

            // Handle ping messages
            if (data.type === 'pong') {
                return;
            }

            // Handle initial connection message
            if (data.type === 'connect') {
                console.log(`Client ${data.userId} connected`);
                userId = data.userId;
                clients.set(userId, ws);
                userStatus.set(userId, 'online');
                startHeartbeat();
                console.log('Current connected clients:', Array.from(clients.keys()));
                
                // Notify other users about this user's online status
                broadcastUserStatus(userId, 'online');
                return;
            }

            // Handle chat message
            if (data.type === 'message') {
                console.log(`Storing message from ${data.senderId} to ${data.recieverId}`);
                
                // First, send acknowledgment to sender
                ws.send(JSON.stringify({
                    type: 'status',
                    messageId: Date.now(),
                    status: 'sending'
                }));

                // Store message in Supabase
                const { data: savedMessage, error } = await supabase
                    .from('messages')
                    .insert([
                        {
                            sender_id: data.senderId,
                            reciever_id: data.recieverId,
                            message: data.content,
                            type: 'text'
                        }
                    ])
                    .select()
                    .single();

                if (error) {
                    console.error('Error storing message in Supabase:', error);
                    // Send error back to sender
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Failed to send message',
                        originalMessage: data
                    }));
                    return;
                }

                console.log('Message stored successfully:', savedMessage);

                // Send success status to sender
                ws.send(JSON.stringify({
                    type: 'status',
                    messageId: Date.now(),
                    status: 'sent'
                }));

                // Forward message to receiver if connected
                const receiverWs = clients.get(data.recieverId);
                if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
                    receiverWs.send(JSON.stringify({
                        type: 'message',
                        senderId: data.senderId,
                        recieverId: data.recieverId,
                        content: data.content,
                        timestamp: savedMessage.created_at,
                        status: 'received',
                        isSender: false,
                        notification: {
                            title: `Message from ${data.senderId}`,
                            body: data.content,
                            icon: '/path/to/icon.png'
                        }
                    }));
                }
            }

            // Handle message status updates
            if (data.type === 'status') {
                const receiverWs = clients.get(data.recieverId);
                if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
                    receiverWs.send(JSON.stringify({
                        type: 'status',
                        messageId: data.messageId,
                        status: data.status
                    }));
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Internal server error',
                    details: error.message
                }));
            }
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }
        // Remove client from the connected clients map
        if (userId) {
            console.log(`Client ${userId} disconnected`);
            clients.delete(userId);
            userStatus.set(userId, 'offline');
            console.log('Remaining connected clients:', Array.from(clients.keys()));
            // Notify other users about this user's offline status
            broadcastUserStatus(userId, 'offline');
        }
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        if (userId) {
            userStatus.set(userId, 'offline');
            broadcastUserStatus(userId, 'offline');
        }
    });
});

// Function to broadcast user status changes
function broadcastUserStatus(userId, status) {
    const statusMessage = {
        type: 'status',
        userId: userId,
        status: status
    };

    // Broadcast to all connected clients
    clients.forEach((client, id) => {
        if (id !== userId && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(statusMessage));
        }
    });
}

const PORT = 8000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
}); 