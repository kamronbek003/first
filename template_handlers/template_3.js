const PptxGenJS = require("pptxgenjs");
const path = require("path");
const { Markup } = require("telegraf");

const PRICE = 6000;
const MAX_RETRIES = 5; // Retry sonini oshirdik
const RETRY_DELAY = 2000;
const MIN_UPDATE_DELAY = 1400;

// Template 3-specific background images
const backgroundImages = [
  "shablonlar/3/1.png",
  "shablonlar/3/2.png",
  "shablonlar/3/3.png",
  "shablonlar/3/4.png",
  "shablonlar/3/5.png",
  "shablonlar/3/6.png",
  "shablonlar/3/7.png",
  "shablonlar/3/8.png",
  "shablonlar/3/9.png",
  "shablonlar/3/10.png",
  "shablonlar/3/11.png",
  "shablonlar/3/12.png",
  "shablonlar/3/13.png",
  "shablonlar/3/14.png",
];

String.prototype.toTitleCase = function () {
  return this.replace(/\b\w/g, (char) => char.toUpperCase());
};

// === YORDAMCHI FUNKSIYALAR ===

/**
 * AI'dan kelgan matnni tozalash
 */
function cleanupText(text) {
  if (!text) return "";
  let cleaned = text;

  cleaned = cleaned
    .replace(/```/g, "")
    .replace(/\*\*/g, "")
    .replace(/^[#]+\s+/gm, "")
    .replace(/^[-*•]\s+/gm, "");

  cleaned = cleaned
    .replace(/^matn:?\s*/i, "")
    .replace(/^javob:?\s*/i, "")
    .replace(/^xulosa:?\s*/i, "")
    .replace(/^kirish:?\s*/i, "")
    .replace(/^paragraf \d+:?\s*/i, "")
    .replace(/^\d+[\.\)]\s*/gm, ""); // Raqamlarni olib tashlash

  cleaned = cleaned.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
  cleaned = cleaned.trim().replace(/^["']|["']$/g, "").trim();

  return cleaned;
}

// Animatsiyali progress bar
function getProgressBar(percent) {
  const filled = Math.floor(percent / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

// Progress xabarini yangilash
async function updateProgress(ctx, messageId, text, percent, minDelay = MIN_UPDATE_DELAY) {
  const startTime = Date.now();
  try {
    const progressBar = getProgressBar(percent);
    const message = `${text}\n\n${progressBar} ${percent}%`;

    await ctx.telegram.editMessageText(ctx.chat.id, messageId, null, message);

    const elapsed = Date.now() - startTime;
    if (elapsed < minDelay) {
      await new Promise((resolve) => setTimeout(resolve, minDelay - elapsed));
    }

  } catch (error) {
    if (!error.message.includes("message is not modified")) {
      console.error("Progress update error:", error.message);
    }
  }
}

// YAXSHILANGAN: Triple format uchun maxsus parsing funksiyasi
function parseTripleResponse(text) {
  if (!text) return null;
  
  // Avval $ bilan ajratishga harakat qilamiz
  let parts = text.split("$").map(p => cleanupText(p)).filter(p => p.length > 0);
  
  // Agar $ bilan 3 ta qism topilmasa, boshqa usullarni sinab ko'ramiz
  if (parts.length < 3) {
    // 1. Yangi qator bilan ajratilgan bo'lishi mumkin
    parts = text.split(/\n\n+/).map(p => cleanupText(p)).filter(p => p.length > 0);
  }
  
  if (parts.length < 3) {
    // 2. Raqamlar bilan boshlangan bo'lishi mumkin (1., 2., 3. yoki 1) 2) 3))
    const numbered = text.split(/\d+[\.\)]\s+/).map(p => cleanupText(p)).filter(p => p.length > 0);
    if (numbered.length >= 3) parts = numbered;
  }
  
  if (parts.length < 3) {
    // 3. Har bir jumla alohida paragraf sifatida
    const sentences = text.split(/[\.!?]+/).map(s => cleanupText(s)).filter(s => s.length > 20);
    if (sentences.length >= 3) {
      parts = [
        sentences.slice(0, Math.ceil(sentences.length / 3)).join(". ") + ".",
        sentences.slice(Math.ceil(sentences.length / 3), Math.ceil(sentences.length * 2 / 3)).join(". ") + ".",
        sentences.slice(Math.ceil(sentences.length * 2 / 3)).join(". ") + "."
      ];
    }
  }
  
  // Kamida 3 ta qism borligini tekshirish
  if (parts.length >= 3) {
    return parts.slice(0, 3);
  }
  
  return null;
}

// Gemini'dan javob olish (YAXSHILANGAN)
async function generateWithRetry(
  geminiModel, prompt, expectedFormat = null, retries = MAX_RETRIES,
  ctx = null, loadingMsgId = null, stepName = "", stepProgress = 0
) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await geminiModel.generateContent(prompt);
      let text = result.response.text().trim();

      if (expectedFormat === "outline") {
        const parts = text.split("$");
        if (parts.length >= 10) {
          return parts.map((p) => cleanupText(p)).filter((p) => p.length > 0).slice(0, 10);
        }
        throw new Error(`Noto'g'ri format (outline): ${parts.length} ta qism topildi`);
      }

      // YANGI: Triple format uchun yaxshilangan parsing
      if (expectedFormat === "triple") {
        const parsed = parseTripleResponse(text);
        if (parsed && parsed.length === 3) {
          return parsed;
        }
        console.log(`Triple parsing attempt ${attempt}: topilgan qismlar soni = ${parsed ? parsed.length : 0}`);
        throw new Error(`Noto'g'ri format (triple): 3 ta paragraf topilmadi`);
      }

      const cleanedText = cleanupText(text);

      if (cleanedText.length < 15) {
        throw new Error(`Juda qisqa javob: ${cleanedText.length} ta belgi`);
      }

      return cleanedText;

    } catch (error) {
      console.error(`Urinish ${attempt}/${retries} muvaffaqiyatsiz (${stepName}): ${error.message}`);

      if (attempt === retries) {
        if (expectedFormat === "outline") {
          return ["Kirish", "Tarix", "Asosiy tushunchalar", "Turlar", "Afzalliklar", "Kamchiliklar", "Qo'llanilishi", "Statistika", "Tahlil", "Xulosa"];
        }
        if (expectedFormat === "triple") {
          console.error("CRITICAL: Triple format uchun fallback ishlatilmoqda!");
          return [
            "Bu bo'limning birinchi qismi haqida ma'lumot. Mavzu bo'yicha asosiy fikrlar va tushunchalar keltirilgan.",
            "Ikkinchi qismda qo'shimcha tafsilotlar va muhim nuqtalar ko'rib chiqiladi.",
            "Uchinchi qismda yakuniy xulosalar va amaliy jihatlar bayon etiladi."
          ];
        }
        return "Ushbu bo'lim uchun ma'lumot tayyorlashda texnik muammo yuz berdi.";
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

// MUKAMMAL matn prompt (So'z chegarasini kengaytirdik)
function getMukammalPrompt(topic, section) {
  return `"${topic}" mavzusining "${section}" bo'limi uchun MUKAMMAL matn yoz.

TALABLAR:
- 90-130 so'z oralig'ida
- "${section}" ni to'liq qamrab olish
- Aniq va konkret ma'lumotlar
- Mantiqiy strukturada
- Faqat matn, hech qanday sarlavha, raqam yoki belgisiz

Matn:`;
}

// === ASOSIY HANDLE FUNKSIYASI ===

async function handle(ctx, { User, geminiModel, showLoading, logger, bot, fs, onComplete }) {
  const user = await User.findOne({ telegramId: ctx.from.id.toString() });
  if (!user || user.balance < PRICE) {
    await ctx.reply(
      `Balansingiz yetarli emas! Ushbu shablon narxi: ${PRICE} so'm`,
      Markup.keyboard([["🔙 Orqaga"]]).resize()
    );
    return;
  }

  const presentationData = ctx.session.presentationData;
  let filePath = null;
  let loadingMessageId = null;

  const loadingMsg = await ctx.reply(
    `Taqdimot yaratish boshlanmoqda...\n\n█░░░░░░░░░ 0%`,
    { parse_mode: null }
  );
  loadingMessageId = loadingMsg.message_id;

  try {
    // 1. Reja olish - 5%
    await updateProgress(ctx, loadingMessageId, "Reja tuzilmoqda...", 4);

    const outlinePrompt = `${presentationData.topic} mavzusi uchun 
"birinchireja$ikkinchireja$...$o'ninchireja" formatida faqat 10 ta reja yoz. 
Ortiqcha matn va raqam qo'shma! // Misol: 
"Kirish$Tikuvchilik tarixi$Tikuvchilik turlari$Matolar va xususiyatlari$Tikuvchilik asbob-uskunalari$Andaza va bichish jarayoni$Tikish texnikalari$Zamonaviy tikuvchilik tendensiyalari$Tikuvchilikning iqtisodiy ahamiyati$Xulosa"`;

    const plan = await generateWithRetry(
      geminiModel, outlinePrompt, "outline", MAX_RETRIES, 
      ctx, loadingMessageId, "📋 Reja yaratilmoqda", 10
    );

    const pptx = new PptxGenJS();

    // 2. 1-sahifa: Bosh sahifa - 15%
    await updateProgress(ctx, loadingMessageId, "Bosh sahifa tayyorlanmoqda...", 14);

    const topicLength = presentationData.topic.length;
    let topicFontSize = topicLength < 20 ? 56 : 36;
    
    const titleSlide = pptx.addSlide();
    titleSlide.background = { path: path.resolve(backgroundImages[0]) };
    titleSlide.addText(`${presentationData.topic.toUpperCase()}`, {
      x: 1.03, y: 1.21, w: 6.7, h: 2.46, fontSize: topicFontSize, bold: true, color: "FFFFFF",
      fontFace: "Agency FB",
    });
    titleSlide.addText(`${presentationData.authorName.toTitleCase()}`, {
      x: 1.7, w: "45%", y: 4.52, valign: "middle", fontSize: 18,
      fontFace: "Agency FB", color: "FFFFFF", bold: true,
    });
    titleSlide.addText(`${presentationData.institution.toTitleCase()}`, {
      x: 1.48, y: 0.6, w: "48%", fontSize: 18, color: "FFFFFF",
      fontFace: "Agency FB", bold: true,
    });

    // 3. 2-sahifa: Mundarija - 25%
    await updateProgress(ctx, loadingMessageId, "Mundarija tayyorlanmoqda...", 26);

    const secondSlide = pptx.addSlide();
    secondSlide.background = { path: path.resolve(backgroundImages[1]) };
    secondSlide.addText(`${plan[0] || 'Kirish'}`, { x: 4.8, y: 1.57, fontSize: 18, fontFace: "Agency FB", bold: true, color: "FFFFFF", w: "45%" });
    secondSlide.addText(`${plan[1] || 'Mavzu 1'}`, { x: 4.8, y: 2.23, fontSize: 18, fontFace: "Agency FB", bold: true, color: "FFFFFF", w: "45%" });
    secondSlide.addText(`${plan[3] || 'Mavzu 3'}`, { x: 4.8, y: 2.85, fontSize: 18, fontFace: "Agency FB", bold: true, color: "FFFFFF", w: "45%" });
    secondSlide.addText(`${plan[5] || 'Mavzu 5'}`, { x: 4.8, y: 3.52, fontSize: 18, fontFace: "Agency FB", bold: true, color: "FFFFFF", w: "45%" });
    secondSlide.addText(`${plan[7] || 'Mavzu 7'}`, { x: 4.8, y: 4.15, fontSize: 18, fontFace: "Agency FB", bold: true, color: "FFFFFF", w: "45%" });

    // 4. 3-sahifa: Kirish - 35%
    await updateProgress(ctx, loadingMessageId, "3-sahifa tayyorlanmoqda...", 37);

    const page3Prompt = `${presentationData.topic} mavzusining KIRISH qismi uchun 40-50 so'zdan iborat ma'lumot ber! Faqat matnni yoz.`;
    const kirish1Prompt = `${presentationData.topic} mavzusining KIRISH qismi uchun 25-30 so'zdan iborat birinchi ma'lumotni ber! Faqat matnni yoz.`;
    const kirish2Prompt = `${presentationData.topic} mavzusining KIRISH qismi uchun 25-30 so'zdan iborat ikkinchi ma'lumotni ber! Faqat matnni yoz.`;
    const kirish3Prompt = `${presentationData.topic} mavzusining KIRISH qismi uchun 25-30 so'zdan iborat uchinchi ma'lumotni ber! Faqat matnni yoz.`;

    const page3Text = await generateWithRetry(geminiModel, page3Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Kirish matni", 36);
    const kirish1Text = await generateWithRetry(geminiModel, kirish1Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Fikr 1", 37);
    const kirish2Text = await generateWithRetry(geminiModel, kirish2Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Fikr 2", 38);
    const kirish3Text = await generateWithRetry(geminiModel, kirish3Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Fikr 3", 39);

    const thirdSlide = pptx.addSlide();
    thirdSlide.background = { path: path.resolve(backgroundImages[2]) };
    thirdSlide.addText(page3Text, {
      x: 0.3, y: 0.95, fontSize: 16, fontFace: "Calibri Light", color: "FFFFFF", w: "35%", h: "70%",
    });
    thirdSlide.addText(kirish1Text, {
      x: 4.6, y: 1.33, fontSize: 15, fontFace: "Agency FB", color: "FFFFFF", w: "45%", valign: "top",
    });
    thirdSlide.addText(kirish2Text, {
      x: 4.6, y: 2.62, fontSize: 15, fontFace: "Agency FB", color: "FFFFFF", w: "45%", valign: "top",
    });
    thirdSlide.addText(kirish3Text, {
      x: 4.6, y: 3.88, fontSize: 15, fontFace: "Agency FB", color: "FFFFFF", w: "45%", valign: "top",
    });

    // 5. 4-sahifa (plan[1]) - 45%
    await updateProgress(ctx, loadingMessageId, "4-sahifa tayyorlanmoqda...", 42);

    const page4Prompt = getMukammalPrompt(presentationData.topic, plan[1]);
    const page4Text = await generateWithRetry(geminiModel, page4Prompt, null, MAX_RETRIES, ctx, loadingMessageId, plan[1], 46);

    const fourSlide = pptx.addSlide();
    fourSlide.background = { path: path.resolve(backgroundImages[3]) };
    fourSlide.addText((plan[1] || 'Mavzu 1').toUpperCase(), {
      x: 0.5, y: 0.1, align: "center", fontSize: 22, bold: true, fontFace: "Times New Roman", color: "FFFFFF",
      w:7.3, h:0.73,
    });
    fourSlide.addText(page4Text, {
      x: 0.82, y: 1.13, align: "justify", fontSize: 18, fontFace: "Times New Roman", color: "FFFFFF", w: 8.44, h: 3.83,
    });

    // 6. 5-sahifa (plan[2]) - 50%
    await updateProgress(ctx, loadingMessageId, "5-sahifa tayyorlanmoqda...", 53);

    const page5Prompt = getMukammalPrompt(presentationData.topic, plan[2]);
    const page5Text = await generateWithRetry(geminiModel, page5Prompt, null, MAX_RETRIES, ctx, loadingMessageId, plan[2], 51);

    const fifeSlide = pptx.addSlide();
    fifeSlide.background = { path: path.resolve(backgroundImages[4]) };
    fifeSlide.addText((plan[2] || 'Mavzu 2').toUpperCase(), {
      x: 0.77, y: 0.09, align: "center", fontSize: 22, bold: true, fontFace: "Times New Roman", color: "FFFFFF",
      w: 6.72, h: 0.74,
    });
    fifeSlide.addText(page5Text, {
      x: 0.77, y: 1.19, align: "justify", fontSize: 18, fontFace: "Times New Roman", color: "FFFFFF", w: 8.42, h: 3.68
    });

    // 7. 6-sahifa (plan[3] - YAXSHILANGAN TRIPLE) - 55%
    await updateProgress(ctx, loadingMessageId, "6-sahifa tayyorlanmoqda...", 57);

    // YANGI: Aniqroq va soddaroq prompt
    const page6Prompt = `"${presentationData.topic}" mavzusining "${plan[3] || 'Mavzu 3'}" bo'limi uchun 3 ta alohida paragraf yoz.

QAT'IY FORMAT: birinchiparagraf$ikkinchiparagraf$uchinchiparagraf

QAT'IY TALABLAR:
- Har bir paragraf 35-50 so'zdan iborat
- Paragraflar orasida faqat $ belgisi
- Hech qanday raqam, sarlavha yoki boshqa belgi yo'q
- Faqat oddiy matn

3 ta paragraf:`;

    const page6Text = await generateWithRetry(geminiModel, page6Prompt, 'triple', MAX_RETRIES, ctx, loadingMessageId, `${plan[3]} (3 paragraf)`, 56);

    const sixSlide = pptx.addSlide();
    sixSlide.background = { path: path.resolve(backgroundImages[5]) };
    sixSlide.addText((plan[3] || 'Mavzu 3').toUpperCase(), {
      x: 2.08, y: 0.3, align: "center", fontSize: 18, bold: true, fontFace: "Times New Roman", color: "#FFFFFF", w: 6.8, h: 0.82
    });
    sixSlide.addText(page6Text[0], {
      x: 0.67, y: 2.45, align: "center", fontSize: 12, fontFace: "Times New Roman", color: "FFFFFF", w: 2.71, h: 2.26, valign: "top",
    });
    sixSlide.addText(page6Text[1], {
      x: 3.66, y: 2.45, align: "center", fontSize: 12, fontFace: "Times New Roman", color: "FFFFFF", w: 2.72, h: 2.26, valign: "top",
    });
    sixSlide.addText(page6Text[2], {
      x: 6.73, y: 2.45, align: "center", fontSize: 12, fontFace: "Times New Roman", color: "FFFFFF", w: 2.73, h: 2.26, valign: "top",
    });

    // 8. 7-sahifa (plan[4]) - 60%
    await updateProgress(ctx, loadingMessageId, "7-sahifa tayyorlanmoqda...", 61);

    const page7Prompt = getMukammalPrompt(presentationData.topic, plan[4]);
    const page7Text = await generateWithRetry(geminiModel, page7Prompt, null, MAX_RETRIES, ctx, loadingMessageId, plan[4], 61);

    const sevenSlide = pptx.addSlide();
    sevenSlide.background = { path: path.resolve(backgroundImages[6]) };
    sevenSlide.addText((plan[4] || 'Mavzu 4').toUpperCase(), {
      x: 0.3, y: 0.06, align: "center", fontSize: 22, bold: true, fontFace: "Times New Roman", color: "FFFFFF", h: 0.8, w: 7.61,
    });
    sevenSlide.addText(page7Text, {
      x: 0.66, y: 1.32, align: "justify", fontSize: 18, fontFace: "Times New Roman", color: "FFFFFF", w: 8.66, h: 3.14
    });

    // 9. 8-sahifa (plan[5]) - 65%
    await updateProgress(ctx, loadingMessageId, "8-sahifa tayyorlanmoqda...", 67);

    const page8Prompt = getMukammalPrompt(presentationData.topic, plan[5]);
    const page8Text = await generateWithRetry(geminiModel, page8Prompt, null, MAX_RETRIES, ctx, loadingMessageId, plan[5], 66);

    const eightSlide = pptx.addSlide();
    eightSlide.background = { path: path.resolve(backgroundImages[7]) };
    eightSlide.addText((plan[5] || 'Mavzu 5').toUpperCase(), {
      x: 1.1, y: 0.3, align: "center", fontSize: 20, bold: true, fontFace: "Times New Roman", color: "FFFFFF", w: 5.35, h: 0.59,
    });
    eightSlide.addText(page8Text, {
      x: 1.1, y: 1.25, align: "justify", fontSize: 19, fontFace: "Times New Roman", color: "FFFFFF", w: 7.97, h: 4.04
    });

    // 10. 9-sahifa (plan[6]) - 70%
    await updateProgress(ctx, loadingMessageId, "9-sahifa tayyorlanmoqda...", 72);

    const page9Prompt = getMukammalPrompt(presentationData.topic, plan[6]);
    const page9Text = await generateWithRetry(geminiModel, page9Prompt, null, MAX_RETRIES, ctx, loadingMessageId, plan[6], 71);

    const nineSlide = pptx.addSlide();
    nineSlide.background = { path: path.resolve(backgroundImages[8]) };
    nineSlide.addText((plan[6] || 'Mavzu 6').toUpperCase(), {
      x: 3.62, y: 0.07, align: "center", fontSize: 20, bold: true, fontFace: "Times New Roman", color: "FFFFFF", w: 6.08, h: 1.05
    });
    nineSlide.addText(page9Text, {
      x: 1.62, y: 1.19, align: "justify", fontSize: 19, fontFace: "Times New Roman", color: "FFFFFF", w: 7.9, h: 3.62,
    });

    // 11. 10-sahifa (plan[7]) - 75%
    await updateProgress(ctx, loadingMessageId, "10-sahifa tayyorlanmoqda...", 78);

    const page10Prompt = getMukammalPrompt(presentationData.topic, plan[7]);
    const page10Text = await generateWithRetry(geminiModel, page10Prompt, null, MAX_RETRIES, ctx, loadingMessageId, plan[7], 76);

    const tenSlide = pptx.addSlide();
    tenSlide.background = { path: path.resolve(backgroundImages[9]) };
    tenSlide.addText((plan[7] || 'Mavzu 7').toUpperCase(), {
      x: 1.22, y: 0.25, align: "center", fontSize: 20, bold: true, fontFace: "Times New Roman", color: "FFFFFF", w: 6.87, h: 0.8,
    });
    tenSlide.addText(page10Text, {
      x: 1.51, y: 1.28, align: "justify", fontSize: 18, fontFace: "Times New Roman", color: "FFFFFF",w: 8.06, h: 3.12,
    });

    // 12. 11-sahifa (plan[8]) - 80%
    await updateProgress(ctx, loadingMessageId, "11-sahifa tayyorlanmoqda...", 83);

    const page11Prompt = getMukammalPrompt(presentationData.topic, plan[8]);
    const page11Text = await generateWithRetry(geminiModel, page11Prompt, null, MAX_RETRIES, ctx, loadingMessageId, plan[8], 81);

    const elevenSlide = pptx.addSlide();
    elevenSlide.background = { path: path.resolve(backgroundImages[10]) };
    elevenSlide.addText((plan[8] || 'Mavzu 8').toUpperCase(), {
      x: 1.1, y: 0.3, align: "center", fontSize: 20, bold: true, fontFace: "Times New Roman", color: "FFFFFF", w: 5.35, h: 0.59,
    });
    elevenSlide.addText(page11Text, {
      x: 1.1, y: 1.25, align: "justify", fontSize: 18, fontFace: "Times New Roman", color: "FFFFFF", w: 7.97, h: 4.04
    });

    // 13. 12-sahifa (plan[9]) - 85%
    await updateProgress(ctx, loadingMessageId, "12-sahifa tayyorlanmoqda...", 86);

    const page12Prompt = getMukammalPrompt(presentationData.topic, plan[9]);
    const page12Text = await generateWithRetry(geminiModel, page12Prompt, null, MAX_RETRIES, ctx, loadingMessageId, plan[9], 86);

    const twelveSlide = pptx.addSlide();
    twelveSlide.background = { path: path.resolve(backgroundImages[11]) };
    twelveSlide.addText((plan[9] || 'Xulosa oldi').toUpperCase(), {
      x: 0.3, y: 0.06, align: "center", fontSize: 22, bold: true, fontFace: "Times New Roman", color: "FFFFFF", h: 0.8, w: 7.61,
    });
    twelveSlide.addText(page12Text, {
      x: 0.66, y: 1.32, align: "justify", fontSize: 20, fontFace: "Times New Roman", color: "FFFFFF", w: 8.66, h: 3.14
    });

    // 14. 13-sahifa: YAKUNIY XULOSA (YAXSHILANGAN) - 90%
    await updateProgress(ctx, loadingMessageId, "Xulosa yozilmoqda...", 93);

    // YANGI: Soddaroq va aniqroq prompt
    const finalConclusionPrompt = `"${presentationData.topic}" mavzusi bo'yicha YAKUNIY XULOSA yoz.

TALABLAR:
- 70-100 so'z oralig'ida (juda muhim!)
- Mavzuning asosiy natijalarini umumlashtirish
- Amaliy ahamiyatini ta'kidlash
- Faqat matn, hech qanday sarlavha yo'q
- Oddiy va tushunarli til

Xulosa matni:`;

    const page13Text = await generateWithRetry(geminiModel, finalConclusionPrompt, null, MAX_RETRIES, ctx, loadingMessageId, "Xulosa", 91);

    const conclusionSlide = pptx.addSlide();
    conclusionSlide.background = { path: path.resolve(backgroundImages[12]) };
    conclusionSlide.addText(page13Text, {
      x: 0.48, y: 1.27, align: "justify", fontSize: 17, fontFace: "Times New Roman", color: "FFFFFF", h: 3.57, w: 4.83
    });

    // 15. 14-sahifa: Yakuniy sahifa - 95%
    await updateProgress(ctx, loadingMessageId, "Yakuniy sahifa shakllantirilmoqda...", 96);

    const endSlide = pptx.addSlide();
    endSlide.background = { path: path.resolve(backgroundImages[13]) };
    endSlide.addText(`${presentationData.authorName.toUpperCase()}`, {
      x: 1.45, w: "45%", y: 5.05, valign: "middle", fontSize: 18,
      fontFace: "Agency FB", color: "000000", bold: true,
    });
    endSlide.addText(`${presentationData.institution.toTitleCase()}`, {
      x: 1.48, y: 0.6, w: "48%", fontSize: 18, color: "FFFFFF",
      fontFace: "Agency FB", bold: true,
    });

    // Fayl saqlash - 99%
    await updateProgress(ctx, loadingMessageId, "Fayl yuborishga tayyorlanmoqda...", 99);

    const safeFileName = `${presentationData.authorName}_${presentationData.topic}`
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 50);

    filePath = path.resolve(`${safeFileName}.pptx`);
    await pptx.writeFile({ fileName: filePath });
    logger.info("PPTX fayl muvaffaqiyatli saqlandi (Template 3 - Tuzatilgan)");

    // Yakuniy xabar
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessageId);
    await ctx.telegram.sendDocument(ctx.chat.id, { source: filePath });
    await ctx.reply(
      `✅ Prezentatsiya tayyor! Yuklab olishingiz mumkin!\n\n` +
      `📌 Eslatma: Taqdimot telefonda ochilganda yozuvlar ustma-ust tushib qolishi mumkin. ` +
      `Shu sababli, kompyuterda ochib ko'rishingiz tavsiya etiladi. 😊`,
      Markup.keyboard([["🔙 Orqaga"]]).resize()
    );

    user.balance -= PRICE;
    user.balanceHistory.push({ amount: -PRICE, date: new Date() });
    await user.save();

    if (onComplete) {
      await onComplete(filePath);
    }

    ctx.session = {};

  } catch (error) {
    logger.error(`Template 3 (tuzatilgan) yaratishda xato: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);

    if (loadingMessageId) {
        try {
            await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessageId);
        } catch (e) {
            logger.error(`Loading xabarini o'chirishda xato: ${e.message}`);
        }
    }

    await ctx.reply(
      "❌ Prezentatsiya yaratishda xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring yoki admin bilan bog'laning.",
      Markup.keyboard([["🔙 Orqaga"]]).resize()
    );

  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        logger.info(`Fayl serverdan o'chirildi: ${filePath}`);
      } catch (err) {
        logger.error(`Faylni o'chirishda xato: ${err.message}`);
      }
    }
  }
}

module.exports = { handle, price: PRICE };