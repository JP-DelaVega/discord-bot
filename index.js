require("dotenv").config();
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Add at the TOP of index.js
const http = require("http");

// Keep-alive server so Render doesn't sleep
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is alive!");
}).listen(process.env.PORT || 3000, () => {
  console.log("✅ Keep-alive server running");
});

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const chatSessions = new Map();

function getOrCreateSession(userId) {
  if (!chatSessions.has(userId)) {
    const chat = model.startChat({
      history: [],
      generationConfig: { maxOutputTokens: 1000 },
    });
    chatSessions.set(userId, chat);
  }
  return chatSessions.get(userId);
}

// ✅ STEP 1 — Register slash commands when bot is ready
discord.once(Events.ClientReady, async (client) => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("ask")
      .setDescription("Ask Gemini AI anything")
      .addStringOption((opt) =>
        opt.setName("prompt").setDescription("Your question").setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("reset")
      .setDescription("Reset your conversation history"),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST().setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅ Slash commands registered!");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
});

// ✅ STEP 2 — Handle slash commands
discord.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ask") {
    const prompt = interaction.options.getString("prompt");
    await interaction.deferReply(); // shows "Bot is thinking..."

    try {
      const chat = getOrCreateSession(interaction.user.id);
      const result = await chat.sendMessage(prompt);
      const response = result.response.text();

      if (response.length <= 2000) {
        await interaction.editReply(response);
      } else {
        const chunks = response.match(/[\s\S]{1,1900}/g);
        await interaction.editReply(chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp(chunks[i]);
        }
      }
    } catch (err) {
      console.error("Gemini error:", err);
      await interaction.editReply("⚠️ Something went wrong. Please try again.");
    }
  }

  if (interaction.commandName === "reset") {
    chatSessions.delete(interaction.user.id);
    await interaction.reply({ content: "🔄 Conversation reset!", ephemeral: true });
  }
});

// ✅ STEP 3 — Keep mention-based chat working too (optional)
discord.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(discord.user)) return;

  const userInput = message.content.replace(`<@${discord.user.id}>`, "").trim();
  if (!userInput) return message.reply("Hey! Use `/ask` or mention me with a question 👋");

  await message.channel.sendTyping();

  try {
    const chat = getOrCreateSession(message.author.id);
    const result = await chat.sendMessage(userInput);
    const response = result.response.text();

    if (response.length <= 2000) {
      await message.reply(response);
    } else {
      const chunks = response.match(/[\s\S]{1,1900}/g);
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    }
  } catch (err) {
    console.error("Gemini error:", err);
    await message.reply("⚠️ Something went wrong. Please try again.");
  }
});

discord.login(process.env.DISCORD_TOKEN);