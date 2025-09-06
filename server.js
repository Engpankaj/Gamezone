const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('cors');

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

function readUsers() {
  try {
    const data = fs.readFileSync('users.json', 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading users.json:', err);
    return [];
  }
}

function writeUsers(users) {
  try {
    fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('Error writing users.json:', err);
  }
}

// API Routes

// Signup
app.post('/api/signup', (req, res) => {
  try {
    const { userId, username, password } = req.body;
    console.log('Signup request body:', req.body);
    const users = readUsers();

    const existingUser = users.find(u => u.userId === userId);
    if (existingUser) {
      return res.status(400).json({ error: 'User ID already exists' });
    }

    const newUser = {
      userId,
      username,
      password,
      isAdmin: false,
      gamesPlayed: 0,
      differentGames: 0,
      totalReward: 0
    };

    users.push(newUser);
    writeUsers(users);

    const token = jwt.sign({ userId: newUser.userId }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Account created successfully', user: { userId, username, isAdmin: false }, token });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error during signup' });
  }
});

// Login
app.post('/api/login', (req, res) => {
  const { userId, password } = req.body;
  const users = readUsers();

  let user = users.find(u => u.userId === userId && u.password === password);

  if (user) {
    const token = jwt.sign({ userId: user.userId }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Login successful', user: { userId: user.userId, username: user.username, isAdmin: user.isAdmin }, token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
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
app.get('/api/profile', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = readUsers();
    const user = users.find(u => u.userId === decoded.userId);

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
app.delete('/api/profile', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = readUsers();
    const updatedUsers = users.filter(u => u.userId !== decoded.userId);
    writeUsers(updatedUsers);

    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Update user stats after playing a game
app.post('/api/update-stats', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = readUsers();
    const userIndex = users.findIndex(u => u.userId === decoded.userId);

    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { reward, gameType } = req.body;

    // Update total reward
    users[userIndex].totalReward += reward;

    // Update games played
    users[userIndex].gamesPlayed += 1;

    // Update different games played
    if (!users[userIndex].gamesPlayedTypes) {
      users[userIndex].gamesPlayedTypes = [];
    }
    if (!users[userIndex].gamesPlayedTypes.includes(gameType)) {
      users[userIndex].gamesPlayedTypes.push(gameType);
      users[userIndex].differentGames = users[userIndex].gamesPlayedTypes.length;
    }

    writeUsers(users);
    res.json({ message: 'Stats updated successfully' });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Get leaderboard
app.get('/api/leaderboard', (req, res) => {
  try {
    const users = readUsers();

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
        ...user,
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
app.get('/api/user-stats', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = readUsers();
    const user = users.find(u => u.userId === decoded.userId);

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
app.post('/api/reset-leaderboard', (req, res) => {
  try {
    const users = readUsers();

    // Reset all user stats and set rank 1
    users.forEach(user => {
      user.gamesPlayed = 0;
      user.differentGames = 0;
      user.totalReward = 0;
      user.gamesPlayedTypes = [];
      user.rank = 1; // Add rank property set to 1
    });

    writeUsers(users);
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
