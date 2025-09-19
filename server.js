require("dotenv").config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'gamezone-jwt-secret-key'; // Use environment variable

// Middleware
app.use(cors({
  origin: ['http://127.0.0.1:5500', 'http://127.0.0.1:5501', 'http://localhost:3000', 'http://localhost:5500', 'https://gamezone-liv5.onrender.com'],
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(bodyParser.json());

// Serve static files
app.use(express.static(path.join(__dirname)));

// MongoDB connection
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/gamezone';
mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('MongoDB connected successfully');
  await createDefaultAdmin();
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// User Schema
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  gamesPlayed: { type: Number, default: 0 },
  differentGames: { type: Number, default: 0 },
  totalReward: { type: Number, default: 0 },
  gamesPlayedTypes: { type: [String], default: [] },
  rank: { type: Number, default: 1 }
});

const User = mongoose.model('User', userSchema);

// Leaderboard Timer Schema
const leaderboardTimerSchema = new mongoose.Schema({
  endTime: { type: Number, required: true }
});

const LeaderboardTimer = mongoose.model('LeaderboardTimer', leaderboardTimerSchema);

// Global leaderboard timer
let leaderboardEndTime = null;
let resetTimeout = null;
const RESET_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Initialize leaderboard timer - load from DB if exists, otherwise start fresh 12 hours
async function initializeLeaderboardTimer() {
  try {
    const existingTimer = await LeaderboardTimer.findOne({});
    if (existingTimer && existingTimer.endTime > Date.now()) {
      leaderboardEndTime = existingTimer.endTime;
      console.log('Leaderboard timer loaded from DB:', new Date(leaderboardEndTime).toISOString());
    } else {
      // Start fresh 24 hours if no valid timer exists
      leaderboardEndTime = Date.now() + RESET_INTERVAL;
      await LeaderboardTimer.findOneAndUpdate({}, { endTime: leaderboardEndTime }, { upsert: true });
      console.log('Leaderboard timer initialized with fresh 24 hours');
    }
    // Schedule the reset
    scheduleLeaderboardReset();
  } catch (error) {
    console.error('Error initializing leaderboard timer:', error);
    leaderboardEndTime = Date.now() + RESET_INTERVAL;
    scheduleLeaderboardReset();
  }
}

async function resetLeaderboardTimer() {
  try {
    leaderboardEndTime = Date.now() + RESET_INTERVAL;
    await LeaderboardTimer.findOneAndUpdate({}, { endTime: leaderboardEndTime }, { upsert: true });
    // Schedule the next reset
    scheduleLeaderboardReset();
  } catch (error) {
    console.error('Error resetting leaderboard timer:', error);
  }
}

// Schedule leaderboard reset using setTimeout for precise timing
function scheduleLeaderboardReset() {
  if (resetTimeout) {
    clearTimeout(resetTimeout);
  }

  const now = Date.now();
  const timeUntilReset = leaderboardEndTime - now;

  if (timeUntilReset <= 0) {
    // Timer has already expired, reset immediately
    performLeaderboardReset();
  } else {
    // Schedule the reset
    resetTimeout = setTimeout(async () => {
      await performLeaderboardReset();
    }, timeUntilReset);

    console.log(`Leaderboard reset scheduled in ${Math.ceil(timeUntilReset / 1000 / 60)} minutes`);
  }
}

// Perform the actual leaderboard reset
async function performLeaderboardReset() {
  try {
    console.log('Performing leaderboard reset...');

    // Reset all user stats to zero
    await User.updateMany({}, {
      gamesPlayed: 0,
      differentGames: 0,
      totalReward: 0,
      gamesPlayedTypes: [],
      rank: 1
    });

    // Reset the timer for the next 24 hours
    await resetLeaderboardTimer();

    console.log('Leaderboard auto-reset completed and new timer started');
  } catch (error) {
    console.error('Auto-reset leaderboard error:', error);
    // Retry after 1 minute if there's an error
    setTimeout(() => performLeaderboardReset(), 60000);
  }
}

// API Routes

// Signup
app.post('/api/signup', async (req, res) => {
  try {
    const { userId, username, password } = req.body;
    console.log('Signup request body:', req.body);

    const existingUser = await User.findOne({ userId });
    if (existingUser) {
      return res.status(400).json({ error: 'User ID already exists' });
    }

    const newUser = new User({
      userId,
      username,
      password,
      isAdmin: false,
      gamesPlayed: 0,
      differentGames: 0,
      totalReward: 0
    });

    await newUser.save();

    const token = jwt.sign({ userId: newUser.userId }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Account created successfully', user: { userId, username, isAdmin: false }, token });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error during signup' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { userId, password } = req.body;

    const user = await User.findOne({ userId, password });

    if (user) {
      const token = jwt.sign({ userId: user.userId }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ message: 'Login successful', user: { userId: user.userId, username: user.username, isAdmin: user.isAdmin }, token });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});



// Get profile
app.get('/api/profile', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({ userId: decoded.userId });

    if (user) {
      res.json({ user: { userId: user.userId, username: user.username, isAdmin: user.isAdmin } });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Delete account
app.delete('/api/profile', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    await User.findOneAndDelete({ userId: decoded.userId });

    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Update user stats after playing a game
app.post('/api/update-stats', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({ userId: decoded.userId });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { reward, gameType } = req.body;

    // Update total reward
    user.totalReward += reward;

    // Update games played
    user.gamesPlayed += 1;

    // Update different games played
    if (!user.gamesPlayedTypes.includes(gameType)) {
      user.gamesPlayedTypes.push(gameType);
      user.differentGames = user.gamesPlayedTypes.length;
    }

    await user.save();
    res.json({ message: 'Stats updated successfully' });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const users = await User.find({});

    // Check if all users are inactive (all counts zero)
    const allInactive = users.every(user =>
      (user.gamesPlayed || 0) === 0 &&
      (user.differentGames || 0) === 0 &&
      (user.totalReward || 0) === 0
    );

    let rankedUsers;

    if (allInactive) {
      // All users rank 1
      rankedUsers = users.map(user => ({
        ...user.toObject(),
        rank: 1
      }));
    } else {
      // Separate active and inactive
      const activeUsers = users.filter(user =>
        (user.gamesPlayed || 0) > 0 ||
        (user.differentGames || 0) > 0 ||
        (user.totalReward || 0) > 0
      );
      const inactiveUsers = users.filter(user =>
        (user.gamesPlayed || 0) === 0 &&
        (user.differentGames || 0) === 0 &&
        (user.totalReward || 0) === 0
      );

      // Sort active users by totalReward descending
      activeUsers.sort((a, b) => (b.totalReward || 0) - (a.totalReward || 0));

      // Assign ranks to active users
      activeUsers.forEach((user, index) => {
        user.rank = index + 1;
      });

      // Assign ranks to inactive users
      const nextRank = activeUsers.length + 1;
      inactiveUsers.forEach(user => {
        user.rank = nextRank;
      });

      // Combine active and inactive
      rankedUsers = [...activeUsers, ...inactiveUsers];
    }

    // Map to leaderboard format
    const leaderboard = rankedUsers.map(user => ({
      rank: user.rank,
      username: user.username,
      gamesPlayed: user.gamesPlayed || 0,
      differentGames: user.differentGames || 0,
      totalCoins: user.totalReward || 0
    }));

    res.json({ leaderboard });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user stats for display on game pages
app.get('/api/user-stats', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({ userId: decoded.userId });

    if (user) {
      res.json({
        gamesPlayed: user.gamesPlayed || 0,
        differentGames: user.differentGames || 0,
        totalCoins: user.totalReward || 0,
        gamesPlayedTypes: user.gamesPlayedTypes || []
      });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Reset leaderboard stats and set all users rank 1
app.post('/api/reset-leaderboard', async (req, res) => {
  try {
    await User.updateMany({}, {
      gamesPlayed: 0,
      differentGames: 0,
      totalReward: 0,
      gamesPlayedTypes: [],
      rank: 1
    });
    resetLeaderboardTimer();

    res.json({ message: 'Leaderboard reset successfully, all users rank set to 1' });
  } catch (error) {
    console.error('Reset leaderboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current leaderboard timer
app.get('/api/leaderboard-timer', (req, res) => {
  if (!leaderboardEndTime) {
    initializeLeaderboardTimer();
  }
  res.json({ endTime: leaderboardEndTime });
});

// Admin get all users
app.get('/api/admin/users', async (req, res) => {
  console.log('Admin users endpoint called');
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Decoded token:', decoded);
    const adminUser = await User.findOne({ userId: decoded.userId });
    console.log('Admin user found:', adminUser);

    if (!adminUser || !adminUser.isAdmin) {
      console.log('Admin access denied');
      return res.status(403).json({ error: 'Admin access required' });
    }

    const users = await User.find({});
    console.log('Users found:', users.length);
    res.json({ users });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Admin get specific user
app.get('/api/admin/user/:userId', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const adminUser = await User.findOne({ userId: decoded.userId });

    if (!adminUser || !adminUser.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { userId } = req.params;
    const user = await User.findOne({ userId });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Admin delete user
app.delete('/api/admin/delete-user/:userId', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const adminUser = await User.findOne({ userId: decoded.userId });

    if (!adminUser || !adminUser.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { userId } = req.params;
    const userToDelete = await User.findOneAndDelete({ userId });

    if (!userToDelete) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Admin edit user
app.put('/api/admin/edit-user/:userId', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const adminUser = await User.findOne({ userId: decoded.userId });

    if (!adminUser || !adminUser.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { userId } = req.params;
    const { newUserId, username, isAdmin } = req.body;

    // Check if new userId already exists (if different from current)
    if (newUserId !== userId) {
      const existingUser = await User.findOne({ userId: newUserId });
      if (existingUser) {
        return res.status(400).json({ error: 'New User ID already exists' });
      }
    }

    const updatedUser = await User.findOneAndUpdate(
      { userId },
      {
        userId: newUserId,
        username,
        isAdmin
      },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User updated successfully', user: updatedUser });
  } catch (err) {
    console.error('Edit user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Function to create default admin user if not exists
async function createDefaultAdmin() {
  try {
    const adminUserId = 'admin';
    const adminPassword = 'admin123';
    const adminUsername = 'Administrator';

    const existingAdmin = await User.findOne({ userId: adminUserId });
    if (!existingAdmin) {
      const adminUser = new User({
        userId: adminUserId,
        username: adminUsername,
        password: adminPassword,
        isAdmin: true,
        gamesPlayed: 0,
        differentGames: 0,
        totalReward: 0,
        gamesPlayedTypes: [],
        rank: 1
      });
      await adminUser.save();
      console.log('Default admin user created with userId: admin and password: admin123');
    } else {
      console.log('Default admin user already exists');
    }
  } catch (error) {
    console.error('Error creating default admin user:', error);
  }
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  initializeLeaderboardTimer();
});
