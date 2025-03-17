const PptxGenJS = require("pptxgenjs");
const path = require("path");
const { Markup } = require("telegraf");

// Template 3-specific price
const PRICE = 10000;

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

async function handle(
  ctx,
  { User, geminiModel, showLoading, logger, bot, fs }
) {
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
  titleSlide.addText(`${presentationData.topic.toUpperCase()}`, {
    x: 0.8,
    y: 2.2,
    w: "59%",
    fontSize: 36,
    bold: true,
    color: "FFFFFF",
    fontFace: "Agency FB",
  });
  titleSlide.addText(`${presentationData.authorName.toTitleCase()}`, {
    x: 1.7,
    w: "45%",
    y: 4.52,
    valign: "middle",
    fontSize: 18,
    fontFace: "Agency FB",
    color: "FFFFFF",
    bold: true,
  });
  titleSlide.addText(`${presentationData.institution.toTitleCase()}`, {
    x: 1.48,
    y: 0.6,
    w: "48%",
    fontSize: 18,
    color: "FFFFFF",
    fontFace: "Agency FB",
    bold: true,
  });

  // 2-sahifa
  const secondSlide = pptx.addSlide();
  secondSlide.background = { path: path.resolve(backgroundImages[1]) };
  secondSlide.addText(`${plan[0]}`, {
    x: 4.8,
    y: 1.57,
    fontSize: 18,
    fontFace: "Agency FB",
    bold: true,
    color: "FFFFFF",
    w: "45%",
  });
  secondSlide.addText(`${plan[1]}`, {
    x: 4.8,
    y: 2.23,
    fontSize: 18,
    fontFace: "Agency FB",
    bold: true,
    color: "FFFFFF",
    w: "45%",
  });
  secondSlide.addText(`${plan[3]}`, {
    x: 4.8,
    y: 2.85,
    fontSize: 18,
    fontFace: "Agency FB",
    bold: true,
    color: "FFFFFF",
    w: "45%",
  });
  secondSlide.addText(`${plan[5]}`, {
    x: 4.8,
    y: 3.52,
    fontSize: 18,
    fontFace: "Agency FB",
    bold: true,
    color: "FFFFFF",
    w: "45%",
  });
  secondSlide.addText(`${plan[7]}`, {
    x: 4.8,
    y: 4.15,
    fontSize: 18,
    fontFace: "Agency FB",
    bold: true,
    color: "FFFFFF",
    w: "45%",
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
    x: 0.3,
    y: 0.95,
    fontSize: 16,
    fontFace: "Calibri Light",
    color: "FFFFFF",
    w: "35%",
    h: "70%",
  });

  thirdSlide.addText(kirish1Text, {
    x: 4.6,
    y: 1.33,
    fontSize: 15,
    fontFace: "Agency FB",
    color: "FFFFFF",
    w: "45%",
    valign: "top",
  });

  thirdSlide.addText(kirish2Text, {
    x: 4.6,
    y: 2.62,
    fontSize: 15,
    fontFace: "Agency FB",
    color: "FFFFFF",
    w: "45%",
    valign: "top",
  });

  thirdSlide.addText(kirish3Text, {
    x: 4.6,
    y: 3.88,
    fontSize: 15,
    fontFace: "Agency FB",
    color: "FFFFFF",
    w: "45%",
    valign: "top",
  });

  // 4-sahifa
  const page4Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[1]} rejasi asosida 80 - 90 so'zlardan iborat bir paragraf  ma'lumot ber!`
  );
  const page4Text = page4Result.response.text();

  const fourSlide = pptx.addSlide();
  fourSlide.background = { path: path.resolve(backgroundImages[3]) };
  fourSlide.addText(plan[1].toUpperCase(), {
    x: 0.5,
    y: 0.4,
    align: "center",
    fontSize: 22,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
  });

  fourSlide.addText(page4Text, {
    x: 1.55,
    y: 3.3,
    align: "center",
    fontSize: 18,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "70%",
  });

  // 5-sahifa
  const page5Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[2]} rejasi asosida 80 - 90 so'zlardan iborat bir paragraf  ma'lumot ber!`
  );
  const page5Text = page5Result.response.text();

  const fifeSlide = pptx.addSlide();
  fifeSlide.background = { path: path.resolve(backgroundImages[4]) };
  fifeSlide.addText(plan[2].toUpperCase(), {
    x: 0.5,
    y: 0.4,
    align: "center",
    fontSize: 22,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
  });

  fifeSlide.addText(page5Text, {
    x: 1.55,
    y: 3.3,
    align: "center",
    fontSize: 18,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "70%",
  });

  // 6-sahifa
  const page6Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[3]} rejasi asosida har biri 30 ta so'zdan iborat bo'lgan 3 ta paragraf ma'lumot ber. Javob "paragraf1$$$paragraf2$$$paragraf3" ko'rinishida har bir paragraf $$$ bilan ajratilgan bo'lsin`
  );
  const page6Text = page6Result.response.text().split("$$$");

  const sixSlide = pptx.addSlide();
  sixSlide.background = { path: path.resolve(backgroundImages[5]) };
  sixSlide.addText(plan[3].toUpperCase(), {
    x: 1.8,
    y: 0.65,
    align: "center",
    fontSize: 18,
    bold: true,
    fontFace: "Times New Roman",
    color: "#FFFFFF",
    w: "70%"
  });

  sixSlide.addText(page6Text[0], {
    x: 0.57,
    y: 2.53,
    align: "center",
    fontSize: 12,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "27%",
    valign: "top",
  });

  sixSlide.addText(page6Text[1], {
    x: 3.6,
    y: 2.16,
    align: "center",
    fontSize: 12,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "27%",
    valign: "top",
  });

  sixSlide.addText(page6Text[2], {
    x: 6.75,
    y: 2.16,
    align: "center",
    fontSize: 12,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "27%",
    valign: "top",
  });

  // 7-sahifa
  const page7Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[4]} rejasi asosida 80 - 90 so'zlardan iborat bir paragraf  ma'lumot ber!`
  );
  const page7Text = page7Result.response.text();

  const sevenSlide = pptx.addSlide();
  sevenSlide.background = { path: path.resolve(backgroundImages[6]) };
  sevenSlide.addText(plan[4].toUpperCase(), {
    x: 0.5,
    y: 0.4,
    align: "center",
    fontSize: 22,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
  });

  sevenSlide.addText(page7Text, {
    x: 1.55,
    y: 3.3,
    align: "center",
    fontSize: 18,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "70%",
  });

  // 8-sahifa
  const page8Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[5]} rejasi asosida 80 - 90 so'zlardan iborat bir paragraf  ma'lumot ber!`
  );
  const page8Text = page8Result.response.text();

  const eightSlide = pptx.addSlide();
  eightSlide.background = { path: path.resolve(backgroundImages[7]) };
  eightSlide.addText(plan[2].toUpperCase(), {
    x: 1.1,
    y: 0.65,
    align: "center",
    fontSize: 20,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "50%",
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
    `${presentationData.topic} mavzusining ${plan[6]} rejasi asosida 80 - 90 so'zlardan iborat bir paragraf  ma'lumot ber!`
  );
  const page9Text = page9Result.response.text();

  const nineSlide = pptx.addSlide();
  nineSlide.background = { path: path.resolve(backgroundImages[8]) };
  nineSlide.addText(plan[6].toUpperCase(), {
    x: 3.75,
    y: 0.65,
    align: "center",
    fontSize: 20,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "50%",
  });

  nineSlide.addText(page9Text, {
    x: 2.5,
    y: 3.3,
    align: "center",
    fontSize: 17,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "65%",
  });

  // 10-sahifa
  const page10Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[7]} rejasi asosida 80 - 90 so'zlardan iborat bir paragraf  ma'lumot ber!`
  );
  const page10Text = page10Result.response.text();

  const tenSlide = pptx.addSlide();
  tenSlide.background = { path: path.resolve(backgroundImages[9]) };
  tenSlide.addText(plan[7].toUpperCase(), {
    x: 2.1,
    y: 0.65,
    align: "center",
    fontSize: 20,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "50%",
  });

  tenSlide.addText(page10Text, {
    x: 1.45,
    y: 3.3,
    align: "center",
    fontSize: 16,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "83%",
  });

  // 11-sahifa
  const page11Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[7]} rejasi asosida 80 - 90 so'zlardan iborat bir paragraf  ma'lumot ber!`
  );
  const page11Text = page11Result.response.text();

  const elevenSlide = pptx.addSlide();
  elevenSlide.background = { path: path.resolve(backgroundImages[10]) };
  elevenSlide.addText(plan[7].toUpperCase(), {
    x: 1.1,
    y: 0.65,
    align: "center",
    fontSize: 20,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "50%",
  });

  elevenSlide.addText(page11Text, {
    x: 1.55,
    y: 3.3,
    align: "center",
    fontSize: 18,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "70%",
  });

  // 12-sahifa
  const page12Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusining ${plan[8]} rejasi asosida 80 - 90 so'zlardan iborat bir paragraf  ma'lumot ber!`
  );
  const page12Text = page12Result.response.text();

  const twelveSlide = pptx.addSlide();
  twelveSlide.background = { path: path.resolve(backgroundImages[11]) };
  twelveSlide.addText(plan[8].toUpperCase(), {
    x: 0.5,
    y: 0.4,
    align: "center",
    fontSize: 22,
    bold: true,
    fontFace: "Times New Roman",
    color: "FFFFFF",
  });

  twelveSlide.addText(page12Text, {
    x: 1.55,
    y: 3.3,
    align: "center",
    fontSize: 18,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "70%",
  });

  // 13-sahifa
  const page13Result = await geminiModel.generateContent(
    `${presentationData.topic} mavzusida 80 - 90 so'zlardan iborat bir paragraf  mavzu bo'yicha xulosa yozib ber!`
  );
  const page13Text = page13Result.response.text();

  const conclusionSlide = pptx.addSlide();
  conclusionSlide.background = { path: path.resolve(backgroundImages[12]) };
  conclusionSlide.addText(page13Text, {
    x: 0.3,
    y: 3,
    align: "center",
    fontSize: 14,
    fontFace: "Times New Roman",
    color: "FFFFFF",
    w: "50%",
  });

  // 14-sahifa: Yakuniy sahifa
  const endSlide = pptx.addSlide();
  endSlide.background = { path: path.resolve(backgroundImages[13]) };
  endSlide.addText(`${presentationData.authorName.toUpperCase()}`, {
    x: 1.45,
    w: "45%",
    y: 5.05,
    valign: "middle",
    fontSize: 18,
    fontFace: "Agency FB",
    color: "000000",
    bold: true,
  });
  endSlide.addText(`${presentationData.institution.toTitleCase()}`, {
    x: 1.48,
    y: 0.6,
    w: "48%",
    fontSize: 18,
    color: "FFFFFF",
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
