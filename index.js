require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState
} = require("@discordjs/voice");

const play = require("play-dl");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("تشغيل أغنية")
    .addStringOption(o =>
      o.setName("song")
        .setDescription("اسم الأغنية أو رابطها")
        .setRequired(true)
    ),
  new SlashCommandBuilder().setName("skip").setDescription("تخطي الأغنية"),
  new SlashCommandBuilder().setName("stop").setDescription("إيقاف الموسيقى"),
  new SlashCommandBuilder().setName("pause").setDescription("إيقاف مؤقت"),
  new SlashCommandBuilder().setName("resume").setDescription("استكمال التشغيل")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

const queues = new Map();

async function registerCommands() {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
}

client.once("ready", () => {
  console.log(`Our songs is online as ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;
  const queue = queues.get(guildId);

  if (interaction.commandName === "play") {
    await interaction.deferReply();

    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.editReply("ادخلي روم صوتي أولاً.");
    }

    try {
      const query = interaction.options.getString("song");
      const results = await play.search(query, { limit: 1 });

      if (!results.length) {
        return interaction.editReply("ما لقيت الأغنية.");
      }

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator
      });

      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

      let current = queues.get(guildId);

      if (!current) {
        const player = createAudioPlayer();
        current = { connection, player, songs: [] };
        queues.set(guildId, current);
        connection.subscribe(player);
        player.on(AudioPlayerStatus.Idle, () => playNext(guildId));
      }

      current.songs.push(results[0]);
      if (current.songs.length === 1) await playNext(guildId);

      return interaction.editReply(`تمت إضافة: **${results[0].title}**`);
    } catch (error) {
      console.error(error);
      return interaction.editReply("تعذر تشغيل الرابط حالياً.");
    }
  }

  if (!queue) {
    return interaction.reply({
      content: "ما فيه موسيقى شغالة.",
      ephemeral: true
    });
  }

  if (interaction.commandName === "pause") {
    queue.player.pause();
    return interaction.reply("تم الإيقاف المؤقت.");
  }

  if (interaction.commandName === "resume") {
    queue.player.unpause();
    return interaction.reply("تم استكمال التشغيل.");
  }

  if (interaction.commandName === "skip") {
    queue.player.stop();
    return interaction.reply("تم تخطي الأغنية.");
  }

  if (interaction.commandName === "stop") {
    queue.songs = [];
    queue.player.stop();
    queue.connection.destroy();
    queues.delete(guildId);
    return interaction.reply("تم إيقاف الموسيقى.");
  }
});

async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;

  const song = queue.songs.shift();
  if (!song) return;

  try {
    const stream = await play.stream(song.url);
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type
    });
    queue.player.play(resource);
  } catch (error) {
    console.error(error);
    playNext(guildId);
  }
}

registerCommands().catch(console.error);
client.login(process.env.DISCORD_TOKEN);
