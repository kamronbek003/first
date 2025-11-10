import { GoogleGenAI } from '@google/genai';
import dotenv from "dotenv";
dotenv.config();

// SDK avtomatik ravishda GEMINI_API_KEY ni atrof-muhit o'zgaruvchilaridan qidiradi
const ai = new GoogleGenAI({}); 

async function testGemini() {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", // Endi "gemini-1.5-flash-latest" dan ham foydalanishingiz mumkin
      contents: [{ role: "user", parts: [{ text: "Hello Kamron, how are you?" }] }],
    });

    console.log("✅ Gemini javobi:", response.text);
  } catch (error) {
    // Xato obyektini tekshirish uchun JSON.stringify dan foydalaning
    console.error("❌ Xatolik:", error.message); 
  }
}

testGemini();