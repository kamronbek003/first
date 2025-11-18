const PptxGenJS = require("pptxgenjs");
const path = require("path");
const { Markup } = require("telegraf");

const PRICE = 6000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const MIN_UPDATE_DELAY = 1400; 

const backgroundImages = [
  "shablonlar/1/1.png",
  "shablonlar/1/2.png",
  "shablonlar/1/3.png",
  "shablonlar/1/4.png",
  "shablonlar/1/5.png",
  "shablonlar/1/6.png",
  "shablonlar/1/7.png",
  "shablonlar/1/8.png",
  "shablonlar/1/9.png",
  "shablonlar/1/10.png",
  "shablonlar/1/11.png",
  "shablonlar/1/12.png",
];

// Progress xabarini yangilash funksiyasi
async function updateProgress(ctx, messageId, text, percent) {
  const startTime = Date.now();
  try {
    const progressBar = getProgressBar(percent);
    const message = `${text}\n\n${progressBar} ${percent}%`;
    
    await ctx.telegram.editMessageText(ctx.chat.id, messageId, null, message);

    // Minimal vaqt kutish
    const elapsed = Date.now() - startTime;
    if (elapsed < MIN_UPDATE_DELAY) {
      await new Promise(resolve => setTimeout(resolve, MIN_UPDATE_DELAY - elapsed));
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

// Gemini'dan javob olish
async function generateWithRetry(geminiModel, prompt, expectedFormat = null, retries = MAX_RETRIES, ctx = null, loadingMsgId = null, stepName = "", stepProgress = 0) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await geminiModel.generateContent(prompt);
      let text = result.response.text().trim();
      text = text.replace(/```/g, '').replace(/\*\*/g, '').trim();
      
      if (expectedFormat === 'outline') {
        const parts = text.split("$");
        if (parts.length >= 10) {
          return parts.map(p => p.trim()).filter(p => p.length > 0).slice(0, 10);
        }
        throw new Error(`Noto'g'ri format: ${parts.length} ta qism topildi`);
      }
      
      if (expectedFormat === 'triple') {
        const parts = text.split("$");
        if (parts.length >= 3) {
          return parts.map(p => p.trim()).filter(p => p.length > 0).slice(0, 3);
        }
        throw new Error(`Noto'g'ri format: ${parts.length} ta paragraf topildi`);
      }
      
      if (text.length < 20) {
        throw new Error(`Juda qisqa javob: ${text.length} ta belgi`);
      }
      
      return text;
      
    } catch (error) {
      console.error(`Urinish ${attempt}/${retries} muvaffaqiyatsiz: ${error.message}`);
      
      if (attempt === retries) {
        if (expectedFormat === 'outline') {
          return ["Kirish", "Asosiy qism - 1", "Asosiy qism - 2", "Asosiy qism - 3", "Asosiy qism - 4", "Asosiy qism - 5", "Asosiy qism - 6", "Asosiy qism - 7", "Tahlil", "Xulosa"];
        }
        if (expectedFormat === 'triple') {
          return ["Ma'lumot tayyorlanmoqda...", "Ma'lumot tayyorlanmoqda...", "Ma'lumot tayyorlanmoqda..."];
        }
        return "Ma'lumot tayyorlanmoqda. Iltimos, keyinroq tekshiring.";
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

// MUKAMMAL matn prompt shabloni (Aniq 75-90 so'z)
function getMukammalPrompt(topic, section) {
  return `"${topic}" mavzusining "${section}" bo'limi uchun MUKAMMAL matn yoz.

TALABLAR:
- Aniq 75-90 so'z
- "${section}" ni to'liq qamrab olish
- Aniq va konkret ma'lumotlar
- Mantiqiy strukturada
- Faqat matn, hech qanday sarlavha yo'q

Matn:`;
}


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

  const loadingMsg = await ctx.reply(
    `Taqdimot yaratish boshlanmoqda...\n\n░░░░░░░░░░ 0%`,
    { parse_mode: null }
  );
  const loadingMessageId = loadingMsg.message_id;

  try {
    // 1. Reja olish - 5%
    await updateProgress(ctx, loadingMessageId, "Reja tuzilmoqda...", 5);

    const outlinePrompt = `"${presentationData.topic}" mavzusi bo'yicha prezentatsiya uchun FAQAT 10 ta reja sarlavhalarini yoz.

QATTIY QOIDALAR:
1. Har bir sarlavha $ belgisi bilan ajratilsin
2. Sarlavhalar qisqa va aniq bo'lsin (2-4 so'z)
3. Hech qanday raqam, nuqta yoki qo'shimcha belgilar ishlatma
4. Faqat sarlavhalarni yoz, hech qanday tushuntirish berma
5. Birinchi sarlavha "Kirish", oxirgisi "Xulosa" bo'lsin

NAMUNA FORMAT:
Kirish$Tarix va rivojlanish$Asosiy tushunchalar$Turlar va toifalar$Amaliy qo'llanish$Afzalliklari$Kamchiliklari$Hozirgi holat$Kelajak istiqbollari$Xulosa

ENDI "${presentationData.topic}" uchun 10 ta sarlavha yoz:`;

    const planRaw = await generateWithRetry(geminiModel, outlinePrompt, 'outline', MAX_RETRIES, ctx, loadingMessageId, "Reja", 5);
    
    const plan = planRaw.map(item => {
      return item
        .replace(/^\d+[\.\)]\s*/g, '')
        .replace(/^[-•]\s*/g, '')
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, 50);
    }).filter(item => item.length > 0);

    // 2. Bosh sahifa - 15%
    await updateProgress(ctx, loadingMessageId, "Bosh sahifa tayyorlanmoqda...", 14);

    const pptx = new PptxGenJS();

    const titleSlide = pptx.addSlide();
    titleSlide.background = { path: path.resolve(backgroundImages[0]) };
    
    const topicLength = presentationData.topic.length;
    let topicFontSize = 36;
    let topicHeight = "35%";
    
    if (topicLength > 80) {
      topicFontSize = 24;
      topicHeight = 1.63;
    } else if (topicLength > 50) {
      topicFontSize = 28;
      topicHeight = 1.63;
    } else if (topicLength > 30) {
      topicFontSize = 60;
      topicHeight = 1.63;
    }
    
    titleSlide.addText(`${presentationData.topic}`, {
      x: 0.69, y: 1.04, w: 5.57, h: topicHeight, fontSize: topicFontSize, bold: true,
      color: "000000", fontFace: "Agency FB", valign: "middle",
    });
    
    titleSlide.addText(`${presentationData.authorName}`, {
      x: 1.54, w: 4.72, y: 4.8, h: "10%", fontSize: 22,
      fontFace: "Agency FB", color: "000000", bold: true, valign: "middle",
    });
    
    titleSlide.addText(`${presentationData.institution}`, {
      x: 1.45, y: 0.3, w: "45%", h: "11%", fontSize: 18,
      color: "000000", fontFace: "Agency FB", bold: true, valign: "middle",
    });

    // 3. Mundarija - 25%
    await updateProgress(ctx, loadingMessageId, "Mundarija tayyorlanmoqda...", 23);

    const secondSlide = pptx.addSlide();
    secondSlide.background = { path: path.resolve(backgroundImages[1]) };
    const menuItems = [plan[0], plan[1], plan[3], plan[5], plan[7]];
    menuItems.forEach((item, index) => {
      secondSlide.addText(item, {
        x: 4.55, y: 1.6 + (index * 0.7), fontSize: 22,
        fontFace: "Agency FB", bold: true, color: "000000", w: "50%",
      });
    });

    // 4. Kirish - 35% (Maxsus qism - o'zgarishsiz)
    await updateProgress(ctx, loadingMessageId, "3-sahifa tayyorlanmoqda...", 35);
    
    const page3Prompt = `"${presentationData.topic}" mavzusi bo'yicha prezentatsiyaning KIRISH qismi uchun matn yoz.

TALABLAR:
- Aniq 35-40 so'z
- Mavzuni qisqacha tanishtirish
- Umumiy tasavvur berish
- Oddiy va tushunarli til
- Faqat matnni yoz, boshqa hech narsa yo'q`;

    const page3Text = await generateWithRetry(geminiModel, page3Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Kirish", 35);
    
    const kirish1Prompt = `"${presentationData.topic}" haqida birinchi muhim FAKT yoki FIKR.
TALABLAR: Aniq 20-25 so'z, Faqat matn.`;
    const kirish1Text = await generateWithRetry(geminiModel, kirish1Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Fikr 1", 38);
    
    const kirish2Prompt = `"${presentationData.topic}" haqida ikkinchi muhim FAKT yoki XUSUSIYAT.
TALABLAR: Aniq 20-25 so'z, Faqat matn.`;
    const kirish2Text = await generateWithRetry(geminiModel, kirish2Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Fikr 2", 41);
    
    const kirish3Prompt = `"${presentationData.topic}" haqida uchinchi muhim AHAMIYAT yoki FOYDA.
TALABLAR: Aniq 20-25 so'z, Faqat matn.`;
    const kirish3Text = await generateWithRetry(geminiModel, kirish3Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Fikr 3", 44);

    const thirdSlide = pptx.addSlide();
    thirdSlide.background = { path: path.resolve(backgroundImages[2]) };
    thirdSlide.addText(page3Text, { x: 0.1, y: 1.3, fontSize: 17, fontFace: "Calibri Light", color: "FFFFFF", w: 3.59, h: 3.5 });
    thirdSlide.addText(kirish1Text, { x: 5.06, y: 0.96, fontSize: 17, fontFace: "Agency FB", color: "000000", w: 4.74, h: 1.05 });
    thirdSlide.addText(kirish2Text, { x: 5.06, y: 2.23, fontSize: 17, fontFace: "Agency FB", color: "000000", w: 4.74, h: 1.05 });
    thirdSlide.addText(kirish3Text, { x: 5.06, y: 3.5, fontSize: 17, fontFace: "Agency FB", color: "000000", w: 4.74, h: 1.05 });

    // 5. Sahifa 4 - 50% (Maxsus qism - o'zgarishsiz)
    await updateProgress(ctx, loadingMessageId, "4-sahifa tayyorlanmoqda...", 52);
    
    const page4Prompt = `"${presentationData.topic}" mavzusining "${plan[1]}" bo'limi uchun 3 ta ALOHIDA paragraf yoz.
QATTIY FORMATDA: paragraf1$paragraf2$paragraf3
TALABLAR: Har bir paragraf ANIQ 28-32 so'z. $ bilan ajrating.`;
    
    const page4TextRaw = await generateWithRetry(geminiModel, page4Prompt, 'triple', MAX_RETRIES, ctx, loadingMessageId, "Triple", 50);
    const page4Text = page4TextRaw.map(t => t.replace(/^\d+[\.\)]\s*/g, '').replace(/^Paragraf\s*\d+:?\s*/gi, '').replace(/[\r\n]+/g, ' ').trim());

    const fourSlide = pptx.addSlide();
    fourSlide.background = { path: path.resolve(backgroundImages[3]) };
    fourSlide.addText(plan[1], { x: 0.12, y: 0.07, fontSize: 24, h: 0.7, w: 7.27, bold: true, fontFace: "Times New Roman", color: "FFFFFF" });
    fourSlide.addText(page4Text[0], { x: 0.61, y: 2.04, h: 3.11, w: 2.59, align: "center", fontSize: 14, fontFace: "Times New Roman", color: "000000" });
    fourSlide.addText(page4Text[1], { x: 3.73, y: 2.04, align: "center", fontSize: 14, h: 3.11, w: 2.59, fontFace: "Times New Roman", color: "000000" });
    fourSlide.addText(page4Text[2], { x: 6.84, y: 2.04, align: "center", fontSize: 14, fontFace: "Times New Roman", color: "000000", h: 3.11, w: 2.59 });

    // 6. Sahifa 5 - 60% (MUKAMMAL prompt qo'llanildi)
    await updateProgress(ctx, loadingMessageId, "5-sahifa tayyorlanmoqda...", 61);
    
    const page5Prompt = getMukammalPrompt(presentationData.topic, plan[2]);
    
    let page5Text = await generateWithRetry(geminiModel, page5Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Detail", 60);
    page5Text = page5Text.replace(/^#+\s*/gm, '').replace(/^\*\*.*?\*\*:?\s*/gm, '').replace(/[\r\n]+/g, ' ').trim();

    const fifeSlide = pptx.addSlide();
    fifeSlide.background = { path: path.resolve(backgroundImages[4]) };
    fifeSlide.addText(plan[2], { x: 3.08, y: 0.06, fontSize: 28, bold: true, fontFace: "Times New Roman", color: "FFFFFF", h: 1.12, w: 6.15 });
    fifeSlide.addText(page5Text, { x: 1.6, y: 1.57, align: "justify", fontSize: 20, fontFace: "Times New Roman", color: "000000", w: 7.7, h: 3.41 });

    // 7. Sahifa 6 - 68% (MUKAMMAL prompt qo'llanildi)
    await updateProgress(ctx, loadingMessageId, "6-sahifa tayyorlanmoqda...", 68);
    const slide6Prompt = getMukammalPrompt(presentationData.topic, plan[3]);
    
    let slide6Text = await generateWithRetry(geminiModel, slide6Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Slide 6", 68);
    slide6Text = slide6Text.replace(/^#+\s*/gm, '').replace(/^\*\*.*?\*\*:?\s*/gm, '').replace(/^[-•]\s*/gm, '').replace(/[\r\n]+/g, ' ').trim();

    const slide6 = pptx.addSlide();
    slide6.background = { path: path.resolve(backgroundImages[5]) };
    slide6.addText(plan[3], { x: 1.48, y: 0.16, align: "center", fontSize: 24, bold: true, w: 7.27, h: 0.84, fontFace: "Times New Roman", color: "FFFFFF" });
    slide6.addText(slide6Text, { x: 0.99, y: 1.45, align: "justify", fontSize: 18, fontFace: "Times New Roman", color: "FFFFFF", w: 8.3, h: 3.36 });

    // 8. Sahifa 7 - 74% (MUKAMMAL prompt qo'llanildi)
    await updateProgress(ctx, loadingMessageId, "7-sahifa tayyorlanmoqda...", 74);
    const slide7Prompt = getMukammalPrompt(presentationData.topic, plan[4]);
    
    let slide7Text = await generateWithRetry(geminiModel, slide7Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Slide 7", 74);
    slide7Text = slide7Text.replace(/^#+\s*/gm, '').replace(/^\*\*.*?\*\*:?\s*/gm, '').replace(/^[-•]\s*/gm, '').replace(/[\r\n]+/g, ' ').trim();

    const slide7 = pptx.addSlide();
    slide7.background = { path: path.resolve(backgroundImages[6]) };
    slide7.addText(plan[4], { x: 1.48, y: 0.16, align: "center", fontSize: 24, bold: true, w: 7.27, h: 0.84, fontFace: "Times New Roman", color: "FFFFFF" });
    slide7.addText(slide7Text, { x: 0.99, y: 1.45, align: "justify", fontSize: 18, fontFace: "Times New Roman", color: "000000", w: 8.3, h: 3.36 });

    // 9. Sahifa 8 - 80% (MUKAMMAL prompt qo'llanildi)
    await updateProgress(ctx, loadingMessageId, "8-sahifa tayyorlanmoqda...", 83);
    const slide8Prompt = getMukammalPrompt(presentationData.topic, plan[5]);
    
    let slide8Text = await generateWithRetry(geminiModel, slide8Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Slide 8", 80);
    slide8Text = slide8Text.replace(/^#+\s*/gm, '').replace(/^\*\*.*?\*\*:?\s*/gm, '').replace(/^[-•]\s*/gm, '').replace(/[\r\n]+/g, ' ').trim();

    const slide8 = pptx.addSlide();
    slide8.background = { path: path.resolve(backgroundImages[7]) };
    slide8.addText(plan[5], { x: 1.48, y: 0.16, align: "center", fontSize: 24, bold: true, w: 7.27, h: 0.84, fontFace: "Times New Roman", color: "FFFFFF" });
    slide8.addText(slide8Text, { x: 0.99, y: 1.45, align: "justify", fontSize: 18, fontFace: "Times New Roman", color: "FFFFFF", w: 8.3, h: 3.36 });

    // 10. Sahifa 9 - 86% (MUKAMMAL prompt qo'llanildi)
    await updateProgress(ctx, loadingMessageId, "9-sahifa tayyorlanmoqda...", 86);
    const slide9Prompt = getMukammalPrompt(presentationData.topic, plan[6]);
    
    let slide9Text = await generateWithRetry(geminiModel, slide9Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Slide 9", 86);
    slide9Text = slide9Text.replace(/^#+\s*/gm, '').replace(/^\*\*.*?\*\*:?\s*/gm, '').replace(/^[-•]\s*/gm, '').replace(/[\r\n]+/g, ' ').trim();

    const slide9 = pptx.addSlide();
    slide9.background = { path: path.resolve(backgroundImages[8]) };
    slide9.addText(plan[6], { x: 1.48, y: 0.16, align: "center", fontSize: 24, bold: true, w: 7.27, h: 0.84, fontFace: "Times New Roman", color: "FFFFFF" });
    slide9.addText(slide9Text, { x: 0.99, y: 1.45, align: "justify", fontSize: 18, fontFace: "Times New Roman", color: "000000", w: 8.3, h: 3.36 });


    // 11. Xulosa - 90% (Maxsus qism - o'zgarishsiz)
    await updateProgress(ctx, loadingMessageId, "Xulosa yozilmoqda...", 90);
    
    const page10Prompt = `"${presentationData.topic}" mavzusi bo'yicha YAKUNIY XULOSA yoz.
TALABLAR: Aniq 95-105 so'z. Yakuniy xulosalar va tavsiyalar. Faqat matn, sarlavha yo'q.`;
    
    let page10Text = await generateWithRetry(geminiModel, page10Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "Xulosa", 90);
    page10Text = page10Text.replace(/^#+\s*/gm, '').replace(/^\*\*.*?\*\*:?\s*/gm, '').replace(/^Xulosa:?\s*/gi, '').replace(/[\r\n]+/g, ' ').trim();

    const tenSlide = pptx.addSlide();
    tenSlide.background = { path: path.resolve(backgroundImages[9]) };
    tenSlide.addText(page10Text, { x: 0.39, y: 1.3, align: "justify", fontSize: 14, fontFace: "Times New Roman", color: "FFFFFF", w: 4.83, h: 3.35 });

    // 12. Yakuniy sahifa - 96%
    await updateProgress(ctx, loadingMessageId, "Yakuniy sahifa shakllantirilmoqda...", 96);

    const endSlide = pptx.addSlide();
    endSlide.background = { path: path.resolve(backgroundImages[11]) };
    
    endSlide.addText(`${presentationData.authorName}`, { x: 1.52, w: 4.43, y: 4.71, h: "10%", fontSize: 16, fontFace: "Agency FB", color: "000000", bold: true, valign: "middle" });
    endSlide.addText(`${presentationData.institution}`, { x: 1.59, y: 0.32, w: 4.63, h: "10%", fontSize: 16, color: "000000", fontFace: "Agency FB", bold: true, valign: "middle" });

    // Fayl saqlash - 100%
    await updateProgress(ctx, loadingMessageId, "Fayl yuborishga tayyorlanmoqda...", 99);

    const safeFileName = `${presentationData.authorName}_${presentationData.topic}`.replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 50);
    filePath = path.resolve(`${safeFileName}.pptx`);
    
    logger.info(`PPTX fayl saqlanmoqda: ${filePath}`);
    await pptx.writeFile({ fileName: filePath });
    
    // Loading xabarini o'chirish
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessageId);

    // Faylni yuborish
    await ctx.telegram.sendDocument(ctx.chat.id, { source: filePath });
    await ctx.reply(
      `✅ Prezentatsiya tayyor! Yuklab olishingiz mumkin!\n\n` +
      `📌 Eslatma: Taqdimot telefonda ochilganda yozuvlar ustma-ust tushib qolishi mumkin. ` +
      `Kompyuterda ochib ko'rishingiz tavsiya etiladi.`,
      Markup.keyboard([["🔙 Orqaga"]]).resize()
    );

    // Balansdan yechish
    user.balance -= PRICE;
    user.balanceHistory.push({ amount: -PRICE, date: new Date() });
    await user.save();
    logger.info(`Balans yangilandi: ${user.balance}`);

    // Kanalga yuborish
    if (onComplete) {
      await onComplete(filePath);
    }

    ctx.session = {};

  } catch (error) {
    logger.error(`Template yaratishda xato: ${error.message}`);
    
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessageId);
    } catch (e) {}
    
    await ctx.reply(
      "❌ Prezentatsiya yaratishda xatolik yuz berdi. Qayta urinib ko'ring.",
      Markup.keyboard([["🔙 Orqaga"]]).resize()
    );
    
  } finally {
    // FAYLNI O'CHIRISH
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