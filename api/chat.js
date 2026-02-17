const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());

let sessions = {}; // session-based memory

// 🧠 Simulated AI Models
function fastModel(prompt) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve("⚡ FAST Response: " + prompt);
    }, 800);
  });
}

function balancedModel(prompt) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("⚖ BALANCED Response: " + prompt);
    }, 1500);
  });
}

function heavyModel(prompt) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("🧠 HEAVY Response: " + prompt);
    }, 2500);
  });
}

// 🚀 TRUE Parallel Fallback (Natural Racing)
app.post("/chat", async (req, res) => {
  const { message, sessionId } = req.body;

  if (!sessions[sessionId]) {
    sessions[sessionId] = [];
  }

  sessions[sessionId].push({
    id: uuidv4(),
    role: "user",
    content: message,
  });

  try {
    const response = await Promise.race([
      fastModel(message),
      balancedModel(message),
      heavyModel(message),
    ]);

    const aiMessage = {
      id: uuidv4(),
      role: "assistant",
      content: response,
    };

    sessions[sessionId].push(aiMessage);

    res.json({
      reply: aiMessage,
      history: sessions[sessionId],
    });
  } catch (error) {
    res.status(500).json({ error: "All models failed." });
  }
});

// ❌ Delete single message
app.post("/delete-message", (req, res) => {
  const { sessionId, messageId } = req.body;

  sessions[sessionId] = sessions[sessionId].filter(
    (msg) => msg.id !== messageId
  );

  res.json({ success: true });
});

// 🗑 Clear entire chat
app.post("/clear-chat", (req, res) => {
  const { sessionId } = req.body;
  sessions[sessionId] = [];
  res.json({ success: true });
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});


