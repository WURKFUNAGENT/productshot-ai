const express = require("express");
const path = require("path");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/transform", async (req, res) => {
  const { image, prompt } = req.body;

  if (!image) {
    return res.status(400).json({ error: "No image provided." });
  }

  const basePrompt =
    "Transform this product photo into a professional e-commerce product photograph. Clean white background, professional studio lighting, sharp focus, high resolution. The product should look premium and ready for a webshop listing. Keep the product exactly as it is but dramatically improve the presentation, lighting, and background.";

  const fullPrompt = prompt ? `${basePrompt} Additional instructions: ${prompt}` : basePrompt;

  const imageUrl = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;

  const payload = JSON.stringify({
    model: "google/gemini-3-pro-image-preview",
    modalities: ["text", "image"],
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: fullPrompt },
        ],
      },
    ],
  });

  try {
    const result = await callOpenRouter(payload);

    const parsed = JSON.parse(result);

    if (parsed.error) {
      console.error("OpenRouter error:", parsed.error);
      return res.status(502).json({ error: parsed.error.message || "AI service returned an error." });
    }

    const choice = parsed.choices && parsed.choices[0];
    if (!choice) {
      return res.status(502).json({ error: "No response from AI service." });
    }

    const images = choice.message && choice.message.images;
    if (!images || images.length === 0 || !images[0].image_url || !images[0].image_url.url) {
      const textContent = choice.message && choice.message.content;
      return res.status(502).json({
        error: "The AI did not generate an image. Please try again with a clearer product photo.",
        detail: typeof textContent === "string" ? textContent : undefined,
      });
    }

    const generatedImageUrl = images[0].image_url.url;

    res.json({ image: generatedImageUrl });
  } catch (err) {
    console.error("Transform error:", err.message);
    res.status(500).json({ error: "Failed to process image. Please try again." });
  }
});

function callOpenRouter(payload) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "openrouter.ai",
      path: "/api/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve(body));
    });

    req.on("error", reject);
    req.setTimeout(120000, () => {
      req.destroy(new Error("Request timed out after 120 seconds"));
    });
    req.write(payload);
    req.end();
  });
}

app.listen(PORT, () => {
  console.log(`ProductShot AI running on port ${PORT}`);
});
