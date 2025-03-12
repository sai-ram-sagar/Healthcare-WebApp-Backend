const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const bodyParser = require('body-parser');
const levenshtein = require('fast-levenshtein');
const webPush = require("web-push");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());

// Database connections
const healthcareDB = new sqlite3.Database('./healthcare.db', sqlite3.OPEN_READWRITE, (err) => {
    if (err) console.error('Error connecting to healthcare database:', err.message);
    else console.log('Connected to healthcare.db.');
});

// const remaindersDB = new sqlite3.Database('./reminders.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
//     if (err) console.error('Error connecting to remainders database:', err.message);
//     else console.log('Connected to remainders.db.');
// });

// -----------------------------------------Authentication----------------------------------------------

// Register API
app.post("/register", async (req, res) => {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    healthcareDB.run(`INSERT INTO users (username, email, password) VALUES (?, ?, ?)`,
        [username, email, hashedPassword],
        function (err) {
            if (err) return res.status(400).json({ error: "Email already in use" });
            res.json({ message: "User registered successfully" });
        }
    );
});

// Login API
app.post("/login", (req, res) => {
    const { email, password } = req.body;

    healthcareDB.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: "Invalid email or password" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Invalid email or password" });

        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "1h" });
        res.json({ message: "Login successful", token, userId: user.id  });
    });
});

// -----------------------------------------Symptoms Feature----------------------------------------------

// API to check symptoms and provide advice
app.post('/api/symptom-checker', (req, res) => {
    const { symptoms } = req.body;

    if (!symptoms) {
        return res.status(400).json({ error: "Please enter symptoms to get advice." });
    }

    let userSymptoms = symptoms.toLowerCase()
        .replace(/[,]+/g, ' ')
        .replace(/\band\b|\b&\b/g, '')
        .trim()
        .split(/\s+/);

    healthcareDB.all('SELECT * FROM symptoms', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        let matchedResponses = [];

        rows.forEach(row => {
            const dbSymptom = row.name.toLowerCase().trim();

            userSymptoms.forEach((_, index) => {
                let inputSegment = userSymptoms.slice(index, index + dbSymptom.split(' ').length).join(' ');
                const distance = levenshtein.get(inputSegment, dbSymptom);
                const threshold = dbSymptom.length > 6 ? 3 : 2;

                if (distance <= threshold) {
                    matchedResponses.push(row.response);
                }
            });
        });

        if (matchedResponses.length === 0) {
            return res.json({ advice: "No specific advice found. Please consult a doctor if symptoms persist." });
        }

        res.json({ advice: [...new Set(matchedResponses)] });
    });
});

// API to get the list of available symptoms
app.get('/api/symptoms-list', (req, res) => {
    healthcareDB.all('SELECT name FROM symptoms', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const symptomsList = rows.map(row => row.name);
        res.json({ symptoms: symptomsList });
    });
});

// -----------------------------------------Food Search Feature----------------------------------------------

// Search food using USDA API
app.get('/api/food/search', async (req, res) => {
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

// // Add food to meal log
// app.post('/api/food/log', (req, res) => {
//     const { user_id, food_name, calories, quantity } = req.body;
//     const sql = `INSERT INTO food_logs (user_id, food_name, calories, quantity) VALUES (?, ?, ?, ?)`;

//     healthcareDB.run(sql, [user_id, food_name, calories, quantity], function (err) {
//         if (err) return res.status(500).json({ error: err.message });
//         res.json({ id: this.lastID, food_name, calories, quantity });
//     });
// });

// // Get user meal log
// app.get('/api/food/logs', (req, res) => {
//     const { user_id } = req.query;
//     const sql = `SELECT * FROM food_logs WHERE user_id = ? ORDER BY created_at DESC`;

//     healthcareDB.all(sql, [user_id], (err, rows) => {
//         if (err) return res.status(500).json({ error: err.message });
//         res.json(rows);
//     });
// });

// // Delete food from meal log
// app.delete('/api/food/log/:id', (req, res) => {
//     const { id } = req.params;
//     const sql = `DELETE FROM food_logs WHERE id = ?`;

//     healthcareDB.run(sql, [id], function (err) {
//         if (err) return res.status(500).json({ error: err.message });
//         res.json({ success: true, deletedId: id });
//     });
// });

// // Get total calories
// app.get('/api/food/total-calories', (req, res) => {
//     const { user_id } = req.query;
//     const sql = `SELECT SUM(calories) AS total_calories FROM food_logs WHERE user_id = ?`;

//     healthcareDB.get(sql, [user_id], (err, row) => {
//         if (err) return res.status(500).json({ error: err.message });
//         res.json({ total_calories: row?.total_calories || 0 });
//     });
// });

// -----------------------------------------BMR Feature----------------------------------------------

// Endpoint to get user's BMR info
app.get("/api/bmr/:user_id", (req, res) => {
    const { user_id } = req.params;
    healthcareDB.get("SELECT * FROM bmr_info WHERE user_id = ?", [user_id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || {});
    });
});

// Endpoint to calculate and store BMR info
app.post("/api/bmr", (req, res) => {
    const { user_id, age, gender, height, weight, activity_level } = req.body;
    
    let bmr;
    if (gender === "male") {
        bmr = 88.36 + (13.4 * weight) + (4.8 * height) - (5.7 * age);
    } else {
        bmr = 447.6 + (9.2 * weight) + (3.1 * height) - (4.3 * age);
    }

    const activityFactors = {
        "sedentary": 1.2,
        "light": 1.375,
        "moderate": 1.55,
        "active": 1.725,
        "very_active": 1.9
    };
    
    const daily_calorie_limit = Math.round(bmr * (activityFactors[activity_level] || 1.2));

    healthcareDB.run(`
        INSERT INTO bmr_info (user_id, age, gender, height, weight, bmr, activity_level, daily_calorie_limit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET 
            age = excluded.age, 
            gender = excluded.gender, 
            height = excluded.height, 
            weight = excluded.weight, 
            bmr = excluded.bmr, 
            activity_level = excluded.activity_level, 
            daily_calorie_limit = excluded.daily_calorie_limit
    `, [user_id, age, gender, height, weight, bmr, activity_level, daily_calorie_limit], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ bmr, daily_calorie_limit });
    });
});

// // -----------------------------------------Health Reminder Feature----------------------------------------------
// const VAPID_KEYS = {
//   publicKey: process.env.PUBLIC_VAPID_KEY,
//   privateKey: process.env.PRIVATE_VAPID_KEY,
// };

// webPush.setVapidDetails(
//   "mailto:your-email@example.com",
//   VAPID_KEYS.publicKey,
//   VAPID_KEYS.privateKey
// ); 

// // Store user subscriptions in remainders.db
// app.post("/subscribe", (req, res) => {
//     console.log("Received Subscription:", req.body);
    
//     const { endpoint, keys } = req.body;
//     if (!endpoint || !keys?.p256dh || !keys?.auth) {
//         return res.status(400).json({ error: "Invalid subscription object" });
//     }

//     const query = `INSERT INTO subscriptions (endpoint, keys) VALUES (?, ?)`;
//     remaindersDB.run(query, [endpoint, JSON.stringify(keys)], function (err) {
//         if (err) {
//             console.error("Error saving subscription:", err.message);
//             return res.status(500).json({ error: "Database error" });
//         }
//         res.status(201).json({ message: "Subscribed!" });
//     });
// });

// // Store reminders in remainders.db
// app.post("/set-reminder", (req, res) => {
//     const { time, message } = req.body;
//     console.log("Reminder Request:", req.body);

//     const reminderTime = new Date(time);
//     if (isNaN(reminderTime)) {
//         return res.status(400).json({ error: "Invalid date format" });
//     }

//     const delay = reminderTime - new Date();
//     console.log(delay)
//     if (delay <= 0) {
//         return res.status(400).json({ error: "Time must be in the future" });
//     }

//     // Insert reminder into SQLite database
//     const query = `INSERT INTO reminders (time, message) VALUES (?, ?)`;
//     remaindersDB.run(query, [reminderTime.toISOString(), message], function (err) {
//         if (err) {
//             console.error("Error saving reminder:", err.message);
//             return res.status(500).json({ error: "Database error" });
//         }

//         setTimeout(() => {
//             console.log('test')
//             sendNotification(message);
//         }, delay);

//         res.json({ message: "Reminder saved!" });
//     });
// });


// // Send Push Notification
// function sendNotification(message) {
//     remaindersDB.all('SELECT * FROM subscriptions', [], (err, rows) => {
//         if (err) {
//             console.error("Error fetching subscriptions:", err.message);
//             return;
//         }
//    console.log(rows)
//         rows.forEach(sub => {
//             try {
//                 const subscription = {
//                     endpoint: sub.endpoint,
//                     keys: JSON.parse(sub.keys) // Ensure it's valid JSON
//                 };
//                 console.log("Received Subscription:", subscription);

//                 webPush.sendNotification(subscription, message)
//                     .catch(err => console.error("Push Notification Error:", err));

//             } catch (error) {
//                 console.error("Error parsing subscription keys:", error.message);
//             }
//         });
//     });
// }

// Start server

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
