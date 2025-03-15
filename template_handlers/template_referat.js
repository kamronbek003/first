// template_handlers/template_referat.js
const fetch = require("node-fetch"); // For OpenRouter API
const { Markup } = require("telegraf"); // For Telegram keyboard
const { Document, Packer, Paragraph, TextRun } = require("docx"); // For DOCX generation
const fs = require("fs");

module.exports = {
  price: 5000, // Price in som
  async handle(ctx, { User, showLoading, logger, bot, fs }) {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const { authorName, institution, topic } = ctx.session.workData;

    if (user.balance < this.price) {
      await ctx.reply(
        `❌ Balansingiz yetarli emas!\n` +
          `Joriy balans: ${user.balance} so‘m\n` +
          `Referat narxi: ${this.price} so‘m`,
        Markup.keyboard([["💰 Balansni to‘ldirish"], ["🔙 Orqaga"]]).resize()
      );
      return;
    }

    const loadingMessageId = await showLoading(ctx);

    try {
      // Verify fetch is available
      if (typeof fetch !== "function") {
        throw new Error("fetch is not available - ensure node-fetch is installed");
      }

      // Generate referat content using OpenRouter API
      const prompt = `
        Create a detailed research paper (referat) in Uzbek language with:
        - Author: ${authorName}
        - Institution: ${institution}
        - Topic: ${topic}
        - Structure: 
          - Title page with "REFERAT", topic, and author in uppercase
          - Main sections with numbered uppercase headings (e.g., "1. TA’LIM SOHASIDAGI ISLOHOTLAR")
          - Subsections with numbered headings (e.g., "1.1. Davlat ta'lim dasturlarining yangilanishi")
          - Conclusion as "UMUMIY XULOSA"
        - Length: Approximately 1000-1500 words
        - Format: Plain text with clear section headers separated by double newlines
      `;

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "YOUR_SITE_URL", // Replace with your site URL
          "X-Title": "YOUR_SITE_NAME", // Replace with your site name
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          "model": "deepseek/deepseek-chat:free",
          "messages": [
            {
              "role": "user",
              "content": prompt
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.statusText}`);
      }

      const data = await response.json();
      const referatText = data.choices[0].message.content;

      // Split the text into sections based on double newlines
      const sections = referatText.split("\n\n").filter(section => section.trim() !== "");

      // Create a new DOCX document
      const doc = new Document({
        styles: {
          default: {
            heading1: {
              run: {
                font: "Times New Roman",
                size: 32, // 16pt
                bold: true,
              },
              paragraph: {
                spacing: { after: 240 }, // 12pt spacing after
              },
            },
            heading2: {
              run: {
                font: "Times New Roman",
                size: 28, // 14pt
                bold: true,
              },
              paragraph: {
                spacing: { after: 200 }, // 10pt spacing after
              },
            },
            document: {
              run: {
                font: "Times New Roman",
                size: 24, // 12pt
              },
              paragraph: {
                spacing: { line: 360 }, // 1.5 line spacing
              },
            },
          },
        },
        sections: [
          {
            properties: {},
            children: [
              // Title page
              new Paragraph({
                children: [
                  new TextRun({
                    text: institution,
                    font: "Times New Roman",
                    size: 48, // 18pt
                    bold: true,
                  }),
                ],
                alignment: "center",
                spacing: { after: 480 }, // 24pt spacing after
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: "REFERAT",
                    font: "Times New Roman",
                    size: 36, // 18pt
                    bold: true,
                  }),
                ],
                alignment: "center",
                spacing: { after: 480 }, // 24pt spacing after
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Mavzu: ${topic.toUpperCase()}`,
                    font: "Times New Roman",
                    size: 28, // 14pt
                    bold: true,
                  }),
                ],
                alignment: "center",
                spacing: { after: 480 },
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Tayyorladi: ${authorName.toUpperCase()}`,
                    font: "Times New Roman",
                    size: 28, // 14pt
                    bold: true,
                  }),
                ],
                alignment: "center",
                spacing: { after: 480 },
              }),
              // Content sections
              ...sections.map(section => {
                const isMainHeading = /^\d+\.\s+[A-Z‘’\s]+$/i.test(section.trim());
                const isSubHeading = /^\d+\.\d+\.\s+/.test(section.trim());
                const isTitlePageContent = section.toUpperCase().startsWith("REFERAT") || 
                                          section.toUpperCase().startsWith("MAVZU:") || 
                                          section.toUpperCase().startsWith("TAYYORLADI:");

                if (isTitlePageContent) {
                  return null; // Skip title page content as it's already added
                }

                return new Paragraph({
                  children: [
                    new TextRun({
                      text: section,
                      font: "Times New Roman",
                      size: isMainHeading ? 32 : (isSubHeading ? 28 : 24), // 16pt for main, 14pt for sub, 12pt for body
                      bold: isMainHeading || isSubHeading,
                    }),
                  ],
                  heading: isMainHeading ? "Heading1" : (isSubHeading ? "Heading2" : undefined),
                  spacing: { after: isMainHeading ? 240 : (isSubHeading ? 200 : 120) },
                });
              }).filter(paragraph => paragraph !== null),
            ],
          },
        ],
      });

      // Generate DOCX file
      const fileName = `referat_${ctx.from.id}_${Date.now()}.docx`;
      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(fileName, buffer);

      // Deduct balance
      user.balance -= this.price;
      user.balanceHistory.push({ amount: -this.price, date: new Date() });
      await user.save();

      // Send the file
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessageId);
      await ctx.replyWithDocument(
        { source: fileName },
        {
          caption: `✅ Referat tayyor!\n` +
            `Mavzu: ${topic}\n` +
            `Narx: ${this.price} so‘m\n` +
            `Qoldiq balans: ${user.balance} so‘m`,
        }
      );

      // Clean up
      fs.unlinkSync(fileName);
    } catch (error) {
      logger.error("Referat generation error:", error);
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessageId);
      await ctx.reply(
        "❌ Referat yaratishda xato yuz berdi. Qaytadan urinib ko‘ring.",
        Markup.keyboard([["🔙 Orqaga"]]).resize()
      );
    }

    ctx.session = {};
  },
};