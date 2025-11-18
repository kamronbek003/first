const PptxGenJS = require("pptxgenjs");
const path = require("path");
const { Markup } = require("telegraf");

const PRICE = 6000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const MIN_UPDATE_DELAY = 1400; // Minimal 1.4 sekund vaqt oralig'i (Oldingi versiyadan unifikatsiya qilindi)

const backgroundImages = [
  "shablonlar/2/1.png",
  "shablonlar/2/2.png",
  "shablonlar/2/3.png",
  "shablonlar/2/4.png",
  "shablonlar/2/5.png",
  "shablonlar/2/6.png",
  "shablonlar/2/7.png",
  "shablonlar/2/8.png",
  "shablonlar/2/9.png",
  "shablonlar/2/10.png",
  "shablonlar/2/11.png",
  "shablonlar/2/12.png",
];

// === YORDAMCHI FUNKSIYALAR ===

/**
 * AI'dan kelgan matnni tozalash uchun "aqlli" funksiya.
 */
function cleanupText(text) {
  if (!text) return "";
  let cleaned = text;

  // 1. Markdown, sarlavha va keraksiz prefikslarni olib tashlash
  cleaned = cleaned
    .replace(/```/g, "")
    .replace(/\*\*/g, "")
    .replace(/^[#]+\s+/gm, "")
    .replace(/^[-*•]\s+/gm, "");

  // 2. AI tomonidan qo'shilishi mumkin bo'lgan "context" so'zlarni olib tashlash (case-insensitive)
  cleaned = cleaned
    .replace(/^matn:?\s*/i, "")
    .replace(/^javob:?\s*/i, "")
    .replace(/^xulosa:?\s*/i, "")
    .replace(/^kirish:?\s*/i, "")
    .replace(/^paragraf \d+:?\s*/i, "");

  // 3. Matnni bir qatorga keltirish va ortiqcha probellarni tozalash
  cleaned = cleaned.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");

  // 4. Bosh va oxiridagi qo'shtirnoq va probellarni olib tashlash
  cleaned = cleaned.trim().replace(/^["']|["']$/g, "").trim();

  return cleaned;
}

// Progress xabarini yangilash funksiyasi (Sodda format + minimal delay qo'shildi)
async function updateProgress(ctx, messageId, text, percent, minDelay = MIN_UPDATE_DELAY) {
  const startTime = Date.now();
  try {
    const progressBar = getProgressBar(percent);
    // Faqat oddiy text va progress bar
    const message = `${text}\n\n${progressBar} ${percent}%`;

    await ctx.telegram.editMessageText(ctx.chat.id, messageId, null, message);

    // Minimal vaqt kutish
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

// Animatsiyali progress bar
function getProgressBar(percent) {
  const filled = Math.floor(percent / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

// Gemini'dan javob olish uchun retry mexanizmi
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

      if (expectedFormat === "triple") {
        const parts = text.split("$");
        if (parts.length >= 3) {
          return parts.map((p) => cleanupText(p)).filter((p) => p.length > 0).slice(0, 3);
        }
        throw new Error(`Noto'g'ri format (triple): ${parts.length} ta paragraf topildi`);
      }

      const cleanedText = cleanupText(text);

      if (cleanedText.length < 15) {
        throw new Error(`Juda qisqa javob (tozalandi): ${cleanedText.length} ta belgi`);
      }

      return cleanedText;

    } catch (error) {
      console.error(`Urinish ${attempt}/${retries} muvaffaqiyatsiz (${stepName}): ${error.message}`);

      if (attempt === retries) {
        if (expectedFormat === "outline") {
          return ["Kirish", "Tarix", "Asosiy tushunchalar", "Turlar", "Afzalliklar", "Kamchiliklar", "Qo'llanilishi", "Statistika", "Tahlil", "Xulosa"];
        }
        if (expectedFormat === "triple") {
          return [ "Asosiy g'oya 1", "Asosiy g'oya 2", "Asosiy g'oya 3" ];
        }
        return "Ushbu bo'lim uchun ma'lumot tayyorlashda texnik muammo yuz berdi.";
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

// MUKAMMAL matn prompt shabloni (Oldingi talab bo'yicha standartlashtirildi)
function getMukammalPrompt(topic, section) {
  return `"${topic}" mavzusining "${section}" bo'limi uchun MUKAMMAL matn yoz.

TALABLAR:
- Aniq 90-120 so'z
- "${section}" ni to'liq qamrab olish
- Aniq va konkret ma'lumotlar
- Mantiqiy strukturada
- Faqat matn, hech qanday sarlavha yo'q

Matn:`;
}


// === ASOSIY HANDLE FUNKSIYASI ===

async function handle(
  ctx,
  { User, geminiModel, showLoading, logger, bot, fs, onComplete }
) {
  const user = await User.findOne({ telegramId: ctx.from.id.toString() });
  if (!user || user.balance < PRICE) {
    await ctx.reply(
      `Balansingiz yetarli emas! Ushbu shablon narxi: ${PRICE} so‘m`,
      Markup.keyboard([["🔙 Orqaga"]]).resize()
    );
    return;
  }

  const presentationData = ctx.session.presentationData;
  let filePath;

  // Boshlang'ich xabar soddalashtirildi
  const loadingMsg = await ctx.reply(
    `Taqdimot yaratish boshlanmoqda...\n\n░░░░░░░░░░ 0%`,
    { parse_mode: null }
  );
  const loadingMessageId = loadingMsg.message_id;

  try {
    // 1. Reja olish - 5%
    await updateProgress(ctx, loadingMessageId, "Reja tuzilmoqda...", 4);

    const outlinePrompt = `"${presentationData.topic}" mavzusi bo'yicha prezentatsiya uchun FAQAT 10 ta reja sarlavhalarini yoz.
QATTIY QOIDALAR:
1. Har bir sarlavha $ belgisi bilan ajratilsin
2. Sarlavhalar qisqa va aniq bo'lsin (2-4 so'z)
3. Hech qanday raqam, nuqta yoki qo'shimcha belgilar ishlatma
4. Faqat sarlavhalarni yoz, hech qanday tushuntirish berma
5. Birinchi sarlavha "Kirish", oxirgisi "Xulosa" bo'lsin
NAMUNA FORMAT:
Kirish$Tarix$Asosiy tushunchalar$Turlar$Amaliy qo'llanish$Afzalliklari$Kamchiliklari$Holat$Kelajak$Xulosa
ENDI "${presentationData.topic}" uchun 10 ta sarlavha yoz:`;

    const plan = await generateWithRetry(
      geminiModel, outlinePrompt, "outline", MAX_RETRIES,
      ctx, loadingMessageId, "📋 Reja yaratilmoqda", 10
    );

    // 2. Bosh sahifa - 20%
    await updateProgress(ctx, loadingMessageId, "Bosh sahifa tayyorlanmoqda...", 21);

    const pptx = new PptxGenJS();

    const titleSlide = pptx.addSlide();
    titleSlide.background = { path: path.resolve(backgroundImages[0]) };
    titleSlide.addText(`${presentationData.topic}`, {
      x: 0.8, y: 2.15, w: "59%", fontSize: 36, bold: true, color: "000000",
      fontFace: "Agency FB",
    });
    titleSlide.addText(`${presentationData.authorName}`, {
      x: 1.45, w: "45%", y: 5.05, valign: "middle", fontSize: 18,
      fontFace: "Agency FB", color: "000000", bold: true,
    });
    titleSlide.addText(`${presentationData.institution}`, {
      x: 1.45, y: 0.6, w: "48%", fontSize: 18, color: "000000",
      fontFace: "Agency FB", bold: true,
    });

    // 3. Mundarija - 30%
    await updateProgress(ctx, loadingMessageId, "Mundarija tayyorlanmoqda...", 33);

    const secondSlide = pptx.addSlide();
    secondSlide.background = { path: path.resolve(backgroundImages[1]) };
    const menuItems = [plan[0], plan[1], plan[3], plan[5], plan[7]];
    secondSlide.addText(plan[0], { x: 4.5, y: 1.6, fontSize: 22, fontFace: "Agency FB", bold: true, color: "000000", w: "50%" });
    secondSlide.addText(plan[1], { x: 4.5, y: 2.3, fontSize: 22, fontFace: "Agency FB", bold: true, color: "000000", w: "50%" });
    secondSlide.addText(plan[3], { x: 4.5, y: 3.0, fontSize: 22, fontFace: "Agency FB", bold: true, color: "000000", w: "50%" });
    secondSlide.addText(plan[5], { x: 4.5, y: 3.7, fontSize: 22, fontFace: "Agency FB", bold: true, color: "000000", w: "50%" });
    secondSlide.addText(plan[7], { x: 4.5, y: 4.4, fontSize: 22, fontFace: "Agency FB", bold: true, color: "000000", w: "50%" });


    // 4. Kirish - 40%
    await updateProgress(ctx, loadingMessageId, "3-sahifa tayyorlanmoqda...", 38);

    const page3Prompt = `"${presentationData.topic}" mavzusi uchun prezentatsiyaning KIRISH slaydi uchun matn yoz. Matn mavzuni umumiy tanishtirishi kerak. QAT'IY TALABLAR: 40-50 so'z. Faqat matnni o'zini yoz (sarlavhasiz, prefikssiz).`;
    const kirish1Prompt = `"${presentationData.topic}" mavzusi bo'yicha BIRINCHI asosiy FAKT yoki G'OYAni yoz. QAT'IY TALABLAR: 15-20 so'z. Faqat bitta jumlani yoz.`;
    const kirish2Prompt = `"${presentationData.topic}" mavzusi bo'yicha IKKINCHI asosiy FAKT yoki XUSUSIYATNI yoz. QAT'IY TALABLAR: 15-20 so'z. Faqat bitta jumlani yoz.`;
    const kirish3Prompt = `"${presentationData.topic}" mavzusi bo'yicha UCHINCHI asosiy FAKT yoki AHAMIYATNI yoz. QAT'IY TALABLAR: 15-20 so'z. Faqat bitta jumlani yoz.`;

    const page3Text = await generateWithRetry(geminiModel, page3Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "📝 Kirish matni", 41);
    const kirish1Text = await generateWithRetry(geminiModel, kirish1Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "💡 Fikr 1", 42);
    const kirish2Text = await generateWithRetry(geminiModel, kirish2Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "💡 Fikr 2", 43);
    const kirish3Text = await generateWithRetry(geminiModel, kirish3Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "💡 Fikr 3", 44);

    const thirdSlide = pptx.addSlide();
    thirdSlide.background = { path: path.resolve(backgroundImages[2]) };
    thirdSlide.addText(page3Text, {
      x: 0.1, y: 1.3, fontSize: 17, fontFace: "Calibri Light",
      color: "FFFFFF", w: 3.59, h: 3.5,
    });
    thirdSlide.addText(kirish1Text, {
      x: 5.06, y: 0.96, fontSize: 17, fontFace: "Agency FB",
      color: "000000", w: 4.74, h: 1.05,
    });
    thirdSlide.addText(kirish2Text, {
      x: 5.06, y: 2.23, fontSize: 17, fontFace: "Agency FB",
      color: "000000", w: 4.74, h: 1.05,
    });
    thirdSlide.addText(kirish3Text, {
      x: 5.06, y: 3.5, fontSize: 17, fontFace: "Agency FB",
      color: "000000", w: 4.74, h: 1.05,
    });

    // 5. Sahifa 4 - 50%
    await updateProgress(ctx, loadingMessageId, "4-sahifa tayyorlanmoqda...", 52);

    const page4Prompt = `Prezentatsiya slaydi uchun "${presentationData.topic}" mavzusining "${plan[1]}" bo'limi uchun 3 ta ALOHIDA matn bloki yoz. Har bir blok alohida g'oyani ifodalasin.
QAT'IY FORMAT: matn1$matn2$matn3
QAT'IY TALABLAR: Har bir matn bloki 30-40 so'z. $ belgisidan boshqa hech narsa qo'shma. Sarlavha, raqam yo'q.`;

    const page4Text = await generateWithRetry(
      geminiModel, page4Prompt, "triple", MAX_RETRIES,
      ctx, loadingMessageId, `📝 ${plan[1]}`, 52
    );

    const fourSlide = pptx.addSlide();
    fourSlide.background = { path: path.resolve(backgroundImages[3]) };
    fourSlide.addText(plan[1], {
      x: 0.12, y: 0.07, fontSize: 24, h: 0.7, w: 7.27, bold: true,
      fontFace: "Times New Roman", color: "FFFFFF",
    });
    fourSlide.addText(page4Text[0], {
      x: 0.61, y: 2.04, h: 3.11, w: 2.59, align: "center", fontSize: 14,
      fontFace: "Times New Roman", color: "000000",
    });
    fourSlide.addText(page4Text[1], {
      x: 3.73, y: 2.04, align: "center", fontSize: 14, h: 3.11, w: 2.59,
      fontFace: "Times New Roman", color: "000000",
    });
    fourSlide.addText(page4Text[2], {
      x: 6.84, y: 2.04, align: "center", fontSize: 14,
      fontFace: "Times New Roman", color: "000000", h: 3.11, w: 2.59,
    });

    // 6. Sahifa 5 - 60% (MUKAMMAL prompt qo'llanildi)
    await updateProgress(ctx, loadingMessageId, "5-sahifa tayyorlanmoqda...", 63);

    const page5Prompt = getMukammalPrompt(presentationData.topic, plan[2]);
    const page5Text = await generateWithRetry(geminiModel, page5Prompt, null, MAX_RETRIES, ctx, loadingMessageId, `📝 ${plan[2]}`, 65);

    const fifeSlide = pptx.addSlide();
    fifeSlide.background = { path: path.resolve(backgroundImages[4]) };
    fifeSlide.addText(plan[2], {
      x: 3.08, y: 0.06, fontSize: 28, bold: true,
      fontFace: "Times New Roman", color: "FFFFFF", h: 1.12, w: 6.15,
    });
    fifeSlide.addText(page5Text, {
      x: 1.6, y: 1.57, align: "justify", fontSize: 20,
      fontFace: "Times New Roman", color: "000000", w: 7.7, h: 3.41
    });

    // 7. Sahifa 6 - 70% (MUKAMMAL prompt qo'llanildi)
    await updateProgress(ctx, loadingMessageId, "6-sahifa tayyorlanmoqda...", 70);
    const slide6Prompt = getMukammalPrompt(presentationData.topic, plan[3]);
    const page6Text = await generateWithRetry(geminiModel, slide6Prompt, null, MAX_RETRIES, ctx, loadingMessageId, `📝 ${plan[3]}`, 71);

    const sixSlide = pptx.addSlide();
    sixSlide.background = { path: path.resolve(backgroundImages[5]) };
    sixSlide.addText(plan[3], {
      x: 1.48, y: 0.16, align: "center", fontSize: 24, bold: true, w: 7.27, h: 0.84,
      fontFace: "Times New Roman", color: "FFFFFF",
    });
    sixSlide.addText(page6Text, {
      x: 0.99, y: 1.45, align: "justify", fontSize: 18,
      fontFace: "Times New Roman", color: "FFFFFF", w: 8.3, h: 3.36
    });

    // 8. Sahifa 7 - 80% (MUKAMMAL prompt qo'llanildi)
    await updateProgress(ctx, loadingMessageId, "7-sahifa tayyorlanmoqda...", 80);
    const slide7Prompt = getMukammalPrompt(presentationData.topic, plan[4]);
    const page7Text = await generateWithRetry(geminiModel, slide7Prompt, null, MAX_RETRIES, ctx, loadingMessageId, `📝 ${plan[4]}`, 81);

    const sevenSlide = pptx.addSlide();
    sevenSlide.background = { path: path.resolve(backgroundImages[6]) };
    sevenSlide.addText(plan[4], { // plan[4]
      x: 3.47, y: 0.16, align: "center", fontSize: 24, bold: true, w: 6.02, h: 0.84,
      fontFace: "Times New Roman", color: "FFFFFF",
    });
    sevenSlide.addText(page7Text, { // sevenSlide obyekti to'g'ri ishlatildi
      x: 0.99, y: 1.45, align: "justify", fontSize: 18,
      fontFace: "Times New Roman", color: "000000", w: 8.3, h: 3.36
    });

    // 9. Sahifa 8 - 85% (MUKAMMAL prompt qo'llanildi)
    await updateProgress(ctx, loadingMessageId, "8-sahifa tayyorlanmoqda...", 85);
    const slide8Prompt = getMukammalPrompt(presentationData.topic, plan[5]);
    const page8Text = await generateWithRetry(geminiModel, slide8Prompt, null, MAX_RETRIES, ctx, loadingMessageId, `📝 ${plan[5]}`, 86);

    const eightSlide = pptx.addSlide();
    eightSlide.background = { path: path.resolve(backgroundImages[7]) };
    eightSlide.addText(plan[5], { // plan[5]
      x: 1.48, y: 0.16, align: "center", fontSize: 24, bold: true, w: 7.27, h: 0.84,
      fontFace: "Times New Roman", color: "FFFFFF",
    });
    eightSlide.addText(page8Text, {
      x: 0.99, y: 1.45, align: "justify", fontSize: 18,
      fontFace: "Times New Roman", color: "FFFFFF", w: 8.3, h: 3.36
    });

    // 10. Sahifa 9 - 90% (MUKAMMAL prompt qo'llanildi)
    await updateProgress(ctx, loadingMessageId, "9-sahifa tayyorlanmoqda...", 92);
    const slide9Prompt = getMukammalPrompt(presentationData.topic, plan[6]);
    const page9Text = await generateWithRetry(geminiModel, slide9Prompt, null, MAX_RETRIES, ctx, loadingMessageId, `📝 ${plan[6]}`, 91);

    const nineSlide = pptx.addSlide();
    nineSlide.background = { path: path.resolve(backgroundImages[8]) };
    nineSlide.addText(plan[6], { // plan[6]
      x: 0.49, y: 0, align: "center", fontSize: 24, bold: true, w: 8.8, h: 0.84,
      fontFace: "Times New Roman", color: "FFFFFF",
    });
    nineSlide.addText(page9Text, { // nineSlide obyekti to'g'ri ishlatildi
      x: 0.99, y: 1.45, align: "justify", fontSize: 18,
      fontFace: "Times New Roman", color: "000000", w: 8.3, h: 3.36
    });

    // 11. Xulosa - 95%
    await updateProgress(ctx, loadingMessageId, "Xulosa yozilmoqda...", 96);

    const page10Prompt = `"${presentationData.topic}" mavzusi bo'yicha prezentatsiyaning YAKUNIY XULOSA slaydi uchun matn yoz. Matn barcha asosiy fikrlarni umumlashtirishi va mavzuning ahamiyatini ta'kidlashi kerak.
QAT'IY TALABLAR: Aniq 90-100 so'z. Faqat matnni o'zini yoz (sarlavhasiz, prefikssiz).`;

    const page10Text = await generateWithRetry(geminiModel, page10Prompt, null, MAX_RETRIES, ctx, loadingMessageId, `🎯 Xulosa`, 96);

    const tenSlide = pptx.addSlide();
    tenSlide.background = { path: path.resolve(backgroundImages[9]) };
    tenSlide.addText(page10Text, {
      x: 0.39, y: 1.3, align: "justify", fontSize: 14,
      fontFace: "Times New Roman", color: "FFFFFF", w: 4.83, h: 3.35,
    });

    // 12. Yakuniy sahifa - 98%
    await updateProgress(ctx, loadingMessageId, "Yakuniy sahifa shakllantirilmoqda...", 98);

    const endSlide = pptx.addSlide();
    endSlide.background = { path: path.resolve(backgroundImages[11]) }; // 11-indeks = 12-rasm
    endSlide.addText(`${presentationData.authorName}`, {
      x: 1.45, w: "45%", y: 5.05, valign: "middle", fontSize: 18,
      fontFace: "Agency FB", color: "000000", bold: true,
    });
    endSlide.addText(`${presentationData.institution}`, {
      x: 1.45, y: 0.6, w: "48%", fontSize: 18, color: "000000",
      fontFace: "Agency FB", bold: true,
    });

    // Fayl saqlash - 99%
    await updateProgress(ctx, loadingMessageId, "Fayl yuborishga tayyorlanmoqda...", 99);

    const safeFileName = `${presentationData.authorName}_${presentationData.topic}`
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 50);

    filePath = path.resolve(`${safeFileName}.pptx`);
    await pptx.writeFile({ fileName: filePath });
    logger.info("PPTX fayl muvaffaqiyatli saqlandi (Template 2 final)");

    // Yakuniy xabar
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessageId);
    await ctx.telegram.sendDocument(ctx.chat.id, { source: filePath });
    await ctx.reply(
      `✅ Prezentatsiya tayyor! Yuklab olishingiz mumkin!\n\n` +
      `📌 Eslatma: Taqdimot telefonda ochilganda yozuvlar ustma-ust tushib qolishi mumkin. ` +
      `Shu sababli, kompyuterda ochib ko‘rishingiz tavsiya etiladi. 😊`,
      Markup.keyboard([["🔙 Orqaga"]]).resize()
    );

    user.balance -= PRICE;
    user.balanceHistory.push({ amount: -PRICE, date: new Date() });
    await user.save();
    logger.info(`Balans yangilandi: ${user.balance}`);

    if (onComplete) {
      await onComplete(filePath);
    }

    ctx.session = {};

  } catch (error) {
    logger.error(`Template 2 (final) yaratishda katta xato: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);

    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessageId);
    } catch (e) {
      logger.error(`Loading xabarini o'chirishda xato: ${e.message}`);
    }

    await ctx.reply(
      "❌ Prezentatsiya yaratishda xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring yoki admin bilan bog'laning.",
      Markup.keyboard([["🔙 Orqaga"]]).resize()
    );

  } finally {
    // FAYLNI O'CHIRISH (Xatolik bo'lsa ham, muvaffaqiyatli yakunlansa ham)
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