require("dotenv").config();
const { Telegraf, Markup, session } = require("telegraf");
const mongoose = require("mongoose");
const { cleanEnv, str } = require("envalid");
const winston = require("winston");
const validator = require("validator");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const User = require("./models/User");
const fs = require("fs");

// Template handlers
const templateHandlers = {};
templateHandlers["referat"] = require("./template_handlers/template_referat");
templateHandlers["mustaqil"] = require("./template_handlers/template_mustaqil");
for (let i = 1; i <= 8; i++) {
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
        "🎉 Sizning referal linkingiz orqali yangi foydalanuvchi ro‘yxatdan o‘tdi! Sizga 1000 so‘m bonus qo‘shildi."
      );
    } else {
      logger.warn(`Referrer topilmadi: ${referredBy}`);
    }
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
        ["📢 Hammaga xabar yuborish"], // Admin uchun yangi opsiya
      ]).resize()
    );
  } else {
    ctx.reply(
      "📋 Asosiy menyu:",
      Markup.keyboard([
        ["✨ Yaratishni boshlash"],
        ["📖 Qo‘llanma", "📄 Shablonlar"],
        ["💰 Balans", "📎 Referal link"],
      ]).resize()
    );
  }
}

// MongoDB connection and bot initialization
async function startBot() {
  try {
    await mongoose.connect(env.MONGO_URI);
    logger.info("MongoDB connected");

    bot.use(session({ getSessionKey: (ctx) => `${ctx.from.id}:${ctx.chat.id}`, ttl: 3600 }));

    bot.catch((err, ctx) => {
      logger.error(`Xato yuz berdi: ${err}`);
      ctx.reply("Xatolik yuz berdi, keyinroq urinib ko‘ring.");
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
      return Markup.inlineKeyboard(
        channels.map((channel) => [
          Markup.button.url(channel, `https://t.me/${channel.replace("@", "")}`),
        ])
      );
    }

    // Start command
    bot.start(async (ctx) => {
      logger.info(`Yangi foydalanuvchi boshladi: ${ctx.from.id}`);
      let user = await User.findOne({ telegramId: ctx.from.id });

      const referralId = ctx.startPayload;
      if (!user) {
        ctx.session = ctx.session || {};
        ctx.session.registrationData = { telegramId: ctx.from.id };

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
      let user = await User.findOne({ telegramId: ctx.from.id });

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
          ]),
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
            ["📚 Mustaqil ish", "📝 Referat"],
            ["🔙 Orqaga"],
          ]).resize()
        );
      } else if (ctx.message.text === "📊 Taqdimot") {
        if (!user) return ctx.reply("Iltimos, avval ro‘yxatdan o‘ting.");
        await ctx.reply("👤 Taqdimotchining ism-familiyasini xatolarsiz yozing:");
        ctx.session.step = "presentation_author_name";
      } else if (ctx.session.step === "presentation_author_name") {
        ctx.session.presentationData = { authorName: ctx.message.text.trim() };
        await ctx.reply("🏛 Muassasangizni nomini kiriting (Toshkent Davlat Iqtisodiyot Univesiteti):");
        ctx.session.step = "presentation_institution";
      } else if (ctx.session.step === "presentation_institution") {
        ctx.session.presentationData.institution = ctx.message.text.trim();
        await ctx.reply("💡 Taqdimot mavzusini kiriting:");
        ctx.session.step = "presentation_topic";
      } else if (ctx.session.step === "presentation_topic") {
        ctx.session.presentationData.topic = ctx.message.text.trim();
        if (ctx.session.firstUse) {
          await requestConfirmation(ctx, 3);
        } else if (await checkSubscription(ctx)) {
          await ctx.reply(
            "Qaysi shablon asosida taqdimot yaratmoqchisiz?",
            Markup.inlineKeyboard([
              [
                Markup.button.callback("1️⃣", "template_1"),
                Markup.button.callback("2️⃣", "template_2"),
                Markup.button.callback("3️⃣", "template_3"),
              ],
              [
                Markup.button.callback("4️⃣", "template_4"),
                Markup.button.callback("5️⃣", "template_5"),
                Markup.button.callback("6️⃣", "template_6"),
              ],
              [
                Markup.button.callback("7️⃣", "template_7"),
                Markup.button.callback("8️⃣", "template_8"),
              ],
              [
                Markup.button.url(
                  "Shablonlar bilan tanishish",
                  "https://prezentor-bot-shablon.netlify.app"
                ),
              ],
            ])
          );
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
        ctx.reply(
          "Shablonlarni ko‘rish uchun quyidagi havolaga o‘ting:",
          Markup.inlineKeyboard([
            Markup.button.url("Shablonlar", "https://prezentor-bot-shablon.netlify.app"),
          ])
        );
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
          `💰 **Balansingiz:** ${user.balance} so‘m\n` +
            `🔹 Xizmatlardan uzluksiz foydalanish uchun balansingiz yetarli ekanligiga ishonch hosil qiling.\n` +
            `📌 **Balansni to‘ldirish** uchun pastdagi tugmani bosing! 🚀`,
          Markup.keyboard([["Balansni to‘ldirish"], ["🔙 Orqaga"]]).resize()
        );
      } else if (ctx.message.text === "📎 Referal link") {
        if (!user) return ctx.reply("Iltimos, avval ro‘yxatdan o‘ting.");
        const referralLink = `https://t.me/${bot.botInfo.username}?start=${user.telegramId}`;
        ctx.reply(
          `📎 Sizning referal linkingiz: \n${referralLink}\n\nDo‘stlaringizni taklif qiling va har bir yangi foydalanuvchi uchun 1000 so‘m bonus oling!`,
          Markup.keyboard([["🔙 Orqaga"]]).resize()
        );
      } else if (ctx.message.text === "🔙 Orqaga") {
        showMainMenu(ctx);
      } else if (ctx.message.text === "Balansni to‘ldirish") {
        ctx.reply(
          `📌 Balansni to‘ldirish\n\n💰 Xizmat narxlari har xil bo‘lib, har bir shablon uchun alohida belgilanadi.\n\n💳 To‘lov uchun karta:\n5614682108792062\n\n👤 Qabul qiluvchi: Ibrohimov Kamronbek\n\n📤 To‘lovni amalga oshirgandan so‘ng, chekni skrinshot qilib yuboring.`,
          Markup.keyboard([["Chekni yuborish"], ["🔙 Orqaga"]]).resize()
        );
      } else if (ctx.message.text === "Chekni yuborish") {
        ctx.session.step = "check";
        ctx.reply("Iltimos, to‘lov chekining skrinshotini yuboring:");
      } else if (ctx.message.text === "📢 Hammaga xabar yuborish" && ctx.from.id == adminId) {
        ctx.reply("Hammaga yuboriladigan xabarni kiriting (foydalanuvchi ismi uchun {ism} dan foydalaning):");
        ctx.session.step = "admin_broadcast";
      } else if (ctx.session.step === "admin_broadcast" && ctx.from.id == adminId) {
        const messageTemplate = ctx.message.text;
        const users = await User.find();
        for (const user of users) {
          const personalizedMessage = messageTemplate.replace("{ism}", user.firstName);
          try {
            await bot.telegram.sendMessage(user.telegramId, personalizedMessage);
          } catch (err) {
            logger.error(`Xabar yuborishda xato (${user.telegramId}): ${err}`);
          }
        }
        ctx.reply("Xabar barcha foydalanuvchilarga muvaffaqiyatli yuborildi!", Markup.keyboard([
          ["👥 Foydalanuvchilar ro‘yxati", "💰 Balans qo‘shish"],
          ["📜 Balans tarixi", "📊 Statistika"],
          ["📢 Hammaga xabar yuborish"],
        ]).resize());
        ctx.session.step = null;
      }
    });

    // Contact handler for registration
    bot.on("contact", async (ctx) => {
      if (ctx.session.step === "phone") {
        const phone = ctx.message.contact.phone_number;
        ctx.session.registrationData.phone = phone;

        let user = await User.findOne({ telegramId: ctx.from.id });
        if (!user) {
          const { firstName, lastName, phone, telegramId } = ctx.session.registrationData;
          if (!firstName || !lastName || !phone || !telegramId) {
            logger.error("Sessiyada majburiy ma’lumotlar yetishmayapti:", {
              telegramId: ctx.from.id,
              sessionData: ctx.session.registrationData,
            });
            await ctx.reply(
              "Xatolik yuz berdi. Iltimos, /start buyrug‘i bilan qaytadan boshlang."
            );
            ctx.session = {};
            return;
          }

          user = new User({
            telegramId,
            firstName,
            lastName,
            phone,
            registered: true,
            balance: 10000,
            balanceHistory: [{ amount: 10000, date: new Date() }],
            referredBy: ctx.session.registrationData.referredBy || null,
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
      ctx.session.selectedTemplate = 3;
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
          `${ctx.session.firstUse ? "🎉 Birinchi foydalanish uchun balansingizda mablag' yeratli!" : "Tasdiqlash bilan balansingizdan pul yechiladi."}`,
        Markup.inlineKeyboard([
          Markup.button.callback("❌ Yo‘q", "confirm_template_no"),
          Markup.button.callback("✅ Ha", `confirm_template_${templateId}_yes`),
        ])
      );
    }

    // Template handlers registration
    for (let i = 1; i <= 12; i++) {
      bot.action(`template_${i}`, async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id });
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
        await templateHandlers[i].handle(ctx, {
          User,
          geminiModel,
          showLoading,
          logger,
          bot,
          fs,
          onComplete: async () => {
            await ctx.reply(
              "✅ Prezentatsiya tayyor! Yuklab olishingiz mumkin!\n\n" +
                "📌 Eslatma: Taqdimot telefonda ochilganda yozuvlar ustma-ust tushib qolishi mumkin. " +
                "Shu sababli, kompyuterda ochib ko‘rishingiz tavsiya etiladi. Agar kompyuterda ochganda ham muammo bo‘lsa, biz bilan bog‘laning. 😊"
            );
            showMainMenu(ctx); // Taqdimot tayyor bo‘lgach asosiy menyu ochiladi
          },
        });
        if (ctx.session.firstUse) {
          ctx.session.firstUse = false;
        }
      });
    }

    bot.action("confirm_template_no", async (ctx) => {
      await ctx.reply(
        "❌ Tasdiqlash bekor qilindi. Qaytadan tanlang yoki /start bilan boshlang!",
        Markup.keyboard([["✨ Yaratishni boshlash"], showMainMenu]).resize()
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