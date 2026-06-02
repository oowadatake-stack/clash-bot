require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const CR_API = 'https://api.clashroyale.com/v1';

function loadTeams() {
  return JSON.parse(fs.readFileSync('./players.json', 'utf-8'));
}

function saveTeams(data) {
  fs.writeFileSync('./players.json', JSON.stringify(data, null, 2));
}

async function getPlayer(tag) {
  const res = await fetch(`${CR_API}/players/%23${tag}`, {
    headers: { Authorization: `Bearer ${process.env.CR_API_KEY}` }
  });
  return res.json();
}

function calcPoints(player) {
  const legend = player.currentPathOfLegendLeagueStats;
  if (legend && legend.trophyCount) return legend.trophyCount;
  const leagueId = player.arena?.id ?? 0;
  if (leagueId >= 54) return 1000;
  if (leagueId >= 53) return 900;
  if (leagueId >= 52) return 800;
  if (leagueId >= 45) return 700;
  if (leagueId >= 44) return 600;
  return 500;
}

async function postRanking(label = '現在') {
  const channel = await client.channels.fetch(process.env.CHANNEL_ID);
  const teams = loadTeams();
  const results = [];

  for (const [teamName, tags] of Object.entries(teams)) {
    let totalPoints = 0;
    const lines = [];
    for (const tag of tags) {
      try {
        const p = await getPlayer(tag);
        const pts = calcPoints(p);
        totalPoints += pts;
        lines.push(`　${p.name}：${pts.toLocaleString()}pt`);
      } catch {
        lines.push(`　${tag}：取得失敗`);
      }
    }
    results.push({ teamName, totalPoints, lines });
  }

  results.sort((a, b) => b.totalPoints - a.totalPoints);
  const medals = ['🥇', '🥈', '🥉'];
  const embed = new EmbedBuilder()
    .setTitle(`🏆 PUBトロ上げレース｜${label}ランキング`)
    .setColor(0xFFD700)
    .setTimestamp()
    .setFooter({ text: 'シーズン終了時点のポイントで最終順位決定' });

  results.forEach((team, i) => {
    embed.addFields({
      name: `${medals[i] ?? `${i + 1}位`} ${team.teamName}　合計 ${team.totalPoints.toLocaleString()}pt`,
      value: team.lines.join('\n') || '　（メンバーなし）',
    });
  });

  await channel.send({ embeds: [embed] });
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ranking') {
    await interaction.reply('📊 集計中...');
    await postRanking('手動確認');
    await interaction.deleteReply();
  }

  if (interaction.commandName === 'addplayer') {
    const teamName = interaction.options.getString('team');
    const tag = interaction.options.getString('tag').replace('#', '').toUpperCase();
    const teams = loadTeams();
    if (!teams[teamName]) teams[teamName] = [];
    const alreadyExists = Object.values(teams).flat().includes(tag);
    if (alreadyExists) return interaction.reply(`⚠️ \`#${tag}\` はすでに登録されています`);
    if (teams[teamName].length >= 8) return interaction.reply(`⚠️ ${teamName} は8名が上限です`);
    teams[teamName].push(tag);
    saveTeams(teams);
    await interaction.reply(`✅ \`#${tag}\` を **${teamName}** に追加しました（${teams[teamName].length}名）`);
  }

  if (interaction.commandName === 'removeplayer') {
    const tag = interaction.options.getString('tag').replace('#', '').toUpperCase();
    const teams = loadTeams();
    let found = false;
    for (const [teamName, members] of Object.entries(teams)) {
      const index = members.indexOf(tag);
      if (index !== -1) {
        teams[teamName].splice(index, 1);
        saveTeams(teams);
        await interaction.reply(`🗑️ \`#${tag}\` を **${teamName}** から削除しました`);
        found = true;
        break;
      }
    }
    if (!found) await interaction.reply(`⚠️ \`#${tag}\` はどのチームにも見つかりませんでした`);
  }

  if (interaction.commandName === 'members') {
    const teams = loadTeams();
    const embed = new EmbedBuilder()
      .setTitle('👥 チームメンバー一覧')
      .setColor(0x5865F2)
      .setTimestamp();
    for (const [teamName, tags] of Object.entries(teams)) {
      embed.addFields({
        name: `${teamName}（${tags.length}名）`,
        value: tags.length > 0 ? tags.map(t => `　#${t}`).join('\n') : '　（未登録）',
      });
    }
    await interaction.reply({ embeds: [embed] });
  }
});

client.once('ready', async () => {
  console.log(`✅ Bot起動: ${client.user.tag}`);
  await client.application.commands.set([
    { name: 'ranking', description: '現在のチームランキングを表示' },
    {
      name: 'addplayer',
      description: 'メンバーをチームに追加',
      options: [
        { name: 'team', description: 'チーム名', type: 3, required: true },
        { name: 'tag', description: 'プレイヤータグ（例: #ABC123）', type: 3, required: true }
      ]
    },
    {
      name: 'removeplayer',
      description: 'メンバーをチームから削除',
      options: [
        { name: 'tag', description: 'プレイヤータグ（例: #ABC123）', type: 3, required: true }
      ]
    },
    { name: 'members', description: '現在のチームメンバー一覧を表示' }
  ]);
  cron.schedule('0 9 * * *', () => postRanking('本日'));
});

client.login(process.env.DISCORD_TOKEN);
