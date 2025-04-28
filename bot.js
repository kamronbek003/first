require("dotenv").config();
const { Telegraf, Markup, session } = require("telegraf");
const mongoose = require("mongoose");
const { cleanEnv, str } = require("envalid");
const winston = require("winston");
const validator = require("validator");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const User = require("./models/User");
const fs = require("fs");
const path = require("path");
const fsPromises = require("fs").promises; // Asinxron fayl operatsiyalari uchun

// Template handlers
const templateHandlers = {};
templateHandlers["referat"] = require("./template_handlers/template_referat");
templateHandlers["mustaqil"] = require("./template_handlers/template_mustaqil");
for (let i = 1; i <= 9; i++) {
  templateHandlers[i] = require(`./template_handlers/template_${i}`);
}

// Validate environment variables
const env = cleanEnv(process.env, {
  BOT_TOKEN: str(),
  MONGO_URI: str(),
  ADMIN_ID: str(),
  CHANNELS: str(),
  GEMINI_API_KEY: str(),
  OPENROUTER_API_KEY: str(),
  PRESENTATION_CHANNEL: str(),
  ADMIN_PRESENTATION_CHANNEL: str(),
});

// Initialize bot and dependencies
const bot = new Telegraf(env.BOT_TOKEN);
const adminId = env.ADMIN_ID;
const channels = env.CHANNELS.split(",");

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Logger setup
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: "bot.log", maxsize: 5242880, maxFiles: 5 }),
    new winston.transports.Console(),
  ],
});

// Shablonlar uchun rasmlar (har bir shablon uchun faqat bitta rasm)
const templateSlides = {};
for (let i = 1; i <= 8; i++) {
  templateSlides[i] = `shablonlar_1/${i}/1.jpg`; // Har bir shablon uchun faqat bitta rasm
}

// Date formatting helper
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} | ${hours}:${minutes}`;
}

// Loading animation
async function showLoading(ctx) {
  const frames = [
    "⏳ Eng yaxshi taqdimot tayyorlanmoqda...",
    "🤖 Aqlli algoritmlar ishlayapti...",
    "🔍 Muhim ma’lumotlar yig‘ilmoqda...",
    "📑 Eng mos tarkib tanlanmoqda...",
    "🎨 Dizayn ustida ishlanmoqda...",
    "⚡ Slaydlar yuklanmoqda...",
    "🔄 Yakuniy tekshiruv amalga oshirilmoqda...",
  ];

  const message = await ctx.reply(frames[0]);
  for (let i = 1; i < frames.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await ctx.telegram.editMessageText(ctx.chat.id, message.message_id, null, frames[i]);
  }
  return message.message_id;
}

// Send long messages
async function sendLongMessage(ctx, text, maxLength = 4096) {
  if (text.length <= maxLength) {
    await ctx.reply(text);
    return;
  }

  const parts = [];
  let currentPart = "";
  const lines = text.split("\n");

  for (const line of lines) {
    if (currentPart.length + line.length + 1 > maxLength) {
      parts.push(currentPart);
      currentPart = line;
    } else {
      currentPart += (currentPart ? "\n" : "") + line;
    }
  }
  if (currentPart) parts.push(currentPart);

  for (const part of parts) {
    await ctx.reply(part);
  }
}

// Handle referral bonus
async function handleReferral(referredBy, newUserId) {
  if (referredBy) {
    const referrer = await User.findOne({ telegramId: referredBy });
    if (referrer) {
      referrer.balance += 1000;
      referrer.balanceHistory.push({ amount: 1000, date: new Date() });
      await referrer.save();
      logger.info(`Referral bonusi qo‘shildi: ${referrer.telegramId}`);
      await bot.telegram.sendMessage(
        referrer.telegramId,
        `🎉 Sizning referal linkingiz orqali yangi foydalanuvchi ro‘yxatdan o‘tdi! Sizga 1000 so‘m bonus qo‘shildi.\nSana: ${formatDate(new Date())}`
      );
    } else {
      logger.warn(`Referrer topilmadi: ${referredBy}`);
    }
  }
}

// Post presentation to admin channel (PPTX)
async function postPresentationToAdminChannel(ctx, presentationData, filePath, templateId) {
  try {
    if (!fs.existsSync(filePath)) {
      logger.error(`PPTX fayl topilmadi: ${filePath}`);
      throw new Error("PPTX fayl topilmadi");
    }
    const user = await User.findOne({ telegramId: ctx.from?.id.toString() });
    const message = await bot.telegram.sendDocument(
      env.ADMIN_PRESENTATION_CHANNEL,
      { source: filePath },
      {
        caption: `👤 Foydalanuvchi ID: ${ctx.from.id}\n` +
                 `👤 Ism: ${user.firstName} ${user.lastName}\n` +
                 `📝 Mavzu: ${presentationData.topic}\n` +
                 `📅 Yaratilgan sana: ${formatDate(new Date())}\n` +
                 `📄 Shablon: №${templateId}`
      }
    );
    logger.info(`Presentation posted to admin channel: ${message.message_id}`);
    return message.message_id;
  } catch (error) {
    logger.error(`Failed to post to admin channel: ${error.message}`);
    throw error;
  }
}

// Main menu function
function showMainMenu(ctx) {
  const isAdmin = ctx.from.id == adminId;
  if (isAdmin) {
    ctx.reply(
      "🔧 Admin panel:",
      Markup.keyboard([
        ["👥 Foydalanuvchilar ro‘yxati", "💰 Balans qo‘shish"],
        ["📜 Balans tarixi", "📊 Statistika"],
        ["📢 Hammaga xabar yuborish", "✉️ Bitta foydalanuvchiga xabar"],
      ]).resize()
    );
  } else {
    ctx.reply(
      "📋 Asosiy menyu:",
      Markup.keyboard([
        ["✨ Yaratishni boshlash"],
        ["📖 Qo‘llanma", "📄 Shablonlar"],
        ["💰 Balans", "📎 Referal link"],
        ["👤 Men haqimda", "📊 Statistika"],
      ]).resize()
    );
  }
}

// Shablon rasmini ko‘rsatish funksiyasi
async function showTemplateSlideshow(ctx, templateId, fromSelection = false) {
  const slidePath = path.resolve(templateSlides[templateId]);

  // Fayl mavjudligini tekshirish
  try {
    await fsPromises.access(slidePath, fs.constants.F_OK);
  } catch (err) {
    logger.error(`Fayl topilmadi: ${slidePath}`);
    return ctx.reply(`Shablon №${templateId} uchun rasm topilmadi. Fayl yo‘lini tekshiring yoki admin bilan bog‘laning.`);
  }

  const caption = `Shablon №${templateId}`;
  const buttons = [];
  if (templateId > 1) {
    buttons.push(Markup.button.callback("⬅️", `slide_${templateId - 1}_${fromSelection}`));
  }
  buttons.push(Markup.button.callback("✅", `template_${templateId}`));
  if (templateId < 8) {
    buttons.push(Markup.button.callback("➡️", `slide_${templateId + 1}_${fromSelection}`));
  }

  const keyboard = Markup.inlineKeyboard([
    buttons,
    [Markup.button.url("Shablonlar", "https://prezentor-bot-shablon.netlify.app")],
  ]);

  // Agar bu yangi so‘rov bo‘lsa (masalan, menyudan "Shablonlar" bosilgan bo‘lsa)
  if (!ctx.callbackQuery) {
    try {
      const message = await ctx.replyWithPhoto(
        { source: slidePath },
        { caption, ...keyboard }
      );
      ctx.session.lastSlideMessageId = message.message_id;
      ctx.session.lastTemplateId = templateId;
    } catch (err) {
      logger.error(`Yangi xabar yuborishda xato: ${err.message}`);
      return ctx.reply("Shablonni yuborishda xato yuz berdi. Keyinroq urinib ko‘ring.");
    }
  }
  // Agar "Keyingi" yoki "Oldingi" tugmasi bosilgan bo‘lsa
  else if (ctx.session.lastSlideMessageId) {
    try {
      await ctx.telegram.editMessageMedia(
        ctx.chat.id,
        ctx.session.lastSlideMessageId,
        null,
        {
          type: "photo",
          media: { source: slidePath },
          caption: caption,
        },
        keyboard
      );
      ctx.session.lastTemplateId = templateId;
    } catch (err) {
      if (err.code === 400 && err.description.includes("message is not modified")) {
        // Agar rasm va tugmalar o‘zgarmagan bo‘lsa, hech narsa qilmaymiz
        return;
      } else if (err.code === 400 && err.description.includes("message to edit not found")) {
        logger.warn(`Xabar topilmadi: ${ctx.session.lastSlideMessageId}`);
        const message = await ctx.replyWithPhoto(
          { source: slidePath },
          { caption, ...keyboard }
        );
        ctx.session.lastSlideMessageId = message.message_id;
        ctx.session.lastTemplateId = templateId;
      } else {
        logger.error(`Xabarni tahrir qilishda xato: ${err.message}`);
        const message = await ctx.replyWithPhoto(
          { source: slidePath },
          { caption, ...keyboard }
        );
        ctx.session.lastSlideMessageId = message.message_id;
        ctx.session.lastTemplateId = templateId;
      }
    }
  }
}

// MongoDB connection and bot initialization
async function startBot() {
  try {
    await mongoose.connect(env.MONGO_URI);
    logger.info("MongoDB connected");

    bot.use(session({ getSessionKey: (ctx) => `${ctx.from?.id}:${ctx.chat.id}`, ttl: 3600 }));

    // Global error handler with deduplication
    const errorTimestamps = new Map();
    bot.catch((err, ctx) => {
      const userId = ctx.from?.id;
      const now = Date.now();
      const lastErrorTime = errorTimestamps.get(userId) || 0;

      if (now - lastErrorTime > 5 * 60 * 1000) {
        logger.error(`Xato yuz berdi: ${err.stack}`);
        ctx.reply("Xatolik yuz berdi, keyinroq urinib ko‘ring.");
        errorTimestamps.set(userId, now);
      } else {
        logger.warn(`Suppressed repeated error for user ${userId}: ${err.message}`);
      }
    });

    // Subscription check
    async function checkSubscription(ctx) {
      const checks = channels.map((channel) =>
        ctx.telegram.getChatMember(channel, ctx.from.id).catch(() => null)
      );
      const results = await Promise.all(checks);
      return results.every((member) => member && member.status !== "left");
    }

    // Inline channels keyboard
    function getChannelsInlineKeyboard() {
      return Markup.inlineKeyboard([
        ...channels.map((channel) => [
          Markup.button.url(channel, `https://t.me/${channel.replace("@", "")}`),
        ]),
        [Markup.button.callback("✅ Obuna bo'ldim", "subscribed")],
      ]);
    }

    // Start command
    bot.start(async (ctx) => {
      logger.info(`Yangi foydalanuvchi boshladi: ${ctx.from.id}`);
      let user = await User.findOne({ telegramId: ctx.from.id.toString() });

      const referralId = ctx.startPayload;
      if (!user) {
        ctx.session = ctx.session || {};
        ctx.session.registrationData = { telegramId: ctx.from.id.toString() };

        if (referralId) {
          ctx.session.registrationData.referredBy = referralId;
        }

        await ctx.reply("👤 Iltimos, ismingizni kiriting");
        ctx.session.step = "firstName";
      } else if (!(await checkSubscription(ctx))) {
        await ctx.reply(
          "Botdan foydalanish uchun quyidagi kanallarga obuna bo‘ling:",
          getChannelsInlineKeyboard()
        );
      } else {
        showMainMenu(ctx);
      }
    });

    // Text handler
    bot.on("text", async (ctx) => {
      if (!ctx.session) ctx.session = {};
      let user = await User.findOne({ telegramId: ctx.from.id.toString() });

      // Registration steps
      if (ctx.session.step === "firstName") {
        const firstName = ctx.message.text.trim();
        if (!validator.isLength(firstName, { min: 2, max: 50 })) {
          return ctx.reply("Ismingiz 2-50 harfdan iborat bo‘lishi kerak.");
        }
        ctx.session.registrationData.firstName = validator.escape(firstName);
        await ctx.reply("👤 Familiyangizni kiriting:");
        ctx.session.step = "lastName";
      } else if (ctx.session.step === "lastName") {
        const lastName = ctx.message.text.trim();
        if (!validator.isLength(lastName, { min: 2, max: 50 })) {
          return ctx.reply("Familiyangiz 2-50 harfdan iborat bo‘lishi kerak.");
        }
        ctx.session.registrationData.lastName = validator.escape(lastName);
        await ctx.reply(
          "📞 Telefon raqamingizni yuboring:",
          Markup.keyboard([[Markup.button.contactRequest("Telefonni yuborish")]])
            .oneTime()
            .resize()
        );
        ctx.session.step = "phone";
      } else if (ctx.session.step === "phone") {
        return ctx.reply(
          "Iltimos, telefon raqamingizni kontakt orqali yuboring:",
          Markup.keyboard([[Markup.button.contactRequest("Telefonni ulashish")]])
            .oneTime()
            .resize()
        );
      } else if (ctx.session.step === "student") {
        const isStudent = ctx.message.text === "Ha, o‘qiyman";
        if (!user) {
          user = await User.findOne({ telegramId: ctx.session.registrationData.telegramId });
        }
        user.isStudent = isStudent;
        await user.save();

        await ctx.reply(
          `🎉 Tabriklaymiz! Siz ro‘yxatdan muvaffaqiyatli o‘tdingiz va balansingizga 10 000 so‘m bonus qo'shildi!!!\n\nXo'sh, birinchi taqdimotni yaratib ko'rasanmi, ${user.firstName}?`,
          Markup.inlineKeyboard([
            Markup.button.callback("❌ Yo‘q", "start_presentation_no"),
            Markup.button.callback("✅ Ha", "start_presentation_yes"),
          ])
        );
        ctx.session = { firstUse: true };
      }

      // Main menu handlers
      else if (ctx.message.text === "✨ Yaratishni boshlash") {
        if (!(await checkSubscription(ctx)) && !ctx.session.firstUse) {
          return ctx.reply(
            "Iltimos, kanallarga obuna bo‘ling:",
            getChannelsInlineKeyboard()
          );
        }
        ctx.reply(
          "Nimani yaratmoqchisiz?",
          Markup.keyboard([
            ["📊 Taqdimot"],
            ["🔙 Orqaga"],
          ]).resize()
        );
      } else if (ctx.message.text === "📊 Taqdimot") {
        return ctx.reply("Bot bu xizmatni to'xtatgan, o'zingiz izlanib taqdimot qilishga harakat qiling😊")
        if (!user) return ctx.reply("Iltimos, avval ro‘yxatdan o‘ting.");
        await ctx.reply("👤 Taqdimotchining ism-familiyasini xatolarsiz yozing:");
        ctx.session.step = "presentation_author_name";
      } else if (ctx.session.step === "presentation_author_name") {
        ctx.session.presentationData = { authorName: ctx.message.text.trim() };
        await ctx.reply("🏛 Muassasangizni nomini kiriting (Toshkent Davlat Iqtisodiyot Universiteti):");
        ctx.session.step = "presentation_institution";
      } else if (ctx.session.step === "presentation_institution") {
        ctx.session.presentationData.institution = ctx.message.text.trim();
        await ctx.reply("💡 Taqdimot mavzusini kiriting:");
        ctx.session.step = "presentation_topic";
      } else if (ctx.session.step === "presentation_topic") {
        ctx.session.presentationData.topic = ctx.message.text.trim();
        if (ctx.session.firstUse) {
          await showTemplateSlideshow(ctx, 3, true);
          ctx.session.step = "presentation_template";
        } else if (await checkSubscription(ctx)) {
          await showTemplateSlideshow(ctx, 1, true);
          ctx.session.step = "presentation_template";
        } else {
          await ctx.reply(
            "Iltimos, kanallarga obuna bo‘ling:",
            getChannelsInlineKeyboard()
          );
        }
      } else if (ctx.message.text === "📝 Referat" || ctx.message.text === "📚 Mustaqil ish") {
        if (!user) return ctx.reply("Iltimos, avval ro‘yxatdan o‘ting.");
        await ctx.reply(
          "Hozircha bu xizmat mavjud emas.",
          Markup.keyboard([["🔙 Orqaga"]]).resize()
        );
      } else if (ctx.message.text === "📄 Shablonlar") {
        await showTemplateSlideshow(ctx, 1, false);
      } else if (ctx.message.text === "📖 Qo‘llanma") {
        ctx.reply(
          "Qo‘llanmani ko‘rish uchun quyidagi havolaga o‘ting:",
          Markup.inlineKeyboard([
            Markup.button.url("Qo‘llanma", "https://prezenter-bot-qollanma.netlify.app"),
          ])
        );
      } else if (ctx.message.text === "💰 Balans") {
        if (!user) return ctx.reply("Iltimos, avval ro‘yxatdan o‘ting.");
        ctx.reply(
          `💰 <b>Balansingiz:</b> <code>${user.balance}</code> so‘m\n\n` +
          `🔹 Xizmatlardan uzluksiz foydalanish uchun balansingiz yetarli ekanligiga ishonch hosil qiling.\n\n` +
          `📌 <b>Balansni to‘ldirish</b> uchun pastdagi tugmani bosing! 🚀\n` +
          `📌 <i>Minimal to‘lov miqdori:</i> <b>10 000 so‘m</b>`,
          {
            parse_mode: "HTML",
            ...Markup.keyboard([
              ["💳 Balansni to‘ldirish"],
              ["🔙 Orqaga"]
            ]).resize(),
          }
        );
        
      } else if (ctx.message.text === "📎 Referal link") {
        if (!user) return ctx.reply("Iltimos, avval ro‘yxatdan o‘ting.");
        const referralLink = `https://t.me/${bot.botInfo.username}?start=${user.telegramId}`;
        ctx.reply(
          `📎 Sizning referal linkingiz: \n${referralLink}\n\nDo‘stlaringizni taklif qiling va har bir yangi foydalanuvchi uchun 1000 so‘m bonus oling!`,
          Markup.keyboard([["🔙 Orqaga"]]).resize()
        );
      } else if (ctx.message.text === "👤 Men haqimda") {
        if (!user) {
          await ctx.reply("Iltimos, avval ro‘yxatdan o‘ting.");
          return;
        }

        const presentationCount = user.presentations ? user.presentations.length : 0;
        const currentTime = formatDate(new Date());

        let response =
          `┌ℹ️ <b>Siz haqidingizda ma'lumot:\n│\n` +
          `├👤 User: ${user.firstName} ${user.lastName}\n` +
          `├📑 ID raqam: <code>${user.telegramId}</code>\n` +
          `├📞 Telefon: ${user.phone}\n` +
          `├🎓 Talabamisiz: ${user.isStudent ? "Ha" : "Yo‘q"}\n` +
          `├💰 Asosiy Hisob: ${user.balance} so'm\n` +
          `└📤 Pul kiritish: 0 so'm</b>\n\n`;

        response += `┌📊 <b>SIZNING TAQDIMOTLARINGIZ:</b>\n│\n`;
        if (presentationCount > 0) {
          user.presentations.forEach((pres, index) => {
            response += `├<b>${index + 1}️⃣ ${pres.topic.toUpperCase()}</b> \n├ Yaratilgan vaqt: ${formatDate(
              new Date(pres.createdAt)
            )}\n`;
          });
          response += `└✅ Umumiy taqdimotlar soni: ${presentationCount} ta\n`;
        } else {
          response += `└✅ Umumiy taqdimotlar soni: 0 ta\n`;
        }

        response += `\n⏰ ${currentTime}`;

        await ctx.reply(response, { parse_mode: "HTML" });
      } else if (ctx.message.text === "📊 Statistika") {
        if (!user) return ctx.reply("Iltimos, avval ro‘yxatdan o‘ting.");

        const totalUsers = await User.countDocuments();
        const totalPresentations = await User.aggregate([
          { $unwind: "$presentations" },
          { $group: { _id: null, count: { $sum: 1 } } },
        ]);
        const presentationCount = totalPresentations[0]?.count || 0;

        const response =
          `┌📊 <b>Statistika</b>\n│\n` +
          `├👥 Foydalanuvchilar soni: <b>${totalUsers} </b> ta\n` +
          `├📈 Yaratilgan taqdimotlar soni: <b>${presentationCount + 200}</b> ta\n` +
          `└📑 Ochiq baza: <b>@${env.PRESENTATION_CHANNEL.replace("@", "")}</b>\n` +
          `\n⏰ ${formatDate(new Date())}`;

        await ctx.reply(response, { parse_mode: "HTML" }, Markup.keyboard([["🔙 Orqaga"]]).resize());
      } else if (ctx.message.text === "🔙 Orqaga") {
        showMainMenu(ctx);
      } else if (ctx.message.text === "💳 Balansni to‘ldirish") {
        ctx.reply(
          `🟢 <b>Balansni to‘ldirish</b>\n\n` +
            `💰 <i>Xizmat narxlari har xil bo‘lib, har bir shablon uchun alohida belgilanadi.</i>\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💳 <b>To‘lov uchun karta:</b>\n<code>5614 6821 0879 2062</code>\n` +
            `👤 <b>Qabul :</b> Ibrohimov Kamronbek\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `📤 <b>To‘lovni amalga oshirgandan so‘ng</b>,\n<b>chekni skrinshot qilib yuboring!</b> 📸`,
          {
            parse_mode: "HTML",
            ...Markup.keyboard([["📤 Chekni yuborish"], ["🔙 Orqaga"]]).resize(),
          }
        );
      } else if (ctx.message.text === "📤 Chekni yuborish") {
        ctx.session.step = "check";
        ctx.reply("Iltimos, to‘lov chekining skrinshotini yuboring:");
      }
      // Admin menu handlers
      else if (ctx.message.text === "👥 Foydalanuvchilar ro‘yxati" && ctx.from.id == adminId) {
        const users = await User.find();
        if (users.length === 0) {
          return ctx.reply("Foydalanuvchilar mavjud emas.");
        }
        let response = "👥 Foydalanuvchilar ro‘yxati:\n\n";
        users.forEach((user, index) => {
          response += `${index + 1}. ${user.firstName} ${user.lastName} (ID: ${user.telegramId}, Balans: ${user.balance} so‘m)\n`;
        });
        await sendLongMessage(ctx, response);
      } else if (ctx.message.text === "💰 Balans qo‘shish" && ctx.from.id == adminId) {
        await ctx.reply("Foydalanuvchi ID sini kiriting (masalan, 123456789):");
        ctx.session.step = "admin_add_balance_id";
      } else if (ctx.session.step === "admin_add_balance_id" && ctx.from.id == adminId) {
        const userId = ctx.message.text.trim();
        const user = await User.findOne({ telegramId: userId });
        if (!user) {
          return ctx.reply(
            "Bunday foydalanuvchi topilmadi.",
            Markup.keyboard([
              ["👥 Foydalanuvchilar ro‘yxati", "💰 Balans qo‘shish"],
              ["📜 Balans tarixi", "📊 Statistika"],
              ["📢 Hammaga xabar yuborish", "✉️ Bitta foydalanuvchiga xabar"],
            ]).resize()
          );
        }
        ctx.session.adminAddBalanceUserId = userId;
        await ctx.reply("Qo‘shmoqchi bo‘lgan balans miqdorini so‘mda kiriting (masalan, 5000):");
        ctx.session.step = "admin_add_balance_amount";
      } else if (ctx.session.step === "admin_add_balance_amount" && ctx.from.id == adminId) {
        const amount = parseInt(ctx.message.text.trim());
        if (isNaN(amount) || amount <= 0) {
          return ctx.reply("Iltimos, to‘g‘ri miqdorni kiriting.");
        }
        const user = await User.findOne({ telegramId: ctx.session.adminAddBalanceUserId });
        user.balance += amount;
        user.balanceHistory.push({ amount, date: new Date() });
        await user.save();
        await bot.telegram.sendMessage(
          user.telegramId,
          `💰 Sizning balansingizga ${amount} so‘m qo‘shildi! Hozirgi balans: ${user.balance} so‘m\nSana: ${formatDate(
            new Date()
          )}`
        );
        await ctx.reply(
          `✅ ${user.firstName} ${user.lastName} ga ${amount} so‘m qo‘shildi.`,
          Markup.keyboard([
            ["👥 Foydalanuvchilar ro‘yxati", "💰 Balans qo‘shish"],
            ["📜 Balans tarixi", "📊 Statistika"],
            ["📢 Hammaga xabar yuborish", "✉️ Bitta foydalanuvchiga xabar"],
          ]).resize()
        );
        ctx.session.step = null;
      } else if (ctx.message.text === "📜 Balans tarixi" && ctx.from.id == adminId) {
        await ctx.reply("Foydalanuvchi ID sini kiriting (tarixini ko‘rish uchun):");
        ctx.session.step = "admin_balance_history";
      } else if (ctx.session.step === "admin_balance_history" && ctx.from.id == adminId) {
        const userId = ctx.message.text.trim();
        const user = await User.findOne({ telegramId: userId });
        if (!user) {
          return ctx.reply(
            "Bunday foydalanuvchi topilmadi.",
            Markup.keyboard([
              ["👥 Foydalanuvchilar ro‘yxati", "💰 Balans qo‘shish"],
              ["📜 Balans tarixi", "📊 Statistika"],
              ["📢 Hammaga xabar yuborish", "✉️ Bitta foydalanuvchiga xabar"],
            ]).resize()
          );
        }
        if (user.balanceHistory.length === 0) {
          return ctx.reply(`${user.firstName} ${user.lastName} uchun balans tarixi mavjud emas.`);
        }
        let response = `📜 ${user.firstName} ${user.lastName} uchun balans tarixi:\n\n`;
        user.balanceHistory.forEach((entry, index) => {
          response += `${index + 1}. ${entry.amount} so‘m - ${formatDate(new Date(entry.date))}\n`;
        });
        await sendLongMessage(ctx, response);
        ctx.session.step = null;
      } else if (ctx.message.text === "📊 Statistika" && ctx.from.id == adminId) {
        const totalUsers = await User.countDocuments();
        const totalPresentations = await User.aggregate([
          { $unwind: "$presentations" },
          { $group: { _id: null, count: { $sum: 1 } } },
        ]);
        const presentationCount = totalPresentations[0]?.count || 0;
        const response =
          `📊 Statistika:\n\n` +
          `👥 Umumiy foydalanuvchilar soni: ${totalUsers}\n` +
          `📈 Botda ishlangan taqdimotlar soni: ${presentationCount}\n` +
          `⏰ ${formatDate(new Date())}`;
        await ctx.reply(
          response,
          Markup.keyboard([
            ["👥 Foydalanuvchilar ro‘yxati", "💰 Balans qo‘shish"],
            ["📜 Balans tarixi", "📊 Statistika"],
            ["📢 Hammaga xabar yuborish", "✉️ Bitta foydalanuvchiga xabar"],
          ]).resize()
        );
      } else if (ctx.message.text === "📢 Hammaga xabar yuborish" && ctx.from.id == adminId) {
        ctx.reply(
          "Hammaga yuboriladigan xabarni kiriting (foydalanuvchi ismi uchun {ism} dan foydalaning):"
        );
        ctx.session.step = "admin_broadcast";
      } else if (ctx.session.step === "admin_broadcast" && ctx.from.id == adminId) {
        const messageTemplate = ctx.message.text;
        const users = await User.find();
        const excludedUserIds = ["5252699139", "6328235354", "7028512132", "466166503"];
        let successCount = 0;

        for (const user of users) {
          if (excludedUserIds.includes(user.telegramId)) {
            logger.info(`Excluded user ${user.telegramId} from broadcast`);
            continue;
          }
          const personalizedMessage = messageTemplate.replace("{ism}", user.firstName);
          try {
            await bot.telegram.sendMessage(user.telegramId, personalizedMessage);
            successCount++;
          } catch (err) {
            logger.error(`Xabar yuborishda xato (${user.telegramId}): ${err}`);
          }
        }
        ctx.reply(
          `Xabar ${successCount} ta foydalanuvchiga muvaffaqiyatli yuborildi!\n` +
            `Jami foydalanuvchilar: ${users.length}\n` +
            `Sana: ${formatDate(new Date())}`,
          Markup.keyboard([
            ["👥 Foydalanuvchilar ro‘yxati", "💰 Balans qo‘shish"],
            ["📜 Balans tarixi", "📊 Statistika"],
            ["📢 Hammaga xabar yuborish", "✉️ Bitta foydalanuvchiga xabar"],
          ]).resize()
        );
        ctx.session.step = null;
      } else if (ctx.message.text === "✉️ Bitta foydalanuvchiga xabar" && ctx.from.id == adminId) {
        ctx.reply("Xabar yuboriladigan foydalanuvchi ID sini kiriting:");
        ctx.session.step = "admin_single_message_id";
      } else if (ctx.session.step === "admin_single_message_id" && ctx.from.id == adminId) {
        const userId = ctx.message.text.trim();
        const user = await User.findOne({ telegramId: userId });
        if (!user) {
          return ctx.reply(
            "Bunday foydalanuvchi topilmadi.",
            Markup.keyboard([
              ["👥 Foydalanuvchilar ro‘yxati", "💰 Balans qo‘shish"],
              ["📜 Balans tarixi", "📊 Statistika"],
              ["📢 Hammaga xabar yuborish", "✉️ Bitta foydalanuvchiga xabar"],
            ]).resize()
          );
        }
        ctx.session.singleMessageUserId = userId;
        await ctx.reply("Yuboriladigan xabarni kiriting:");
        ctx.session.step = "admin_single_message_text";
      } else if (ctx.session.step === "admin_single_message_text" && ctx.from.id == adminId) {
        const messageText = ctx.message.text;
        const userId = ctx.session.singleMessageUserId;
        try {
          await bot.telegram.sendMessage(userId, messageText);
          ctx.reply(
            `Xabar ${userId} ID li foydalanuvchiga muvaffaqiyatli yuborildi!\nSana: ${formatDate(
              new Date()
            )}`,
            Markup.keyboard([
              ["👥 Foydalanuvchilar ro‘yxati", "💰 Balans qo‘shish"],
              ["📜 Balans tarixi", "📊 Statistika"],
              ["📢 Hammaga xabar yuborish", "✉️ Bitta foydalanuvchiga xabar"],
            ]).resize()
          );
        } catch (err) {
          ctx.reply(
            `Xabar yuborishda xato yuz berdi: ${err.message}`,
            Markup.keyboard([
              ["👥 Foydalanuvchilar ro‘yxati", "💰 Balans qo‘shish"],
              ["📜 Balans tarixi", "📊 Statistika"],
              ["📢 Hammaga xabar yuborish", "✉️ Bitta foydalanuvchiga xabar"],
            ]).resize()
          );
        }
        ctx.session.step = null;
      }
    });

    // Contact handler for registration
    bot.on("contact", async (ctx) => {
      if (ctx.session.step === "phone") {
        const phone = ctx.message.contact.phone_number;
        ctx.session.registrationData.phone = phone;

        let user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) {
          const { firstName, lastName, phone, telegramId } = ctx.session.registrationData;
          user = new User({
            telegramId,
            firstName,
            lastName,
            phone,
            registered: true,
            balance: 10000,
            balanceHistory: [{ amount: 10000, date: new Date() }],
            referredBy: ctx.session.registrationData.referredBy || null,
            createdAt: new Date(),
          });
          await user.save();

          await handleReferral(ctx.session.registrationData.referredBy, user.telegramId);
        }

        await ctx.reply(
          "Siz o‘qiysizmi?",
          Markup.keyboard([["Ha, o‘qiyman"], ["Yo‘q, o‘qimayman"]])
            .oneTime()
            .resize()
        );
        ctx.session.step = "student";
      }
    });

    // Inline handlers for first presentation
    bot.action("start_presentation_yes", async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply("👤 Taqdimotchining ism-familiyasini xatolarsiz yozing:");
      ctx.session.step = "presentation_author_name";
      ctx.session.firstUse = true;
      ctx.session.selectedTemplate = 3; // Default 3-shablon
    });

    bot.action("start_presentation_no", async (ctx) => {
      await ctx.answerCbQuery();
      showMainMenu(ctx);
      ctx.session = {};
    });

    // Confirmation request
    async function requestConfirmation(ctx, templateId) {
      const data = ctx.session.presentationData;
      const { authorName, institution, topic } = data;
      const price = templateHandlers[templateId].price;

      await ctx.reply(
        `📋 Quyidagi ma'lumotlarni tasdiqlaysizmi?\n\n` +
          `👤 Ism-familiya: ${authorName}\n` +
          `🏫 Muassasa: ${institution}\n` +
          `📝 Mavzu: ${topic}\n` +
          `📄 Tur: Taqdimot shablon ${templateId}\n` +
          `💰 Narx: ${price} so‘m\n\n` +
          `${
            ctx.session.firstUse
              ? "🎉 Birinchi foydalanish uchun balansingizda mablag' yetarli!"
              : "Tasdiqlash bilan balansingizdan pul yechiladi."
          }`,
        Markup.inlineKeyboard([
          Markup.button.callback("❌ Yo‘q", "confirm_template_no"),
          Markup.button.callback("✅ Ha", `confirm_template_${templateId}_yes`),
        ])
      );
    }

    // Template handlers registration
    for (let i = 1; i <= 8; i++) {
      bot.action(`template_${i}`, async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) {
          await ctx.reply(
            "Iltimos, avval ro‘yxatdan o‘ting!",
            Markup.keyboard([["🔙 Orqaga"]]).resize()
          );
          return;
        }
        ctx.session.selectedTemplate = i;
        await requestConfirmation(ctx, i);
      });

      bot.action(`confirm_template_${i}_yes`, async (ctx) => {
        await ctx.answerCbQuery();
        try {
          await templateHandlers[i].handle(ctx, {
            User,
            geminiModel,
            showLoading,
            logger,
            bot,
            fs,
            onComplete: async (filePath) => {
              const user = await User.findOne({ telegramId: ctx.from.id.toString() });
              const presentationData = ctx.session.presentationData;

              try {
                // Save presentation to user's record
                const presentation = {
                  authorName: presentationData.authorName,
                  topic: presentationData.topic,
                  filePath: filePath,
                  templateId: i,
                  createdAt: new Date(),
                };
                user.presentations = user.presentations || [];
                user.presentations.push(presentation);
                await user.save();
                logger.info(`Presentation saved for user ${user.telegramId}: ${presentation.topic}`);

                // Post to admin channel (PPTX)
                await postPresentationToAdminChannel(ctx, presentationData, filePath, i);
              } catch (error) {
                logger.error(`Error in onComplete for template ${i}: ${error.stack}`);
                await ctx.reply(
                  "Prezentatsiyani admin kanaliga yuborishda xato yuz berdi. Iltimos, admin bilan bog‘laning."
                );
                throw error;
              }
            },
          });
          if (ctx.session.firstUse) {
            ctx.session.firstUse = false;
          }
        } catch (error) {
          logger.error(`Error handling template ${i}: ${error.stack}`);
        }
      });

      // Shablonlar uchun action handler
      bot.action(new RegExp(`slide_${i}_(\\w+)`), async (ctx) => {
        await ctx.answerCbQuery();
        const fromSelection = ctx.match[1] === "true";
        await showTemplateSlideshow(ctx, i, fromSelection);
      });
    }

    bot.action("noop", async (ctx) => {
      await ctx.answerCbQuery();
    });

    bot.action("confirm_template_no", async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply(
        "❌ Tasdiqlash bekor qilindi. Qaytadan tanlang yoki /start bilan boshlang!",
        Markup.keyboard([["✨ Yaratishni boshlash"], ["🔙 Orqaga"]]).resize()
      );
      ctx.session = {};
    });

    // Photo handler for payment check
    bot.on("photo", async (ctx) => {
      if (ctx.session.step === "check") {
        const photo = ctx.message.photo.pop();
        const userId = ctx.from.id;
        await ctx.telegram.sendPhoto(adminId, photo.file_id, {
          caption: `Foydalanuvchi: @${ctx.from.username || "Username yo‘q"}, ID: ${userId}`,
        });
        ctx.reply(
          "Chek adminga yuborildi. Tasdiqlanishini kuting.",
          Markup.keyboard([["🔙 Orqaga"]]).resize()
        );
        ctx.session = {};
      }
    });

    // Launch bot
    bot.launch().then(async () => {
      logger.info("Bot muvaffaqiyatli ishga tushdi");
      const botInfo = await bot.telegram.getMe();
      bot.botInfo = botInfo;
      process.once("SIGINT", () => bot.stop("SIGINT"));
      process.once("SIGTERM", () => bot.stop("SIGTERM"));
    });
  } catch (err) {
    logger.error("Botni ishga tushirishda xato:", err);
    process.exit(1);
  }
}

startBot();