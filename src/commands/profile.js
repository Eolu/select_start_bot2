const { EmbedBuilder } = require('discord.js');
const Game = require('../models/Game');
const Award = require('../models/Award');
const User = require('../models/User');
const { AwardType, AwardFunctions } = require('../enums/AwardType');
const RetroAchievementsAPI = require('../services/retroAchievements');
const UsernameUtils = require('../utils/usernameUtils');

/**
 * Create a compact box with a title.
 */
function createCompactBox(title, content) {
  return [
    `─${title}─`,
    content,
    '─'.repeat(Math.max(...content.split('\n').map(line => line.length)) + 2)
  ].join('\n');
}

/**
 * Get current monthly progress for a user.
 */
async function getCurrentProgress(normalizedUsername) {
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();

  const currentGames = await Game.find({
    month: currentMonth,
    year: currentYear
  });

  const currentProgress = [];
  for (const game of currentGames) {
    const award = await Award.findOne({
      raUsername: normalizedUsername,
      gameId: game.gameId,
      month: currentMonth,
      year: currentYear
    });

    if (award) {
      currentProgress.push({
        title: game.title,
        type: game.type,
        progress: `${award.achievementCount}/${award.totalAchievements}`,
        completion: award.userCompletion || 'N/A',
        award: award.award
      });
    }
  }

  return currentProgress;
}

/**
 * Get yearly statistics for a user from challenge awards.
 * Processes non-manual awards (challenge awards) for the current year.
 */
async function getYearlyStats(normalizedUsername) {
  const currentYear = new Date().getFullYear();

  const awards = await Award.find({
    raUsername: normalizedUsername,
    year: currentYear,
    gameId: { $ne: 'manual' } // Only challenge awards
  });

  const stats = {
    totalPoints: 0,
    totalAchievements: 0,
    gamesParticipated: 0,
    gamesBeaten: 0,
    gamesMastered: 0,
    monthlyGames: 0,
    shadowGames: 0,
    participationGames: new Set(),
    beatenGames: new Set(),
    masteredGames: new Set()
  };

  const processedGames = new Map(); // To track unique game-month combinations

  for (const award of awards) {
    // Skip awards with no achievement count or zero achievements.
    if (!award.achievementCount || award.achievementCount <= 0) continue;

    const game = await Game.findOne({
      gameId: award.gameId,
      year: currentYear
    });
    if (!game) continue;

    // Avoid processing the same game for a given month more than once.
    const gameKey = `${game.gameId}-${award.month}`;
    if (processedGames.has(gameKey)) continue;
    processedGames.set(gameKey, true);

    // Sum up overall achievements.
    stats.totalAchievements += award.achievementCount;

    // Track game types.
    if (game.type === 'MONTHLY') {
      stats.monthlyGames++;
    } else if (game.type === 'SHADOW') {
      stats.shadowGames++;
    }

    // Calculate points and track game completion based on award kind.
    switch (award.highestAwardKind) {
      case AwardType.MASTERED:
        stats.totalPoints += AwardFunctions.getPoints(AwardType.MASTERED);
        stats.gamesMastered++;
        stats.masteredGames.add(game.title);
        // For mastered, also count as beaten & participated.
        stats.gamesBeaten++;
        stats.beatenGames.add(game.title);
        stats.gamesParticipated++;
        stats.participationGames.add(game.title);
        break;
      case AwardType.BEATEN:
        stats.totalPoints += AwardFunctions.getPoints(AwardType.BEATEN);
        stats.gamesBeaten++;
        stats.beatenGames.add(game.title);
        stats.gamesParticipated++;
        stats.participationGames.add(game.title);
        break;
      case AwardType.PARTICIPATION:
        stats.totalPoints += AwardFunctions.getPoints(AwardType.PARTICIPATION);
        stats.gamesParticipated++;
        stats.participationGames.add(game.title);
        break;
      default:
        break;
    }
  }

  return {
    ...stats,
    participationGames: Array.from(stats.participationGames),
    beatenGames: Array.from(stats.beatenGames),
    masteredGames: Array.from(stats.masteredGames)
  };
}

/**
 * Get manual (community) awards for the user.
 */
async function getManualAwards(normalizedUsername) {
  const currentYear = new Date().getFullYear();
  const manualAwards = await Award.find({
    raUsername: normalizedUsername,
    gameId: 'manual',
    year: currentYear
  }).sort({ lastChecked: -1 });

  return manualAwards;
}

module.exports = {
  name: 'profile',
  description: 'Shows user profile information with detailed statistics',
  async execute(message, args) {
    try {
      // Use provided username or fallback to the Discord author's username.
      const requestedUsername = args[0] || message.author.username;
      const loadingMsg = await message.channel.send('Fetching profile data...');

      const raAPI = new RetroAchievementsAPI(
        process.env.RA_USERNAME,
        process.env.RA_API_KEY
      );
      const usernameUtils = new UsernameUtils(raAPI);

      // Get the canonical username and normalize it (to lowercase) for querying.
      const canonicalUsername = await usernameUtils.getCanonicalUsername(requestedUsername);
      const normalizedUsername = canonicalUsername.toLowerCase();

      // Find the user using a case-insensitive search based on the canonical username.
      const user = await User.findOne({
        raUsername: { $regex: new RegExp(`^${canonicalUsername}$`, 'i') }
      });
      if (!user) {
        await loadingMsg.delete();
        return message.reply('User not found.');
      }

      // Get profile URLs.
      const profilePicUrl = await usernameUtils.getProfilePicUrl(canonicalUsername);
      const profileUrl = await usernameUtils.getProfileUrl(canonicalUsername);

      // Create an embed for the profile.
      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`User Profile: ${canonicalUsername}`)
        .setThumbnail(profilePicUrl)
        .setURL(profileUrl)
        .setTimestamp();

      // Get current monthly progress.
      const currentProgress = await getCurrentProgress(normalizedUsername);
      if (currentProgress.length > 0) {
        let progressText = '';
        for (const progress of currentProgress) {
          const typeEmoji = progress.type === 'SHADOW' ? '🌑' : '☀️';
          progressText += `${typeEmoji} **${progress.title}**\n`;
          progressText += `Progress: ${progress.progress} (${progress.completion})\n`;
          if (progress.award) {
            progressText += `Award: ${AwardFunctions.getName(progress.award)} ${AwardFunctions.getEmoji(progress.award)}\n`;
          }
          progressText += '\n';
        }
        embed.addFields({ name: '🎮 Current Challenges', value: progressText });
      }

      // Get yearly statistics and manual awards.
      const yearlyStats = await getYearlyStats(normalizedUsername);
      const manualAwards = await getManualAwards(normalizedUsername);
      const manualPoints = manualAwards.reduce((sum, award) => sum + (award.totalAchievements || 0), 0);
      const totalPoints = yearlyStats.totalPoints + manualPoints;

      // Build statistics section.
      const statsText = createCompactBox('Progress',
        `Achievements: ${yearlyStats.totalAchievements}\n` +
        `Monthly Games: ${yearlyStats.monthlyGames}\n` +
        `Shadow Games: ${yearlyStats.shadowGames}\n`
      );

      const completionText = createCompactBox('Completion',
        `Participated: ${yearlyStats.gamesParticipated}\n` +
        `Beaten: ${yearlyStats.gamesBeaten}\n` +
        `Mastered: ${yearlyStats.gamesMastered}\n`
      );

      embed.addFields({ 
        name: '📊 2025 Statistics',
        value: '```ml\n' + statsText + '\n\n' + completionText + '\n```'
      });

      // Add game listings.
      if (yearlyStats.participationGames.length > 0) {
        const participationText = yearlyStats.participationGames
          .map(g => `• ${g}`)
          .join('\n');
        embed.addFields({
          name: '🏁 Games Participated (+1pt)',
          value: '```ml\n' + participationText + '\n```'
        });
      }

      if (yearlyStats.beatenGames.length > 0) {
        const beatenText = yearlyStats.beatenGames
          .map(g => `• ${g}`)
          .join('\n');
        embed.addFields({
          name: '⭐ Games Beaten (+3pts)',
          value: '```ml\n' + beatenText + '\n```'
        });
      }

      if (yearlyStats.masteredGames.length > 0) {
        const masteredText = yearlyStats.masteredGames
          .map(g => `• ${g}`)
          .join('\n');
        embed.addFields({
          name: '✨ Games Mastered (+5pts)',
          value: '```ml\n' + masteredText + '\n```'
        });
      }

      // Build community awards section.
      if (manualAwards.length > 0) {
        const communityAwardsText = [
          `Total Extra Points: ${manualPoints}`,
          '',
          ...manualAwards.map(award => {
            if (award.metadata?.type === 'placement') {
              return `• ${award.metadata.emoji || '🏆'} ${award.reason}: ${award.totalAchievements} point${award.totalAchievements !== 1 ? 's' : ''}`;
            }
            return `• ${award.reason}: ${award.totalAchievements} point${award.totalAchievements !== 1 ? 's' : ''}`;
          })
        ].join('\n');

        embed.addFields({
          name: '🎖️ Community Awards',
          value: '```ml\n' + communityAwardsText + '\n```'
        });
      } else {
        embed.addFields({
          name: '🎖️ Community Awards',
          value: '```\nNone\n```'
        });
      }

      // Add total points section.
      const pointsText = createCompactBox('Points',
        `Total: ${totalPoints}\n` +
        `• Challenge: ${yearlyStats.totalPoints}\n` +
        `• Community: ${manualPoints}\n`
      );
      embed.addFields({ 
        name: '🏆 Total Points',
        value: '```ml\n' + pointsText + '\n```'
      });

      await loadingMsg.delete();
      await message.channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('Error showing profile:', error);
      console.error('Error details:', error.stack);
      await message.reply('Error getting profile data. Please try again.');
    }
  }
};
