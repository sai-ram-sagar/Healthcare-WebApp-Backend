const express = require('express');
const sqlite = require('better-sqlite3');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const levenshtein = require('fast-levenshtein');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

if (!process.env.JWT_SECRET) {
    console.error("Error: Missing JWT_SECRET in environment variables.");
    process.exit(1);
}

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(bodyParser.json());

const healthcareDB = sqlite('./healthcare.db');

app.post("/register", async (req, res) => {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        healthcareDB.prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)").run(username, email, hashedPassword);
        res.json({ message: "User registered successfully" });
    } catch (err) {
        res.status(400).json({ error: "Email already in use" });
    }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = healthcareDB.prepare("SELECT * FROM users WHERE email = ?").get(email);

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    res.json({ message: "Login successful", token, userId: user.id });
});

app.post('/api/symptom-checker', (req, res) => {
    const { symptoms } = req.body;
    if (!symptoms) return res.status(400).json({ error: "Please enter symptoms." });
    
    let userSymptoms = symptoms.toLowerCase().replace(/[,]+/g, ' ').replace(/\band\b|\b&\b/g, '').trim().split(/\s+/);
    let matchedResponses = [];
    
    const rows = healthcareDB.prepare('SELECT * FROM symptoms').all();
    rows.forEach(row => {
        const dbSymptom = row.name.toLowerCase().trim();
        userSymptoms.forEach((_, index) => {
            let inputSegment = userSymptoms.slice(index, index + dbSymptom.split(' ').length).join(' ');
            if (levenshtein.get(inputSegment, dbSymptom) <= (dbSymptom.length > 6 ? 3 : 2)) {
                matchedResponses.push(row.response);
            }
        });
    });
    
    res.json({ advice: matchedResponses.length ? [...new Set(matchedResponses)] : "No specific advice found. Please consult a doctor." });
});

app.get('/api/symptoms-list', (req, res) => {
    const rows = healthcareDB.prepare('SELECT name FROM symptoms').all();
    res.json({ symptoms: rows.map(row => row.name) });
});

// -----------------------------------------Food Search Feature----------------------------------------------
app.get("/api/food/search", async (req, res) => {
    const query = req.query.q;
    const apiKey = process.env.USDA_API_KEY;
    const apiUrl = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}&query=${encodeURIComponent(query)}`;

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        res.json(data.foods || []);
    } catch (error) {
        console.error("Error fetching food data:", error);
        res.status(500).json({ error: "Failed to fetch food data" });
    }
});

app.post("/api/food/log", (req, res) => {
    const { user_id, food_name, calories, quantity } = req.body;
    const sql = `INSERT INTO food_logs (user_id, food_name, calories, quantity) VALUES (?, ?, ?, ?)`;

    try {
        const stmt = healthcareDB.prepare(sql);
        const result = stmt.run(user_id, food_name, calories, quantity);
        res.json({ id: result.lastInsertRowid, food_name, calories, quantity });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/food/logs", (req, res) => {
    const { user_id } = req.query;
    const sql = `SELECT * FROM food_logs WHERE user_id = ? ORDER BY created_at DESC`;

    try {
        const rows = healthcareDB.prepare(sql).all(user_id);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete("/api/food/log/:id", (req, res) => {
    const { id } = req.params;
    const sql = `DELETE FROM food_logs WHERE id = ?`;

    try {
        const stmt = healthcareDB.prepare(sql);
        stmt.run(id);
        res.json({ success: true, deletedId: id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/food/total-calories", (req, res) => {
    const { user_id } = req.query;
    const sql = `SELECT SUM(calories) AS total_calories FROM food_logs WHERE user_id = ?`;

    try {
        const row = healthcareDB.prepare(sql).get(user_id);
        res.json({ total_calories: row?.total_calories || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// -----------------------------------------BMR Feature----------------------------------------------
app.get("/api/bmr/:user_id", (req, res) => {
    const { user_id } = req.params;
    const sql = "SELECT * FROM bmr_info WHERE user_id = ?";

    try {
        const row = healthcareDB.prepare(sql).get(user_id);
        res.json(row || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/bmr", (req, res) => {
    const { user_id, age, gender, height, weight, activity_level } = req.body;
    let bmr;

    if (gender === "male") {
        bmr = 88.36 + 13.4 * weight + 4.8 * height - 5.7 * age;
    } else {
        bmr = 447.6 + 9.2 * weight + 3.1 * height - 4.3 * age;
    }

    const activityFactors = {
        sedentary: 1.2,
        light: 1.375,
        moderate: 1.55,
        active: 1.725,
        very_active: 1.9,
    };

    const daily_calorie_limit = Math.round(bmr * (activityFactors[activity_level] || 1.2));

    try {
        const sql = `INSERT INTO bmr_info (user_id, age, gender, height, weight, bmr, activity_level, daily_calorie_limit)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET 
                age = excluded.age, 
                gender = excluded.gender, 
                height = excluded.height, 
                weight = excluded.weight, 
                bmr = excluded.bmr, 
                activity_level = excluded.activity_level, 
                daily_calorie_limit = excluded.daily_calorie_limit`;
        const stmt = healthcareDB.prepare(sql);
        stmt.run(user_id, age, gender, height, weight, bmr, activity_level, daily_calorie_limit);
        res.json({ bmr, daily_calorie_limit });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
