# 🏥 Healthcare WebApp - Backend

Backend for the **Smart Healthcare Web App** — a full-stack health assistant platform that helps users track food calories, check symptoms, and calculate personal health metrics. Built using Node.js, Express, SQLite, and integrated with the USDA FoodData Central API.

🖥️ **Frontend Repo**: [https://github.com/sai-ram-sagar/Healthcare-WebApp-Frontend.git](https://github.com/sai-ram-sagar/Healthcare-WebApp-Frontend.git)  
🌐 **Live App**: [https://smart-healthcare-webapp.netlify.app/](https://smart-healthcare-webapp.netlify.app)

---

## 🚀 Features

- 🤒 Check symptoms and get advice via API
- 🍎 Search food & retrieve calorie info using USDA Food API
- 🔢 Calculate & store BMR (Basal Metabolic Rate)
- 👤 Save user profile and health metrics
- 🔐 JWT-based user login & signup
- 📁 SQLite DB for storing user, BMR, and search data

---

## 🔌 External API Used

- **USDA FoodData Central API**  
  For accurate calorie and nutrient information about food items.  
  API Docs: [https://fdc.nal.usda.gov/api-guide.html](https://fdc.nal.usda.gov/api-guide.html)

---

## 🛠️ Tech Stack

- Node.js + Express.js  
- SQLite (better-sqlite3)  
- JWT Authentication  
- Axios (for external API requests)  
- REST API structure  

---

## 🧑‍💻 Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/sai-ram-sagar/Healthcare-WebApp-Backend.git
cd Healthcare-WebApp-Backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
PORT=5000
JWT_SECRET=your_secret_key
USDA_API_KEY=your_usda_api_key
```

### 4. Start the server

```bash
node server.js
```

