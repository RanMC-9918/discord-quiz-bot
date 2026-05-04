const fs = require('fs');
const { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, GatewayIntentBits} = require('discord.js');
const { Sequelize, DataTypes } = require('sequelize');

// Create the Discord client
const client = new Client({ intents: [GatewayIntentBits.DirectMessages,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,] });

// Log when the bot is online
client.once('ready', () => {
  console.log(`${client.user.tag} is online!`);
  console.log(`Code by Wick Studio`);
  console.log(`discord.gg/wicks`);
});

// Connect to SQLite database
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: 'database.sqlite',
  logging: false,
});

const Points = sequelize.define('Points', {
  guildId: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  points: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
});

// Read configuration from config.json
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// User ID allowed to use the clear command
const allowedClearUserId = config.allowedClearUserId;

// Read questions from quiz.json
const quizData = JSON.parse(fs.readFileSync('quiz.json', 'utf8'));

// Read quotes from quotes.json
const quotesData = JSON.parse(fs.readFileSync('quotes.json', 'utf8'));

// Read terms from termquiz.json
const termQuizData = JSON.parse(fs.readFileSync('termquiz.json', 'utf8'));

// Active tracking maps
const activeCollectors = new Map();
const activeQuizQuestions = new Map();
const activeTermQuizQuestions = new Map();

async function getPointsFromDatabase(guildId, userId) {
  try {
    let userPoints = await Points.findOne({ where: { guildId, userId } });
    if (!userPoints) {
      userPoints = await Points.create({ guildId, userId, points: 0 });
    }

    return userPoints.points;
  } catch (error) {
    console.error('Error getting points from the database:', error);
    return 0;
  }
}

client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  const prefix = config.prefix || '!';
  const args = message.content.slice(prefix.length).trim().split(" ");
  const command = args.shift().toLowerCase();


  if (command === 'quiz') {
    if (!activeQuizQuestions.has(message.channel.id) || activeQuizQuestions.get(message.channel.id).length === 0) {
      activeQuizQuestions.set(message.channel.id, Array.from(quizData.keys()));
    }

    sendQuizQuestion(message);
  } else if (command === 'termquiz') {
    if (!activeTermQuizQuestions.has(message.channel.id) || activeTermQuizQuestions.get(message.channel.id).length === 0) {
      activeTermQuizQuestions.set(message.channel.id, Array.from(termQuizData.keys()));
    }

    sendTermQuizQuestion(message);
  } else if (command === 'points') {
    displayLeaderboard(message);
  } else if (command === 'clear' && message.author.id === allowedClearUserId) {
    clearLeaderboard(message);
  } else if (command === 'skip' && message.author.id === allowedClearUserId) {
    const collector = activeCollectors.get(message.channel.id);
    if (collector) {
      collector.stop('skipped');
    } else {
      message.reply({ content: 'There is no active question to skip in this channel.', ephemeral: true });
    }
  } else if (command === 'stop' && message.author.id === allowedClearUserId) {
    const collector = activeCollectors.get(message.channel.id);
    activeQuizQuestions.delete(message.channel.id);
    activeTermQuizQuestions.delete(message.channel.id);
    if (collector) {
      collector.stop('stopped');
    } else {
      message.reply({ content: 'There is no active question to stop in this channel.', ephemeral: true });
    }
  } else if (command === 'tweet') {
    sendRandomQuote(message);
  }
});

async function sendQuizQuestion(message) {
  try {
    const availableIndices = activeQuizQuestions.get(message.channel.id);
    if (!availableIndices || availableIndices.length === 0) {
      message.channel.send('All questions have been exhausted! The quiz has ended.');
      return;
    }

    const randIndexInArray = Math.floor(Math.random() * availableIndices.length);
    const questionIndex = availableIndices[randIndexInArray];
    const randomQuestion = quizData[questionIndex];
    availableIndices.splice(randIndexInArray, 1);

    const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
    let descriptionText = `**${randomQuestion.question}**\n\n`;
    randomQuestion.options.forEach((option, index) => {
      descriptionText += `**${optionLabels[index]}**: ${option}\n`;
    });

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Quiz Game')
      .setThumbnail('https://media.discordapp.net/attachments/1171933619766435882/1173026889795899513/R.png?ex=6562756c&is=6550006c&hm=cbce71afbf2ba0426c2513bc11c0ae6ca4e16a27e779e590c4e9a98f3dacecf5&=&width=675&height=675')
      .setDescription(descriptionText);

    if (randomQuestion['image-url']) {
      embed.setImage(randomQuestion['image-url']);
    }

    const row = new ActionRowBuilder().addComponents(
      randomQuestion.options.map((option, index) =>
        new ButtonBuilder()
          .setCustomId(`option_${index}`)
          .setLabel(optionLabels[index])
          .setStyle(ButtonStyle.Primary)
      )
    );

    const quizMessage = await message.channel.send({
      embeds: [embed],
      components: [row],
    });

    const filter = (interaction) => interaction.customId.startsWith('option_');
    const collector = message.channel.createMessageComponentCollector({
      filter
    });

    activeCollectors.set(message.channel.id, collector);

    collector.on('collect', async (interaction) => {
      const selectedOption = interaction.customId.split('_')[1];
      if (randomQuestion.options[selectedOption] === randomQuestion.correctAnswer) {
        const user = interaction.user;
        await incrementPointsInDatabase(interaction.guild.id, user.id);
        interaction.reply({ content: `<@${user.id}> got it right! The answer was **${randomQuestion.correctAnswer}**. They got 1 point. Total points: ${await getPointsFromDatabase(interaction.guild.id, user.id)}` });
        collector.stop('answered');
      } else {
        interaction.reply({ content: `<@${interaction.user.id}> guessed incorrectly.` });
      }
    });

    collector.on('end', async (collected, reason) => {
      activeCollectors.delete(message.channel.id);
      if (reason === 'stopped') {
        message.channel.send(`Quiz stopped! The correct answer was **${randomQuestion.correctAnswer}**.`);
        return;
      }
      if (reason === 'skipped') {
        message.channel.send(`Question skipped! The correct answer was **${randomQuestion.correctAnswer}**.`);
      }
      setTimeout(() => sendQuizQuestion(message), 4000);
    });
  } catch (error) {
    console.error('Error sending quiz question:', error);
  }
}

async function incrementPointsInDatabase(guildId, userId) {
  try {
    let userPoints = await Points.findOne({ where: { guildId, userId } });
    if (!userPoints) {
      userPoints = await Points.create({ guildId, userId, points: 0 });
    }

    userPoints.points++;

    await userPoints.save();
  } catch (error) {
    console.error('Error incrementing points in the database:', error);
  }
}

async function displayLeaderboard(message) {
  try {
    const topUsers = await Points.findAll({
      where: { guildId: message.guild.id },
      order: [['points', 'DESC']],
      limit: 10,
    });

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Points Leaderboard')
      .setThumbnail('https://media.discordapp.net/attachments/1171933619766435882/1173031471947190432/leaderboard-icon-16.png?ex=656279b0&is=655004b0&hm=9fb95568d32acfcd23a6303da3c55ece85b191e536dac99102089bce30a5b15e&=&width=675&height=675')
      .setDescription('Top 10 users with the highest points')
      .addFields(
        topUsers.map((user, index) => ({
          name: `#${index + 1} ${message.guild.members.cache.get(user.userId)?.user?.username || 'Unknown User'}`,
          value: `Points : ${user.points}`,
        }))
      );

    message.channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error displaying leaderboard:', error);
  }
}

async function clearLeaderboard(message) {
  try {
    await Points.destroy({ where: { guildId: message.guild.id } });

    message.channel.send('Leaderboard cleared!');
  } catch (error) {
    console.error('Error clearing leaderboard:', error);
    message.channel.send('An error occurred while clearing the leaderboard.');
  }
}

function sendRandomQuote(message) {
  const randomQuote = quotesData[Math.floor(Math.random() * quotesData.length)];

  const embed = new EmbedBuilder()
    .setColor('#3498db')
    .setThumbnail('https://media.discordapp.net/attachments/1171933619766435882/1173035016008237106/Quote.png?ex=65627cfd&is=655007fd&hm=36e692a29fbdaf512e7814f5d46555d76477c8a429bb2d37c1b73748adf96f6b&=&width=675&height=675')
    .setTitle('Quote Tweet')
    .setDescription(`*"${randomQuote.quote}"*`)
    .setFooter({ text: `Requested by ${message.author.username}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) });

  message.channel.send({ embeds: [embed] });
}

sequelize.sync();

async function sendTermQuizQuestion(message) {
  try {
    const availableIndices = activeTermQuizQuestions.get(message.channel.id);
    if (!availableIndices || availableIndices.length === 0) {
      message.channel.send('All vocabulary terms have been exhausted! The quiz has ended.');
      return;
    }

    const randIndexInArray = Math.floor(Math.random() * availableIndices.length);
    const termIndex = availableIndices[randIndexInArray];
    const randomTerm = termQuizData[termIndex];
    availableIndices.splice(randIndexInArray, 1);

    const embed = new EmbedBuilder()
      .setColor('#ff9900')
      .setTitle('Term Quiz Game')
      .setDescription(`**Definition:**\n${randomTerm.definition}\n\nType the correct word in the chat!`);

    if (randomTerm['image-url']) {
      embed.setImage(randomTerm['image-url']);
    }

    const quizMessage = await message.channel.send({
      embeds: [embed],
    });

    const filter = (m) => !m.author.bot;
    const collector = message.channel.createMessageCollector({
      filter
    });

    activeCollectors.set(message.channel.id, collector);

    collector.on('collect', async (m) => {
      if (m.content.toLowerCase().trim() === randomTerm.word.toLowerCase()) {
        const user = m.author;
        await incrementPointsInDatabase(message.guild.id, user.id);
        m.reply(`Correct! The word was **${randomTerm.word}**. You got 1 point. Your total points: ${await getPointsFromDatabase(message.guild.id, user.id)}`);
        collector.stop('answered');
      } else {
        message.channel.send(`<@${m.author.id}> guessed incorrectly.`);
      }
    });

    collector.on('end', async (collected, reason) => {
      activeCollectors.delete(message.channel.id);
      if (reason === 'stopped') {
        message.channel.send(`Quiz stopped! The correct word was **${randomTerm.word}**.`);
        return;
      }
      if (reason === 'skipped') {
        message.channel.send(`Question skipped! The correct word was **${randomTerm.word}**.`);
      }
      setTimeout(() => sendTermQuizQuestion(message), 4000);
    });
  } catch (error) {
    console.error('Error sending term quiz question:', error);
  }
}

client.login(config.token);
