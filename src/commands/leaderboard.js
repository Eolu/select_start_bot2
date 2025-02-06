// File: src/commands/leaderboard.js
const { EmbedBuilder } = require('discord.js');
const Game = require('../models/Game');
const Award = require('../models/Award');

function calculatePoints(awards) {
    let points = 0;
    if (awards.participation) points += 1;
    if (awards.beaten) points += 3;
    if (awards.mastered) points += 3;
    return points;
}

function padString(str, length) {
    return str.toString().slice(0, length).padEnd(length);
}

async function getMonthlyLeaderboard() {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();

    const monthlyGame = await Game.findOne({
        month: currentMonth,
        year: currentYear,
        type: 'MONTHLY'
    });

    if (!monthlyGame) {
        throw new Error('No monthly game found for current month.');
    }

    const awards = await Award.find({
        gameId: monthlyGame.gameId,
        month: currentMonth,
        year: currentYear,
        achievementCount: { $gt: 0 }
    });

    // Sort and rank with ties
    let currentRank = 1;
    let currentScore = -1;
    let increment = 0;

    const sortedAwards = awards.sort((a, b) => b.achievementCount - a.achievementCount);

    sortedAwards.forEach(award => {
        if (award.achievementCount !== currentScore) {
            currentRank += increment;
            increment = 1;
            currentScore = award.achievementCount;
            award.rank = currentRank;
        } else {
            award.rank = currentRank;
            increment++;
        }
    });

    return {
        game: monthlyGame,
        topTen: sortedAwards.slice(0, 10),
        others: sortedAwards.slice(10)
    };
}

async function getYearlyLeaderboard() {
    const currentYear = new Date().getFullYear();
    const awards = await Award.find({ year: currentYear });

    const userPoints = {};

    for (const award of awards) {
        const username = award.raUsername.toLowerCase();
        if (!userPoints[username]) {
            userPoints[username] = {
                username: award.raUsername,
                totalPoints: 0,
                participations: 0,
                beaten: 0,
                mastered: 0
            };
        }

        const points = calculatePoints(award.awards);
        if (points > 0) {
            userPoints[username].totalPoints += points;
            if (award.awards.participation) userPoints[username].participations++;
            if (award.awards.beaten) userPoints[username].beaten++;
            if (award.awards.mastered) userPoints[username].mastered++;
        }
    }

    const sortedUsers = Object.values(userPoints)
        .filter(user => user.totalPoints > 0)
        .sort((a, b) => b.totalPoints - a.totalPoints);

    // Assign ranks with ties
    let currentRank = 1;
    let currentPoints = -1;
    let increment = 0;

    sortedUsers.forEach(user => {
        if (user.totalPoints !== currentPoints) {
            currentRank += increment;
            increment = 1;
            currentPoints = user.totalPoints;
            user.rank = currentRank;
        } else {
            user.rank = currentRank;
            increment++;
        }
    });

    return sortedUsers;
}

module.exports = {
    name: 'leaderboard',
    async execute(message, args) {
        try {
            const type = args[0]?.toLowerCase() || 'month';

            if (type === 'month') {
                const { game, topTen, others } = await getMonthlyLeaderboard();

                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle(`Monthly Challenge: ${game.title}`);

                if (topTen.length > 0) {
                    let topTenText = 'Rank  Player         Progress\n';
                    topTenText += '--------------------------------\n';
                    
                    topTen.forEach(award => {
                        const rank = padString(award.rank, 4);
                        const username = padString(award.raUsername, 13);
                        const progress = `${award.achievementCount}/${game.numAchievements}`;
                        let awards = '';
                        if (award.awards.mastered) awards = ' ✨';
                        else if (award.awards.beaten) awards = ' ⭐';
                        else if (award.awards.participation) awards = ' 🏁';
                        
                        topTenText += `${rank} ${username} ${progress}${awards}\n`;
                    });

                    embed.addFields({ name: 'Leaderboard', value: '```\n' + topTenText + '```' });

                    if (others.length > 0) {
                        const othersText = others
                            .map(a => `${a.raUsername}: ${a.achievementCount}/${game.numAchievements}`)
                            .join('\n');
                        embed.addFields({ 
                            name: 'Also Participating', 
                            value: '```\n' + othersText + '```' 
                        });
                    }
                } else {
                    embed.addFields({ 
                        name: 'Leaderboard', 
                        value: 'No participants yet!' 
                    });
                }

            } else if (type === 'year') {
                const yearlyLeaderboard = await getYearlyLeaderboard();

                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('2025 Yearly Rankings');

                if (yearlyLeaderboard.length > 0) {
                    let text = 'Rank  Player         Pts  P  B  M\n';
                    text += '--------------------------------\n';

                    yearlyLeaderboard.forEach(user => {
                        const rank = padString(user.rank, 4);
                        const name = padString(user.username, 13);
                        const points = padString(user.totalPoints, 4);
                        const p = padString(user.participations, 2);
                        const b = padString(user.beaten, 2);
                        const m = padString(user.mastered, 2);
                        
                        text += `${rank} ${name} ${points} ${p} ${b} ${m}\n`;
                    });

                    embed.addFields({ name: 'Rankings', value: '```\n' + text + '```' });
                } else {
                    embed.addFields({ 
                        name: 'Rankings', 
                        value: 'No points earned yet!' 
                    });
                }
            }

            message.channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('Leaderboard error:', error);
            message.reply('Error getting leaderboard data.');
        }
    }
};
