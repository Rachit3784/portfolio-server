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
    name:           { type: String, required: true, trim: true },
    email:          { type: String, required: true, unique: true, lowercase: true, trim: true },
    activeDeviceId: { type: String, default: null },
    notificationId: { type: String, default: null },
    lastActive:     { type: Date, default: Date.now },
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

/* ── Active WebRTC Calls Map (userId -> peerId) & Active Admin Device ── */
const activeCalls = new Map(); // tracks who is in an active call
let adminActiveDeviceId = null;
let adminNotificationId = null;

/* ── HTTP API Routes ── */
app.get('/', (req, res) => {
  res.json({ status: 'Central Socket.io + WebRTC Server Active', port: PORT });
});

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { email, password, deviceId, notificationId } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  if (email.trim().toLowerCase() === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    // Single active device session for Admin
    if (adminActiveDeviceId && adminActiveDeviceId !== deviceId) {
      console.log(`⚠️ Admin logged in from another device (${deviceId}). Invalidating previous admin device (${adminActiveDeviceId}).`);
      io.to('admin_room').emit('admin_session_invalidated', {
        invalidatedDeviceId: adminActiveDeviceId,
        newDeviceId: deviceId,
        message: 'Admin session logged in on another device or browser. Session cleared.',
      });
    }
    if (deviceId) adminActiveDeviceId = deviceId;
    if (notificationId) adminNotificationId = notificationId;

    return res.json({
      success: true,
      admin: { email: ADMIN_EMAIL, name: 'Rachit Gupta (Super Admin)', role: 'super_admin', deviceId },
    });
  }
  return res.status(401).json({ error: 'Invalid Admin credentials' });
});

// Recruiter Auth Check
app.post('/api/auth/check-user', async (req, res) => {
  try {
    const { email, name, create, deviceId, notificationId } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedEmail === ADMIN_EMAIL) {
      return res.status(403).json({ error: 'This email is reserved for Super Admin login only.' });
    }

    let user = await ChatUser.findOne({ email: normalizedEmail });

    if (create) {
      if (!name || name.trim().length < 2) {
        return res.status(400).json({ error: 'Name must be at least 2 characters' });
      }
      if (!user) {
        user = await ChatUser.create({
          email: normalizedEmail,
          name: name.trim(),
          activeDeviceId: deviceId || null,
          notificationId: notificationId || null,
        });
      }
    }

    if (user) {
      // Check if logged in on another device/browser
      if (user.activeDeviceId && deviceId && user.activeDeviceId !== deviceId) {
        console.log(`⚠️ Email ${normalizedEmail} opened on new device (${deviceId}). Clearing previous device (${user.activeDeviceId}).`);
        io.to(`user_${user._id}`).emit('session_invalidated', {
          userId: user._id,
          email: user.email,
          invalidatedDeviceId: user.activeDeviceId,
          newDeviceId: deviceId,
          message: 'Your session has been opened in another browser/device. Please allow notifications & login again if you want to switch back.',
        });
      }

      // Attach new active device & notification ID, deleting old ones
      user.activeDeviceId = deviceId || user.activeDeviceId;
      user.notificationId = notificationId || user.notificationId;
      user.lastActive = new Date();
      await user.save();

      return res.json({
        exists: true,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          activeDeviceId: user.activeDeviceId,
          notificationId: user.notificationId,
        },
      });
    }

    return res.json({ exists: false });

  } catch (err) {
    console.error('[check-user error]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Logout endpoint to clear session & notification ID in MongoDB
app.post('/api/auth/logout', async (req, res) => {
  try {
    const { email, deviceId } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = email.trim().toLowerCase();
    const user = await ChatUser.findOne({ email: normalizedEmail });
    if (user) {
      if (!deviceId || user.activeDeviceId === deviceId) {
        user.activeDeviceId = null;
        user.notificationId = null;
        await user.save();
        console.log(`🚪 Session & Notification ID cleared in DB for email: ${normalizedEmail}`);
      }
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('[logout error]', err);
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

  socket.on('join_room', async ({ userId, role, deviceId, notificationId }) => {
    if (!userId) return;
    socket.deviceId = deviceId;

    if (role === 'admin') {
      socket.join('admin_room');
      socket.userId = 'admin';
      console.log(`👑 Super Admin joined: admin_room (Device: ${deviceId})`);

      if (adminActiveDeviceId && deviceId && adminActiveDeviceId !== deviceId) {
        socket.emit('admin_session_invalidated', {
          invalidatedDeviceId: deviceId,
          message: 'Another admin session is active on a different device.',
        });
      }
    } else {
      socket.join(`user_${userId}`);
      socket.userId = userId;
      console.log(`👤 Recruiter joined: user_${userId} (Device: ${deviceId})`);

      // Verify active device in DB
      try {
        const dbUser = await ChatUser.findById(userId);
        if (dbUser && dbUser.activeDeviceId && deviceId && dbUser.activeDeviceId !== deviceId) {
          console.log(`⚠️ Socket device mismatch for user_${userId}. Emitting session_invalidated to socket ${socket.id}`);
          socket.emit('session_invalidated', {
            userId: dbUser._id,
            email: dbUser.email,
            invalidatedDeviceId: deviceId,
            newDeviceId: dbUser.activeDeviceId,
            message: 'Session active on another device.',
          });
        }
      } catch (e) {
        console.error('[join_room check error]', e);
      }
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
