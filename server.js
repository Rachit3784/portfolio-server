// D:\Portfolio\Rachit-Portfolio-server\server.js
// Central Node.js Socket.io + WebRTC Signaling Server (With Call Busy Handling & Notification Events)
require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors     = require('cors');

const app    = express();
const server = http.createServer(app);

const PORT           = process.env.PORT || 5000;
const MONGODB_URI    = process.env.MONGODB_URI;
const ADMIN_EMAIL    = (process.env.ADMIN_EMAIL || 'grachit736@gmail.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'rachit123456';

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

/* ── Socket.io Setup ── */
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

/* ── MongoDB Connection ── */
mongoose
  .connect(MONGODB_URI, { bufferCommands: false })
  .then(() => console.log('✅ Connected to MongoDB Atlas (portfoliodb)'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

/* ── Schemas ── */
const ChatUserSchema = new mongoose.Schema(
  {
    name:       { type: String, required: true, trim: true },
    email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
    lastActive: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const ChatMessageSchema = new mongoose.Schema(
  {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'ChatUser', required: true, index: true },
    role:     { type: String, enum: ['user', 'admin'], required: true },
    type:     { type: String, enum: ['text', 'image', 'pdf'], default: 'text' },
    content:  { type: String, default: '' },
    fileName: { type: String, default: null },
    fileSize: { type: Number, default: null },
  },
  { timestamps: true }
);

const ChatUser    = mongoose.models.ChatUser || mongoose.model('ChatUser', ChatUserSchema);
const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', ChatMessageSchema);

/* ── Active WebRTC Calls Map (userId -> peerId) ── */
const activeCalls = new Map(); // tracks who is in an active call

/* ── HTTP API Routes ── */
app.get('/', (req, res) => {
  res.json({ status: 'Central Socket.io + WebRTC Server Active', port: PORT });
});

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  if (email.trim().toLowerCase() === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({
      success: true,
      admin: { email: ADMIN_EMAIL, name: 'Rachit Gupta (Super Admin)', role: 'super_admin' },
    });
  }
  return res.status(401).json({ error: 'Invalid Admin credentials' });
});

// Recruiter Auth Check
app.post('/api/auth/check-user', async (req, res) => {
  try {
    const { email, name, create } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedEmail === ADMIN_EMAIL) {
      return res.status(403).json({ error: 'This email is reserved for Super Admin login only.' });
    }

    if (create) {
      if (!name || name.trim().length < 2) {
        return res.status(400).json({ error: 'Name must be at least 2 characters' });
      }
      let user = await ChatUser.findOne({ email: normalizedEmail });
      if (!user) {
        user = await ChatUser.create({ email: normalizedEmail, name: name.trim() });
      }
      return res.json({ exists: true, user: { id: user._id, name: user.name, email: user.email } });
    }

    const user = await ChatUser.findOne({ email: normalizedEmail });
    if (user) {
      user.lastActive = new Date();
      await user.save();
      return res.json({ exists: true, user: { id: user._id, name: user.name, email: user.email } });
    }

    return res.json({ exists: false });

  } catch (err) {
    console.error('[check-user error]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Recruiter sends a message
app.post('/api/chat/send', async (req, res) => {
  try {
    const { userId, type, content, fileName, fileSize } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const msgDoc = await ChatMessage.create({
      userId,
      role: 'user',
      type: type || 'text',
      content: content || '',
      fileName: fileName || null,
      fileSize: fileSize || null,
    });

    io.to('admin_room').emit('new_recruiter_message', { userId, message: msgDoc });
    io.to(`user_${userId}`).emit('new_message', msgDoc);

    return res.json({ message: msgDoc });

  } catch (err) {
    console.error('[chat/send error]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Get users for Admin
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await ChatUser.find({ email: { $ne: ADMIN_EMAIL } }).sort({ updatedAt: -1 }).lean();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get chat history
app.get('/api/chat/history', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const user = await ChatUser.findById(userId);
    const messages = await ChatMessage.find({ userId }).sort({ createdAt: 1 }).lean();
    res.json({ user, messages });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Socket.io Events ── */
io.on('connection', (socket) => {
  console.log(`⚡ Client connected: ${socket.id}`);

  socket.on('join_room', ({ userId, role }) => {
    if (!userId) return;
    if (role === 'admin') {
      socket.join('admin_room');
      socket.userId = 'admin';
      console.log(`👑 Super Admin joined: admin_room`);
    } else {
      socket.join(`user_${userId}`);
      socket.userId = userId;
      console.log(`👤 Recruiter joined: user_${userId}`);
    }
  });

  socket.on('user_send_message', async (data) => {
    try {
      const { userId, message } = data;
      io.to(`user_${userId}`).emit('new_message', message);
      io.to('admin_room').emit('new_recruiter_message', { userId, message });
    } catch (err) {
      console.error('[user_send_message error]', err);
    }
  });

  socket.on('admin_send_message', async (data) => {
    try {
      const { userId, message } = data;
      const msgDoc = await ChatMessage.create({
        userId,
        role:    'admin',
        type:    message.type || 'text',
        content: message.content || '',
      });

      io.to(`user_${userId}`).emit('admin_reply', msgDoc);
      io.to('admin_room').emit('admin_reply_sent', { userId, message: msgDoc });
    } catch (err) {
      console.error('[admin_send_message error]', err);
    }
  });

  /* ── WebRTC Video Call Signaling Events (With Busy Check) ── */
  socket.on('call_user', ({ userToCall, signalData, from, name }) => {
    const target = userToCall ? userToCall.toString() : 'admin';
    const caller = from ? from.toString() : 'user';

    console.log(`📹 WebRTC call attempt from ${name} (${caller}) -> ${target}`);

    // Check if target is already in an active call
    if (activeCalls.has(target)) {
      console.log(`⚠️ Call rejected: ${target} is currently busy`);
      socket.emit('user_busy', {
        message: 'The person you are calling is currently busy on another video call. Please try again later.',
      });
      return;
    }

    // Mark caller as calling target
    activeCalls.set(caller, target);

    if (target === 'admin') {
      io.to('admin_room').emit('incoming_call', { signal: signalData, from: caller, name });
    } else {
      io.to(`user_${target}`).emit('incoming_call', { signal: signalData, from: caller, name });
    }
  });

  socket.on('answer_call', ({ to, signal }) => {
    const target = to ? to.toString() : 'admin';
    console.log(`📞 WebRTC answer_call to: ${target}`);
    if (socket.userId) activeCalls.set(socket.userId.toString(), target);

    if (target === 'admin') {
      io.to('admin_room').emit('call_accepted', signal);
    } else {
      io.to(`user_${target}`).emit('call_accepted', signal);
    }
  });

  socket.on('ice_candidate', ({ to, candidate }) => {
    if (to === 'admin') {
      io.to('admin_room').emit('ice_candidate', candidate);
    } else {
      io.to(`user_${to}`).emit('ice_candidate', candidate);
    }
  });

  socket.on('end_call', ({ to }) => {
    console.log(`🔴 WebRTC end_call for: ${to}`);
    if (socket.userId) activeCalls.delete(socket.userId);
    if (to) activeCalls.delete(to);

    if (to === 'admin') {
      io.to('admin_room').emit('call_ended');
    } else {
      io.to(`user_${to}`).emit('call_ended');
    }
  });

  socket.on('disconnect', () => {
    if (socket.userId) activeCalls.delete(socket.userId);
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

/* ── Start Server ── */
server.listen(PORT, () => {
  console.log(`🚀 Standalone Socket.io + WebRTC Server running on port ${PORT}`);
});
