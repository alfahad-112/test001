const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect('mongodb://localhost/animeStreamingDB', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true, // Ensure unique index for username
    useFindAndModify: false, // Avoid deprecated warning
});

// Create a User model
const User = mongoose.model('User', {
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
});

// Create an Anime model
const Anime = mongoose.model('Anime', {
    title: { type: String, required: true },
    description: { type: String, required: true },
    episodes: [{ title: String, videoPath: String }],
});

// Passport.js setup
passport.use(new LocalStrategy(
    async function(username, password, done) {
        try {
            const user = await User.findOne({ username: username });

            if (!user) {
                return done(null, false, { message: 'Incorrect username.' });
            }

            const passwordMatch = await bcrypt.compare(password, user.password);

            if (!passwordMatch) {
                return done(null, false, { message: 'Incorrect password.' });
            }

            return done(null, user);
        } catch (error) {
            return done(error);
        }
    }
));

passport.serializeUser(function(user, done) {
    done(null, user.id);
});

passport.deserializeUser(function(id, done) {
    User.findById(id, function(err, user) {
        done(err, user);
    });
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({
    secret: 'secret-key',
    resave: false,
    saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());

// Multer setup for handling file uploads
const storage = multer.diskStorage({
    destination: './uploads',
    filename: function(req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Serve static files (uploaded videos)
app.use('/uploads', express.static('uploads'));

// User registration route with improved input validation
app.post('/register', [
    body('username').trim().isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/),
    body('password').trim().isLength({ min: 8 }).escape(),
], async (req, res) => {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const existingUser = await User.findOne({ username: req.body.username });

        if (existingUser) {
            return res.status(409).json({ message: 'Username already exists.' });
        }

        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const newUser = new User({ username: req.body.username, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ message: 'User registered successfully.' });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Anime list route
app.get('/api/animeList', async (req, res) => {
    try {
        const animeList = await Anime.find({}, 'title');
        res.json(animeList);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Video streaming route with token-based authentication
app.get('/video/:animeId/:episodeId', isAuthenticated, async (req, res) => {
    const animeId = req.params.animeId;
    const episodeId = req.params.episodeId;

    try {
        const anime = await Anime.findById(animeId);

        if (!anime) {
            return res.status(404).json({ error: 'Anime not found.' });
        }

        const episode = anime.episodes.id(episodeId);

        if (!episode) {
            return res.status(404).json({ error: 'Episode not found.' });
        }

        // Check if the user has access to the requested episode
        // Implement your logic to check user permissions here

        // If authorized, generate a token and send the video file
        const token = jwt.sign({ userId: req.user._id, animeId, episodeId }, 'your-secret-key', { expiresIn: '1h' });
        res.sendFile(__dirname + `/uploads/${episode.videoPath}`, {
            headers: {
                'x-auth-token': token,
            },
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Login route
app.post('/login',
    passport.authenticate('local', { successRedirect: '/dashboard', failureRedirect: '/' })
);

// Logout route
app.get('/logout', (req, res) => {
    req.logout();
    res.redirect('/');
});

// Middleware to check authentication status
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }

    res.status(401).json({ error: 'Unauthorized' });
}

// Create sample anime and episodes (for testing purposes)
async function createSampleAnime() {
    try {
        const anime = new Anime({
            title: 'Sample Anime',
            description: 'A sample anime for testing purposes.',
            episodes: [
                { title: 'Episode 1', videoPath: 'sample_anime_episode_1.mp4' },
                { title: 'Episode 2', videoPath: 'sample_anime_episode_2.mp4' },
                // Add more episodes as needed
            ],
        });

        await anime.save();
    } catch (error) {
        console.error('Error creating sample anime:', error);
    }
}

// Uncomment the following line to create sample anime when the server starts
// createSampleAnime();

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
