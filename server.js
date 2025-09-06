const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'gamezone-jwt-secret-key'; // In production, use environment variable

// Middleware
app.use(cors({
  origin: ['http://127.0.0.1:5500', 'http://localhost:3000', 'http://localhost:5500'],
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(bodyParser.json());

// Serve static files
app.use(express.static(path.join(__dirname)));

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/gamezone', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
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

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logged out successfully' });
  });
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

    res.json({ message: 'Leaderboard reset successfully, all users rank set to 1' });
  } catch (error) {
    console.error('Reset leaderboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
