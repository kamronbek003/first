const PptxGenJS = require("pptxgenjs");
const path = require("path");
const { Markup } = require("telegraf");

// Template 1-specific price
const PRICE = 8000;

// Template 1-specific background images
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

async function handle(ctx, { User, geminiModel, showLoading, logger, bot, fs }) {
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user || user.balance < PRICE) {
    await ctx.reply(
      `Balansingiz yetarli emas! Ushbu shablon narxi: ${PRICE} so‘m`,
      Markup.keyboard([["🔙 Orqaga"]]).resize()
    );
    return;
  }

  // Balansdan narxni yechish
  user.balance -= PRICE;
  user.balanceHistory.push({ amount: -PRICE, date: new Date() });
  await user.save();

  const presentationData = ctx.session.presentationData;

  // Loading animatsiyasini boshlash
  const loadingMessageId = await showLoading(ctx);

  // Gemini’dan 10 ta reja so‘rash
  const outlinePrompt = `${presentationData.topic} mavzusi uchun 
"birinchireja$ikkinchireja$...$o'ninchireja" formatida faqat 10 ta reja yoz. 
Ortiqcha matn va raqam qo‘shma! // Misol: 
"Kirish$Tikuvchilik tarixi$Tikuvchilik turlari$Matolar va xususiyatlari$Tikuvchilik asbob-uskunalari$Andaza va bichish jarayoni$Tikish texnikalari$Zamonaviy tikuvchilik tendensiyalari$Tikuvchilikning iqtisodiy ahamiyati$Xulosa"`;

  const outlineResult = await geminiModel.generateContent(outlinePrompt);
  const outlineText = outlineResult.response.text();
  const plan = outlineText.split("$");
  console.log(plan);
  

  // .pptx fayl yaratish
  const pptx = new PptxGenJS();

  // 1-sahifa: Bosh sahifa
  const titleSlide = pptx.addSlide();
  titleSlide.background = { path: path.resolve(backgroundImages[0]) };
  titleSlide.addText(`${presentationData.topic}`, {
    x: 0.8,
    y: 2.15,
    w: "59%",
    fontSize: 36,
    bold: true,
    color: "000000",
    fontFace: "Agency FB",
  });
  titleSlide.addText(`${presentationData.authorName}`, {
    x: 1.45,
    w: "45%",
    y: 5.05,
    valign: "middle",
    fontSize: 18,
    fontFace: "Agency FB",
    color: "000000",
    bold: true,
  });
  titleSlide.addText(`${presentationData.institution}`, {
    x: 1.45,
    y: 0.6,
    w: "48%",
    fontSize: 18,
    color: "000000",
    fontFace: "Agency FB",
    bold: true,
  });

  // 2-sahifa
  const secondSlide = pptx.addSlide();
  secondSlide.background = { path: path.resolve(backgroundImages[1]) };
  secondSlide.addText(`${plan[0]}`, {
    x: 4.5,
    y: 1.6,
    fontSize: 22,
    fontFace: "Agency FB",
    bold: true,
    color: "000000",
    w: "50%",
  });
  secondSlide.addText(`${plan[1]}`, {
    x: 4.5,
    y: 2.3,
    fontSize: 22,
    fontFace: "Agency FB",
    bold: true,
    color: "000000",
    w: "50%",
  });
  secondSlide.addText(`${plan[3]}`, {
    x: 4.5,
    y: 3,
    fontSize: 22,
    fontFace: "Agency FB",
    bold: true,
    color: "000000",
    w: "50%",
  });
  secondSlide.addText(`${plan[5]}`, {
    x: 4.5,
    y: 3.7,
    fontSize: 22,
    fontFace: "Agency FB",
    bold: true,
    color: "000000",
    w: "50%",
  });
  secondSlide.addText(`${plan[7]}`, {
    x: 4.5,
    y: 4.4,
    fontSize: 22,
    fontFace: "Agency FB",
    bold: true,
    color: "000000",
    w: "50%",
  });

  // 3-sahifa
  const page3Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining kirish qismi uchun 30 - 40 so'zlardan iborat ma'lumot ber!`
  );
  const page3Text = page3Result.response.text();

  const kirish1Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining kirish qismi uchun 15 - 20 so'zlardan iborat birinchi ma'lumotni ber!`
  );
  const kirish1Text = kirish1Result.response.text();

  const kirish2Result = await geminiModel.generateContent(
    `${presentationData.topic} yana mavzusining kirish qismi uchun 15 - 20 so'zlardan iborat ikkinchi ma'lumotni ber!`
  );
  const kirish2Text = kirish2Result.response.text();

  const kirish3Result = await geminiModel.generateContent(
    `${presentationData.topic} yana mavzusining kirish qismi uchun 15 - 20 so'zlardan iborat uchinchi ma'lumotni ber!`
  );
  const kirish3Text = kirish3Result.response.text();

  const thirdSlide = pptx.addSlide();
  thirdSlide.background = { path: path.resolve(backgroundImages[2]) };
  thirdSlide.addText(page3Text, {
    x: 0.1,
    y: 0.95,
    fontSize: 17,
    fontFace: "Calibri Light",
    color: "FFFFFF",
    w: "35%",
    h: "70%",
  });

  thirdSlide.addText(kirish1Text, {
    x: 4.4,
    y: 1.30,
    fontSize: 17,
    fontFace: "Agency FB",
    color: "000000",
    w: "55%",
    valign: "top",
  });

  thirdSlide.addText(kirish2Text, {
    x: 4.4,
    y: 2.62,
    fontSize: 17,
    fontFace: "Agency FB",
    color: "000000",
    w: "55%",
    valign: "top",
  });

  thirdSlide.addText(kirish3Text, {
    x: 4.4,
    y: 3.85,
    fontSize: 17,
    fontFace: "Agency FB",
    color: "000000",
    w: "55%",
    valign: "top",
  });

  // 4-sahifa
  const page4Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[1]} rejasi asosida har biri 30 ta so'zdan iborat bo'lgan 3 ta paragraf ma'lumot ber. Javob "paragraf1$$$paragraf2$$$paragraf3" ko'rinishida har bir paragraf $$$ bilan ajratilgan bo'lsin`
  );
  const page4Text = page4Result.response.text().split("$$$");

  const fourSlide = pptx.addSlide();
  fourSlide.background = { path: path.resolve(backgroundImages[3]) };
  fourSlide.addText(plan[1], {
    x: 0.2,
    y: 0.4,
    fontSize: 24,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
  });

  fourSlide.addText(page4Text[0], {
    x: 0.55,
    y: 2.57,
    align: "center",
    fontSize: 12,
    fontFace: "Times New Roman",
    color: "000000",
    w: "27%",
    valign: "top",
  });

  fourSlide.addText(page4Text[1], {
    x: 3.6,
    y: 2.2,
    align: "center",
    fontSize: 12,
    fontFace: "Times New Roman",
    color: "000000",
    w: "27%",
    valign: "top",
  });

  fourSlide.addText(page4Text[2], {
    x: 6.75,
    y: 2.2,
    align: "center",
    fontSize: 12,
    fontFace: "Times New Roman",
    color: "000000",
    w: "27%",
    valign: "top",
  });

  // 5-sahifa
  const page5Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[2]} rejasi asosida 70 - 80 so'zlardan iborat bir paragraf ma'lumot ber!`
  );
  const page5Text = page5Result.response.text();

  const fifeSlide = pptx.addSlide();
  fifeSlide.background = { path: path.resolve(backgroundImages[4]) };
  fifeSlide.addText(plan[2], {
    x: 3.1,
    y: 0.6,
    fontSize: 28,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "70%",
  });

  fifeSlide.addText(page5Text, {
    x: 1.55,
    y: 3.3,
    align: "center",
    fontSize: 18,
    fontFace: "Times New Roman",
    color: "000000",
    w: "70%",
  });

  // 6-sahifa
  const page6Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[3]} rejasi asosida 80 - 90 so'zlardan iborat 1 paragraf ma'lumot ber!`
  );
  const page6Text = page6Result.response.text();

  const sixSlide = pptx.addSlide();
  sixSlide.background = { path: path.resolve(backgroundImages[5]) };
  sixSlide.addText(plan[3], {
    x: 1.55,
    y: 0.6,
    align: "center",
    fontSize: 24,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
  });

  sixSlide.addText(page6Text, {
    x: 1.55,
    y: 3.3,
    align: "center",
    fontSize: 18,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "70%",
  });

  // 7-sahifa
  const page7Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[4]} rejasi asosida 70 - 80 so'zlardan iborat bir paragraf ma'lumot ber!`
  );
  const page7Text = page7Result.response.text();

  const sevenSlide = pptx.addSlide();
  sevenSlide.background = { path: path.resolve(backgroundImages[6]) };
  sevenSlide.addText(plan[4], {
    x: 3.1,
    y: 0.6,
    fontSize: 28,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "70%",
  });

  sevenSlide.addText(page7Text, {
    x: 1.55,
    y: 3.3,
    align: "center",
    fontSize: 18,
    fontFace: "Times New Roman",
    color: "000000",
    w: "70%",
  });

  // 8-sahifa
  const page8Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[5]} rejasi asosida 80 - 90 so'zlardan iborat 1 paragraf ma'lumot ber!`
  );
  const page8Text = page8Result.response.text();

  const eightSlide = pptx.addSlide();
  eightSlide.background = { path: path.resolve(backgroundImages[7]) };
  eightSlide.addText(plan[5], {
    x: 1.55,
    y: 0.6,
    align: "center",
    fontSize: 24,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
  });

  eightSlide.addText(page8Text, {
    x: 1.55,
    y: 3.3,
    align: "center",
    fontSize: 18,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "70%",
  });

  // 9-sahifa
  const page9Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[6]} rejasi asosida 70 - 80 so'zlardan iborat bir paragraf ma'lumot ber!`
  );
  const page9Text = page9Result.response.text();

  const nineSlide = pptx.addSlide();
  nineSlide.background = { path: path.resolve(backgroundImages[8]) };
  nineSlide.addText(plan[6], {
    x: 0.2,
    y: 0.4,
    fontSize: 28,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
  });

  nineSlide.addText(page9Text, {
    x: 0.9,
    y: 3.2,
    align: "center",
    fontSize: 16,
    fontFace: "Times New Roman",
    color: "000000",
    w: "80%",
  });

  // 10-sahifa
  const page10Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusida 90 - 100 so'zlardan iborat mavzu bo'yicha xulosa yozib ber!`
  );
  const page10Text = page10Result.response.text();

  const tenSlide = pptx.addSlide();
  tenSlide.background = { path: path.resolve(backgroundImages[9]) };
  tenSlide.addText(page10Text, {
    x: 0.3,
    y: 3,
    align: "center",
    fontSize: 14,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "50%",
  });

  // 12-sahifa: Yakuniy sahifa
  const endSlide = pptx.addSlide();
  endSlide.background = { path: path.resolve(backgroundImages[11]) };
  endSlide.addText(`${presentationData.authorName}`, {
    x: 1.45,
    w: "45%",
    y: 5.05,
    valign: "middle",
    fontSize: 18,
    fontFace: "Agency FB",
    color: "000000",
    bold: true,
  });
  endSlide.addText(`${presentationData.institution}`, {
    x: 1.45,
    y: 0.6,
    w: "48%",
    fontSize: 18,
    color: "000000",
    fontFace: "Agency FB",
    bold: true,
  });

  const filePath = `${presentationData.authorName}(${presentationData.topic}).pptx`;
  await pptx.writeFile({ fileName: filePath });

  // Loading xabarini o‘chirish
  await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessageId);

  // Faylni foydalanuvchiga jo‘natish
  await ctx.telegram.sendDocument(ctx.chat.id, { source: filePath });

  // "Tayyor!" xabarini fayldan keyin yuborish
  await ctx.reply(
    `✅ Prezentatsiya tayyor! Yuklab olishingiz mumkin!

📌 Eslatma: Taqdimot telefonda ochilganda yozuvlar ustma-ust tushib qolishi mumkin. Shu sababli, kompyuterda ochib ko‘rishingiz tavsiya etiladi. Agar kompyuterda ochganda ham muammo bo‘lsa, biz bilan bog‘laning. 😊`,
    Markup.keyboard([["🔙 Orqaga"]]).resize()
  );

  // Faylni o‘chirish
  fs.unlinkSync(filePath);

  ctx.session = {};
}

module.exports = { handle, price: PRICE };