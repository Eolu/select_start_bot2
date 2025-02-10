const { EmbedBuilder } = require('discord.js');
const RetroAchievementsAPI = require('../services/retroAchievements');
const UsernameUtils = require('../utils/usernameUtils');
const leaderboardService = require('../services/leaderboardService');

// Helper to get time remaining until the end of the month
function getTimeRemaining() {
  const now = new Date();
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const diff = endDate - now;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return `${days}d ${hours}h ${minutes}m`;
}

/**
 * Create a compact box with title.
 */
function createCompactBox(title, content) {
  const lines = content.split('\n');
  const maxLength = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return [
    `─${title}─`,
    content,
    '─'.repeat(maxLength + 2)
  ].join('\n');
}

/**
 * Format game title with colored words.
 */
function getColoredGameTitle(title) {
  if (!title) return '';
  const joiners = /\b(to|the|and|or|of|in|on|at|by|for|with)\b/gi;
  return title.split(joiners).map(part => {
    part = part.trim();
    if (!part) return '';
    if (joiners.test(part.toLowerCase())) {
      return part;
    }
    return `[${part}]`;
  }).join(' ');
}

/**
 * Format leaderboard entries with consistent spacing.
 */
function formatLeaderboardEntries(entries, showProgress = false) {
  const safeEntries = entries.map(e => ({
    username: e.username ? e.username : 'Unknown',
    ...e
  }));

  const maxUsernameLength = safeEntries.reduce((max, e) => Math.max(max, e.username.length), 0);
  
  return safeEntries.map((entry, index) => {
    const position = (index + 1).toString().padStart(2, ' ');
    const username = entry.username.padEnd(maxUsernameLength, ' ');
    if (showProgress) {
      const progress = entry.progress ? entry.progress : '0/0';
      const percentage = entry.percentage !== undefined ? entry.percentage.toString() : '0';
      return `${position}. ${username} - ${progress} (${percentage}%)`;
    } else {
      const points = entry.points !== undefined ? entry.points.toString() : '0';
      return `${position}. ${username} - ${points} point${points !== '1' ? 's' : ''}`;
    }
  }).join('\n');
}

/**
 * Helper to trim embed field values to 1024 characters.
 */
function trimFieldValue(content) {
  if (content.length > 1024) {
    return content.slice(0, 1021) + '...';
  }
  return content;
}

module.exports = {
  name: 'leaderboard',
  description: 'Displays monthly or yearly leaderboards using cached database data',
  async execute(message, args) {
    try {
      const raAPI = new RetroAchievementsAPI(
        process.env.RA_USERNAME,
        process.env.RA_API_KEY
      );
      const usernameUtils = new UsernameUtils(raAPI);

      if (!args[0]) {
        const menuEmbed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('Leaderboard Menu')
          .setDescription(
            'Use `!leaderboard month` to view the monthly leaderboard\n' +
            'Use `!leaderboard year` to view the yearly leaderboard'
          )
          .setTimestamp();
        return message.channel.send({ embeds: [menuEmbed] });
      }

      const subcommand = args[0].toLowerCase();

      if (subcommand === 'month' || subcommand === 'm') {
        const monthlyData = await leaderboardService.getMonthlyLeaderboardCache();
        if (!monthlyData) {
          return message.channel.send('Monthly leaderboard data is not available at the moment.');
        }
        
        let headerDetails = '';
        let gameInfo = null;
        
        if (monthlyData.game && monthlyData.game !== 'No Monthly Game') {
          gameInfo = await raAPI.getGameInfo(monthlyData.game.gameId);
          const gameTitle = getColoredGameTitle(gameInfo?.GameTitle);
          headerDetails = createCompactBox('Game Information',
            `[${gameTitle}]\n` +
            `Console: ${gameInfo?.Console || 'N/A'}\n` +
            `Genre: ${gameInfo?.Genre || 'N/A'}\n` +
            `Developer: ${gameInfo?.Developer || 'N/A'}\n` +
            `Publisher: ${gameInfo?.Publisher || 'N/A'}\n` +
            `Release Date: ${gameInfo?.Released || 'N/A'}\n` +
            `Total Achievements: ${monthlyData.game.numAchievements || 'N/A'}\n\n` +
            `Time Remaining: ${getTimeRemaining()}`
          );
        }
        
        const entries = (monthlyData.leaderboard || []).map(entry => ({
          username: entry.username,
          progress: entry.progress,
          percentage: entry.percentage
        }));
        let leaderboardText = formatLeaderboardEntries(entries, true);
        leaderboardText = trimFieldValue('```ml\n' + leaderboardText + '\n```');

        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('Monthly Leaderboard')
          .setTimestamp();
        
        if (gameInfo?.ImageIcon) {
          embed.setThumbnail(`https://retroachievements.org${gameInfo.ImageIcon}`);
        }
        
        if (headerDetails) {
          embed.setDescription('```ml\n' + headerDetails + '\n```');
        }
        
        embed.addFields({
          name: '📊 Rankings',
          value: leaderboardText
        });
        
        await message.channel.send({ embeds: [embed] });
      } else if (subcommand === 'year' || subcommand === 'y') {
        const yearlyData = await leaderboardService.getYearlyLeaderboardCache();
        if (!yearlyData) {
          return message.channel.send('Yearly leaderboard data is not available at the moment.');
        }
        
        let leaderboardText = formatLeaderboardEntries(yearlyData);
        leaderboardText = trimFieldValue('```ml\n' + leaderboardText + '\n```');
        const totalPoints = yearlyData.reduce((sum, entry) => sum + (entry.points || 0), 0);
        const yearlyInfo = createCompactBox('2025 Total Points',
          `Active Players: ${yearlyData.length}\n` +
          `Total Points: ${totalPoints}`
        );
        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('Yearly Leaderboard')
          .setDescription('```ml\n' + yearlyInfo + '\n```')
          .setTimestamp();
          
        embed.addFields({
          name: '🏆 Rankings',
          value: leaderboardText
        });
        
        await message.channel.send({ embeds: [embed] });
      } else {
        await message.reply('Please specify either "month" or "year" (e.g., !leaderboard month)');
      }
    } catch (error) {
      console.error('Leaderboard Command Error:', error);
      await message.channel.send('There was an error displaying the leaderboard.');
    }
  }
};
