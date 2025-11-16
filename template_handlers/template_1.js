const PptxGenJS = require("pptxgenjs");
const path = require("path");
const { Markup } = require("telegraf");

const PRICE = 6000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const MIN_DISPLAY_TIME = 1500; // Har bir xabar kamida 1.5 soniya ko'rinadi

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

// Progress xabarini yangilash funksiyasi (silliq animatsiya bilan)
async function updateProgress(ctx, messageId, text, minDelay = 800) {
  try {
    const startTime = Date.now();
    await ctx.telegram.editMessageText(ctx.chat.id, messageId, null, text, { parse_mode: "HTML" });
    
    // Minimal vaqt kutish
    const elapsed = Date.now() - startTime;
    if (elapsed < minDelay) {
      await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
    }
  } catch (error) {
    if (!error.message.includes("message is not modified")) {
      console.error("Progress yangilanmadi:", error.message);
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
      
      if (ctx && loadingMsgId && stepName && attempt < retries) {
        const progressBar = getProgressBar(stepProgress);
        // await updateProgress(ctx, loadingMsgId, 
        //   `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
        //   `⚠️ <b>${stepName}</b>\n\n` +
        //   `❌ Urinish ${attempt}/${retries} muvaffaqiyatsiz\n` +
        //   `🔄 Qayta urinilmoqda...\n\n` +
        //   `📊 Jarayon: [${progressBar}] ${stepProgress}%`,
        //   1000
        // );
      }
      
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
  
  const loadingMsg = await ctx.reply(
    `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
    `📊 Mavzu: <i>${presentationData.topic}</i>\n` +
    `👤 Muallif: <i>${presentationData.authorName}</i>\n\n` +
    `⏳ Tayyorlanish boshlandi...\n\n` +
    `📊 Jarayon: ░░░░░░░░░░ 0%`,
    { parse_mode: "HTML" },
    2000
  );
  const loadingMessageId = loadingMsg.message_id;

  try {
    // 1. Reja olish - 5%
    await updateProgress(ctx, loadingMessageId,
      `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
      `📊 Mavzu: <i>${presentationData.topic}</i>\n\n` +
      `┌──────────────────────┐\n\n` +
      `      ✅ <b>BOSQICH 1/11</b>      \n\n` +
      `      Reja tayyor!  \n\n` +
      `└──────────────────────┘\n\n` +
      `📊 Jarayon: █░░░░░░░░░ 5%`,
      1200
    );

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

    logger.info(`Reja so'ralyapti: ${presentationData.topic}`);
    const planRaw = await generateWithRetry(geminiModel, outlinePrompt, 'outline', MAX_RETRIES, ctx, loadingMessageId, "📋 Reja yaratilmoqda", 10);
    
    // Rejani tozalash va validatsiya
    const plan = planRaw.map(item => {
      return item
        .replace(/^\d+[\.\)]\s*/g, '')  // Raqamlarni olib tashlash
        .replace(/^[-•]\s*/g, '')       // Bullet pointlarni olib tashlash
        .replace(/[\r\n]+/g, ' ')       // Yangi qatorlarni olib tashlash
        .trim()
        .slice(0, 50);                  // Maksimal uzunlik
    }).filter(item => item.length > 0);
    
    logger.info(`Reja olindi va tozalandi: ${plan.length} ta element`);

    // 2. Bosh sahifa - 15%
    // await updateProgress(ctx, loadingMessageId,
    //   `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
    //   `┌──────────────────────┐\n` +
    //   `│ 📄 <b>✅ BOSQICH 2/11</b>          │\n\n` +
    //   `│ Bosh sahifa tayyor.             │\n` +
    //   `└──────────────────────┘\n\n` +
    //   `📊 Jarayon: ██░░░░░░░░] 15%`,
    //   1200
    // );

    const pptx = new PptxGenJS();

    const titleSlide = pptx.addSlide();
    titleSlide.background = { path: path.resolve(backgroundImages[0]) };
    
    // Mavzu uzunligiga qarab font va joylashuvni sozlash
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
    
    // Muallif nomi uzunligiga qarab sozlash
    const authorLength = presentationData.authorName.length;
    let authorFontSize = 18;
    let authorHeight = "10%";
    
    if (authorLength > 40) {
      authorFontSize = 18;
      authorHeight = 0.52;
    } else if (authorLength > 25) {
      authorFontSize = 22;
      authorHeight = 0.52;
    }
    
    titleSlide.addText(`${presentationData.authorName}`, {
      x: 1.54, w: 4.72, y: 4.8, h: authorHeight, fontSize: authorFontSize,
      fontFace: "Agency FB", color: "000000", bold: true, valign: "middle",
    });
    
    // Muassasa nomi uzunligiga qarab sozlash
    const institutionLength = presentationData.institution.length;
    let institutionFontSize = 18;
    let institutionHeight = "10%";
    
    if (institutionLength > 50) {
      institutionFontSize = 18;
      institutionHeight = "12%";
    } else if (institutionLength > 30) {
      institutionFontSize = 16;
      institutionHeight = "11%";
    }
    
    titleSlide.addText(`${presentationData.institution}`, {
      x: 1.45, y: 0.3, w: "45%", h: institutionHeight, fontSize: institutionFontSize,
      color: "000000", fontFace: "Agency FB", bold: true, valign: "middle",
    });

    await updateProgress(ctx, loadingMessageId,
      `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
      `┌──────────────────────┐\n\n` +
      `      ✅ <b>BOSQICH 2/11</b>                          \n\n` +
      `      Bosh sahifa tayyor!                       \n\n` +
      `└──────────────────────┘\n\n` +
      `📊 Jarayon: ██░░░░░░░░ 20%`,
      MIN_DISPLAY_TIME
    );

    // 3. Mundarija - 25%
    // await updateProgress(ctx, loadingMessageId,
    //   `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
    //   `┌──────────────────────┐\n` +
    //   `  ✅ <b>BOSQICH 3/11</b>      \n` +
    //   `  Mundarija sahifasi tayyor!  \n` +
    //   `└──────────────────────┘\n\n` +
    //   `📊 Jarayon: ███░░░░░░░ 25%`,
    //   1200
    // );

    const secondSlide = pptx.addSlide();
    secondSlide.background = { path: path.resolve(backgroundImages[1]) };
    const menuItems = [plan[0], plan[1], plan[3], plan[5], plan[7]];
    menuItems.forEach((item, index) => {
      secondSlide.addText(item, {
        x: 4.55, y: 1.6 + (index * 0.7), fontSize: 22,
        fontFace: "Agency FB", bold: true, color: "000000", w: "50%",
      });
    });

    await updateProgress(ctx, loadingMessageId,
      `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
      `┌──────────────────────┐\n\n` +
      `      ✅ <b>BOSQICH 3/11</b>      \n\n` +
      `      Mundarija tayyor!    \n\n` +
      `└──────────────────────┘\n\n` +
      `📊 Jarayon: ███░░░░░░░ 30%`,
      MIN_DISPLAY_TIME
    );

    // 4. Kirish - 35%
    logger.info("3-sahifa uchun matn tayyorlanmoqda...");
    
    const page3Prompt = `"${presentationData.topic}" mavzusi bo'yicha prezentatsiyaning KIRISH qismi uchun matn yoz.

TALABLAR:
- Aniq 35-40 so'z
- Mavzuni qisqacha tanishtirish
- Umumiy tasavvur berish
- Oddiy va tushunarli til
- Faqat matnni yoz, boshqa hech narsa yo'q

Matn:`;

    const page3Text = await generateWithRetry(geminiModel, page3Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "📝 Kirish matni", 35);
    
    const kirish1Prompt = `"${presentationData.topic}" haqida birinchi muhim FAKT yoki FIKR.

TALABLAR:
- Aniq 20-25 so'z
- Eng muhim jihat
- Faqat matn, sarlavha yo'q

Matn:`;
    
    const kirish1Text = await generateWithRetry(geminiModel, kirish1Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "💡 Fikr 1", 38);
    
    const kirish2Prompt = `"${presentationData.topic}" haqida ikkinchi muhim FAKT yoki XUSUSIYAT.

TALABLAR:
- Aniq 20-25 so'z
- Birinchi fikrdan farqli
- Faqat matn, sarlavha yo'q

Matn:`;
    
    const kirish2Text = await generateWithRetry(geminiModel, kirish2Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "💡 Fikr 2", 41);
    
    const kirish3Prompt = `"${presentationData.topic}" haqida uchinchi muhim AHAMIYAT yoki FOYDA.

TALABLAR:
- Aniq 20-25 so'z
- Amaliy ahamiyat
- Faqat matn, sarlavha yo'q

Matn:`;
    
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

    await updateProgress(ctx, loadingMessageId,
      `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
      `┌──────────────────────┐\n\n` +
      `      ✅ <b>BOSQICH 4/11</b>      \n\n` +
      `      Kirish tayyor!       \n\n` +
      `└──────────────────────┘\n\n` +
      `📊 Jarayon: █████░░░░░ 45%`,
      MIN_DISPLAY_TIME
    );

    // 5. Sahifa 4 - 50%
    logger.info("4-sahifa uchun matn tayyorlanmoqda...");
    
    const page4Prompt = `"${presentationData.topic}" mavzusining "${plan[1]}" bo'limi uchun 3 ta ALOHIDA paragraf yoz.

QATTIY FORMATDA:
paragraf1$paragraf2$paragraf3

TALABLAR:
- Har bir paragraf ANIQ 28-32 so'z
- Har bir paragraf alohida jihatni yoritsin
- $ bilan ajrating
- Hech qanday raqam, sarlavha yoki qo'shimcha matn yo'q
- Faqat 3 ta paragraf

Javob:`;
    
    const page4TextRaw = await generateWithRetry(geminiModel, page4Prompt, 'triple', MAX_RETRIES, ctx, loadingMessageId, `📝 ${plan[1]}`, 50);
    
    // Matnlarni tozalash
    const page4Text = page4TextRaw.map(text => {
      return text
        .replace(/^\d+[\.\)]\s*/g, '')     // Raqamlarni olib tashlash
        .replace(/^Paragraf\s*\d+:?\s*/gi, '') // "Paragraf 1:" ni olib tashlash
        .replace(/[\r\n]+/g, ' ')          // Yangi qatorlarni olib tashlash
        .trim();
    });

    const fourSlide = pptx.addSlide();
    fourSlide.background = { path: path.resolve(backgroundImages[3]) };
    fourSlide.addText(plan[1], {
      x: 0.12, y: 0.07, fontSize: 24,h: 0.7, w: 7.27, bold: true,
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

    await updateProgress(ctx, loadingMessageId,
      `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
      `┌──────────────────────┐\n\n` +
      `      ✅ <b>BOSQICH 5/11</b>      \n\n` +
      `      4-sahifa tayyor!     \n\n` +
      `└──────────────────────┘\n\n` +
      `📊 Jarayon: █████░░░░░ 55%`,
      MIN_DISPLAY_TIME
    );

    // 6. Sahifa 5 - 60%
    logger.info("5-sahifa uchun matn tayyorlanmoqda...");
    
    const page5Prompt = `"${presentationData.topic}" mavzusining "${plan[2]}" bo'limi uchun BATAFSIL matn yoz.

TALABLAR:
- Aniq 75-85 so'z
- "${plan[2]}" mavzusini to'liq ochib berish
- Aniq faktlar va ma'lumotlar
- Strukturali va tushunarli
- Faqat matn, sarlavha yo'q

Matn:`;
    
    const page5TextRaw = await generateWithRetry(geminiModel, page5Prompt, null, MAX_RETRIES, ctx, loadingMessageId, `📝 ${plan[2]}`, 60);
    
    // Matnni tozalash
    const page5Text = page5TextRaw
      .replace(/^#+\s*/gm, '')           // Markdown sarlavhalarni olib tashlash
      .replace(/^\*\*.*?\*\*:?\s*/gm, '') // Bold sarlavhalarni olib tashlash
      .replace(/[\r\n]+/g, ' ')          // Yangi qatorlarni olib tashlash
      .trim();

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

    await updateProgress(ctx, loadingMessageId,
      `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
      `┌──────────────────────┐\n\n` +
      `      ✅ <b>BOSQICH 6/11</b>      \n\n` +
      `      5-sahifa tayyor!     \n\n` +
      `└──────────────────────┘\n\n` +
      `📊 Jarayon: ██████░░░░ 64%`,
      MIN_DISPLAY_TIME
    );

    // 7-10. Qolgan sahifalar - 65-85%
    const remainingSlides = [
      { index: 6, planIndex: 3, bgIndex: 5, color: "FFFFFF", progress: 68 },
      { index: 7, planIndex: 4, bgIndex: 6, color: "000000", progress: 72 },
      { index: 8, planIndex: 5, bgIndex: 7, color: "FFFFFF", progress: 76 },
      { index: 9, planIndex: 6, bgIndex: 8, color: "000000", progress: 80 },
    ];

    for (const slide of remainingSlides) {
      const slidePrompt = `"${presentationData.topic}" mavzusining "${plan[slide.planIndex]}" bo'limi uchun MUKAMMAL matn yoz.

TALABLAR:
- Aniq 75-90 so'z
- "${plan[slide.planIndex]}" ni to'liq qamrab olish
- Aniq va konkret ma'lumotlar
- Mantiqiy strukturada
- Faqat matn, hech qanday sarlavha yo'q

Matn:`;

      const pageTextRaw = await generateWithRetry(
        geminiModel,
        slidePrompt,
        null, MAX_RETRIES, ctx, loadingMessageId, `📝 ${plan[slide.planIndex]}`, slide.progress
      );
      
      // Matnni tozalash
      const pageText = pageTextRaw
        .replace(/^#+\s*/gm, '')           // Markdown sarlavhalarni olib tashlash
        .replace(/^\*\*.*?\*\*:?\s*/gm, '') // Bold sarlavhalarni olib tashlash  
        .replace(/^[-•]\s*/gm, '')         // Bullet pointlarni olib tashlash
        .replace(/[\r\n]+/g, ' ')          // Yangi qatorlarni olib tashlash
        .trim();

      const newSlide = pptx.addSlide();
      newSlide.background = { path: path.resolve(backgroundImages[slide.bgIndex]) };
      newSlide.addText(plan[slide.planIndex], {
        x: 1.48, y: 0.16, align: "center", fontSize: 24, bold: true, w: 7.27, h: 0.84,
        fontFace: "Times New Roman", color: "FFFFFF",
      });
      newSlide.addText(pageText, {
        x: 0.99, y: 1.45, align: "justify", fontSize: 18,
        fontFace: "Times New Roman", color: slide.color, w: 8.3, h: 3.36
      });

      const progressBar = getProgressBar(slide.progress + 2);
      await updateProgress(ctx, loadingMessageId,
        `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
        `┌──────────────────────┐\n\n` +
        `      ✅ <b>BOSQICH ${slide.index + 1}/11</b>    \n\n` +
        `      ${slide.index}-sahifa tayyor!   \n\n` +
        `└──────────────────────┘\n\n` +
        `📊 Jarayon: ${progressBar} ${slide.progress + 2}%`,
        MIN_DISPLAY_TIME
      );
    }

    // 11. Xulosa - 88%
    logger.info("10-sahifa uchun xulosa tayyorlanmoqda...");
    
    const page10Prompt = `"${presentationData.topic}" mavzusi bo'yicha YAKUNIY XULOSA yoz.

TALABLAR:
- Aniq 95-105 so'z
- Asosiy fikrlarni umumlashtirish
- Mavzuning ahamiyatini ta'kidlash
- Yakuniy xulosalar va tavsiyalar
- Professional va to'liq xulosa
- Faqat matn, sarlavha yo'q

Xulosa:`;
    
    const page10TextRaw = await generateWithRetry(geminiModel, page10Prompt, null, MAX_RETRIES, ctx, loadingMessageId, "🎯 Xulosa", 88);
    
    // Xulosa matnini tozalash
    const page10Text = page10TextRaw
      .replace(/^#+\s*/gm, '')            // Markdown sarlavhalarni olib tashlash
      .replace(/^\*\*.*?\*\*:?\s*/gm, '')  // Bold sarlavhalarni olib tashlash
      .replace(/^Xulosa:?\s*/gi, '')       // "Xulosa:" so'zini olib tashlash
      .replace(/[\r\n]+/g, ' ')           // Yangi qatorlarni olib tashlash
      .trim();

    const tenSlide = pptx.addSlide();
    tenSlide.background = { path: path.resolve(backgroundImages[9]) };
    tenSlide.addText(page10Text, {
      x: 0.39, y: 1.3, align: "justify", fontSize: 14,
      fontFace: "Times New Roman", color: "FFFFFF", w: 4.83, h: 3.35,
    });

    await updateProgress(ctx, loadingMessageId,
      `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
      `┌──────────────────────┐\n\n` +
      `      ✅ <b>BOSQICH 10/11</b>     \n\n` +
      `      Xulosa tayyor!       \n\n` +
      `└──────────────────────┘\n\n` +
      `📊 Jarayon: █████████░ 92%`,
      MIN_DISPLAY_TIME
    );

    // 12. Yakuniy sahifa - 96%
    await updateProgress(ctx, loadingMessageId,
      `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
      `┌──────────────────────┐\n\n` +
      `  🎉 <b>BOSQICH 11/11</b>     \n\n` +
      `  Yakuniy sahifa tayyor!      \n\n` +
      `└──────────────────────┘\n\n` +
      `🎯 Yakunlanmoqda...\n\n` +
      `📊 Jarayon: █████████░ 96%`,
      1200
    );

    const endSlide = pptx.addSlide();
    endSlide.background = { path: path.resolve(backgroundImages[11]) };
    
    // Yakuniy sahifada ham muallif va muassasa nomlarini sozlash
    const endAuthorLength = presentationData.authorName.length;
    let endAuthorFontSize = 18;
    let endAuthorHeight = 0.69;
    
    if (endAuthorLength > 40) {
      endAuthorFontSize = 14;
      endAuthorHeight = 0.69;
    } else if (endAuthorLength > 25) {
      endAuthorFontSize = 16;
      endAuthorHeight = 0.69;
    }
    
    endSlide.addText(`${presentationData.authorName}`, {
      x: 1.52, w: 4.43, y: 4.71, h: endAuthorHeight, fontSize: endAuthorFontSize,
      fontFace: "Agency FB", color: "000000", bold: true, valign: "middle",
    });
    
    const endInstitutionLength = presentationData.institution.length;
    let endInstitutionFontSize = 18;
    let endInstitutionHeight = 0.56;
    
    if (endInstitutionLength > 50) {
      endInstitutionFontSize = 14;
      endInstitutionHeight = 0.56;
    } else if (endInstitutionLength > 30) {
      endInstitutionFontSize = 16;
      endInstitutionHeight = 0.56;
    }
    
    endSlide.addText(`${presentationData.institution}`, {
      x: 1.59, y: 0.32, w: 4.63, h: endInstitutionHeight, fontSize: endInstitutionFontSize,
      color: "000000", fontFace: "Agency FB", bold: true, valign: "middle",
    });

    await updateProgress(ctx, loadingMessageId,
      `🎨 <b>PREZENTATSIYA YARATILMOQDA</b>\n\n` +
      `┌──────────────────────┐\n\n` +
      `  💾 <b>Fayl saqlanmoqda!!!</b>  \n\n` +
      `└──────────────────────┘\n\n` +
      `⚡ PPTX format...\n\n` +
      `📊 Jarayon: ██████████ 100%`,
      2500
    );

    // Fayl saqlash
    const safeFileName = `${presentationData.authorName}_${presentationData.topic}`
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 50);
    const filePath = path.resolve(`${safeFileName}.pptx`);
    
    logger.info(`PPTX fayl saqlanmoqda: ${filePath}`);
    await pptx.writeFile({ fileName: filePath });
    logger.info("PPTX fayl muvaffaqiyatli saqlandi");

    // Yakuniy xabar (silliq o'tish)
    await updateProgress(ctx, loadingMessageId,
      `✅ <b>PREZENTATSIYA TAYYOR!</b>\n\n` +
      `📊 Mavzu: <i>${presentationData.topic}</i>\n` +
      `📄 Sahifalar: 12 ta\n` +
      `💾 Fayl hajmi: ~4.5 MB\n\n` +
      `🎉 Fayl yuborilmoqda...`,
      3000
    );

    // Loading xabarini o'chirish
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessageId);

    // Faylni yuborish
    await ctx.telegram.sendDocument(ctx.chat.id, { source: filePath });
    await ctx.reply(
      `✅ Prezentatsiya tayyor! Yuklab olishingiz mumkin!\n\n` +
      `📌 Eslatma: Taqdimot telefonda ochilganda yozuvlar ustma-ust tushib qolishi mumkin. ` +
      `Shu sababli, kompyuterda ochib ko'rishingiz tavsiya etiladi. 😊`,
      Markup.keyboard([["🔙 Orqaga"]]).resize()
    );

    // Balansdan yechish
    user.balance -= PRICE;
    user.balanceHistory.push({ amount: -PRICE, date: new Date() });
    await user.save();
    logger.info(`Balans yangilandi: ${user.balance}`);

    // Kanalga yuborish
    if (onComplete) {
      logger.info(`onComplete chaqirilmoqda: ${filePath}`);
      await onComplete(filePath);
      logger.info("onComplete muvaffaqiyatli bajarildi");
    }

    // Faylni o'chirish
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`Fayl o'chirildi: ${filePath}`);
    }

    ctx.session = {};

  } catch (error) {
    logger.error(`Template yaratishda xato: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);
    
    // Loading xabarini o'chirish
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessageId);
    } catch (e) {
      logger.error(`Loading xabarini o'chirishda xato: ${e.message}`);
    }
    
    await ctx.reply(
      "❌ Prezentatsiya yaratishda xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring yoki admin bilan bog'laning.",
      Markup.keyboard([["🔙 Orqaga"]]).resize()
    );
    
    throw error;
  }
}

module.exports = { handle, price: PRICE };